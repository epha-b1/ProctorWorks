import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Sku } from '../products/entities/sku.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { EncryptionService } from '../common/encryption.service';
import { PromotionsService } from '../promotions/promotions.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepo: Repository<IdempotencyKey>,
    @InjectRepository(Sku)
    private readonly skuRepo: Repository<Sku>,
    private readonly dataSource: DataSource,
    private readonly encryptionService: EncryptionService,
    private readonly promotionsService: PromotionsService,
  ) {}

  private getUserStoreId(user: any): string | null {
    return user?.storeId ?? user?.store_id ?? null;
  }

  private enforceStoreScope(user: any): string | null {
    if (user.role === 'store_admin') {
      const storeId = this.getUserStoreId(user);
      if (!storeId) {
        throw new ForbiddenException('Store admin has no assigned store');
      }
      return storeId;
    }
    return null;
  }

  async createOrder(
    dto: CreateOrderDto,
    user: any,
  ): Promise<{ order: Order; alreadyExisted: boolean }> {
    // 1. Idempotency check — SCOPED by operation + actor + store.
    //
    //    audit_report-1 §5.4 — looking up purely by `key` was a
    //    cross-tenant leak: a caller in store B reusing a key already
    //    issued in store A would get back the prior store-A response.
    //    The new lookup binds the key to (operation_type, actor_id,
    //    store_id), which is also the shape of the composite UNIQUE
    //    index installed by the ScopeIdempotencyKeys1711900000003
    //    migration. The same key can now legitimately exist for
    //    different actors / stores.
    //
    //    We pre-resolve the caller's effective store here so the
    //    lookup is consistent with the order we'd persist below if
    //    the key were new — if the key DOES exist, we additionally
    //    re-verify the persisted order's `store_id` against this
    //    same scope before returning, as a defense-in-depth check
    //    against any row that pre-dates the migration backfill.
    const callerStoreId =
      this.enforceStoreScope(user) || this.getUserStoreId(user);

    const preReplay = await this.replayScopedOrder(
      dto.idempotencyKey,
      user,
      callerStoreId,
    );
    if (preReplay) return preReplay;

    // 2. Look up SKU prices, compute subtotal.
    //
    //    audit_report-2 P0-1: store-bound SKU ownership.
    //
    //    Previously this fetched SKUs by id alone, with no awareness of
    //    which store the SKU's parent product belonged to. A store_admin
    //    in store A could place an order containing a SKU whose product
    //    lives in store B — the order itself would be tagged store_id=A
    //    (from the JWT scope) but its line items would reference foreign
    //    inventory, breaking tenant isolation, leaking foreign SKU
    //    existence/pricing, and potentially attributing revenue wrong.
    //
    //    Fix: join sku → product and pull product.store_id back. For
    //    store_admin callers, every SKU must match `callerStoreId`.
    //    Out-of-scope SKUs surface as 404 (NotFoundException) to match
    //    the hiding-policy used elsewhere — never 403, so a probing
    //    caller can't tell whether a SKU id exists in another store.
    //    Other roles (platform_admin / content_reviewer) keep the
    //    existing cross-store behaviour.
    const skuIds = dto.items.map((i) => i.skuId);
    const skuRows = await this.skuRepo
      .createQueryBuilder('sku')
      .leftJoinAndSelect('sku.product', 'product')
      .where('sku.id IN (:...skuIds)', { skuIds })
      .getMany();

    const skuMap = new Map<string, Sku>();
    for (const sku of skuRows) {
      skuMap.set(sku.id, sku);
    }

    for (const item of dto.items) {
      const sku = skuMap.get(item.skuId);
      if (!sku) {
        throw new NotFoundException(`SKU ${item.skuId} not found`);
      }
      // store_admin must only buy SKUs from their own store. The 404
      // hiding policy means probing for foreign SKU ids is
      // indistinguishable from probing for missing ids.
      if (user?.role === 'store_admin') {
        const skuProductStoreId = (sku as any).product?.store_id;
        if (!skuProductStoreId || skuProductStoreId !== callerStoreId) {
          throw new NotFoundException(`SKU ${item.skuId} not found`);
        }
      }
    }

    let subtotalCents = 0;
    const itemEntries: { skuId: string; quantity: number; unitPriceCents: number }[] = [];
    for (const item of dto.items) {
      const sku = skuMap.get(item.skuId);
      const unitPrice = sku.member_price_cents ?? sku.price_cents;
      subtotalCents += unitPrice * item.quantity;
      itemEntries.push({
        skuId: item.skuId,
        quantity: item.quantity,
        unitPriceCents: unitPrice,
      });
    }

    // 3. Resolve promotions/coupons (max one auto + one coupon).
    //    `callerStoreId` was resolved above for the idempotency lookup;
    //    reuse it here so both paths see the exact same scope.
    const storeId = callerStoreId;
    let discountCents = 0;
    let promotionId: string | null = null;
    let couponId: string | null = null;

    if (storeId) {
      const resolved = await this.promotionsService.resolvePromotions(
        subtotalCents,
        user.id,
        storeId,
        dto.couponCode,
      );
      discountCents = resolved.totalDiscount;
      promotionId = resolved.selectedPromotion?.id || null;
      couponId = resolved.selectedCoupon?.id || null;
    }

    const totalCents = Math.max(0, subtotalCents - discountCents);

    // Encrypt internal notes if provided
    const encryptedNotes = dto.internalNotes
      ? this.encryptionService.encrypt(dto.internalNotes)
      : null;

    // 4. Create order + items in transaction.
    //
    //    Race-safety note: the final INSERT into `idempotency_keys`
    //    is backed by the composite UNIQUE index
    //      UQ_idempotency_keys_scoped
    //        = (operation_type, actor_id, COALESCE(store_id, sentinel), key)
    //    installed by ScopeIdempotencyKeys1711900000003. If two
    //    concurrent callers both miss the preReplay lookup above,
    //    they will both enter this transaction. Only one INSERT
    //    succeeds; the other raises SQLSTATE 23505 (unique_violation).
    //    Pre-fix that surfaced as HTTP 500. Post-fix we catch the
    //    23505, let the loser's order + items roll back with the
    //    transaction, and resolve via the same scoped-replay helper
    //    the happy-path pre-check uses — so the loser observes the
    //    winner's order with `alreadyExisted: true`, exactly as if
    //    it had arrived a beat later.
    try {
      return await this.dataSource.transaction(async (manager) => {
        const order = manager.create(Order, {
          store_id: storeId,
          user_id: user.id,
          idempotency_key: dto.idempotencyKey,
          total_cents: totalCents,
          discount_cents: discountCents,
          coupon_id: couponId,
          promotion_id: promotionId,
          internal_notes: encryptedNotes,
          status: OrderStatus.PENDING,
        });
        const savedOrder = await manager.save(order);

        const items = itemEntries.map((entry) =>
          manager.create(OrderItem, {
            order_id: savedOrder.id,
            sku_id: entry.skuId,
            quantity: entry.quantity,
            unit_price_cents: entry.unitPriceCents,
          }),
        );
        await manager.save(items);

        // 5. Store idempotency record — scoped by operation + actor + store
        //    so different tenants can legitimately reuse the same key
        //    without colliding on the lookup, and so the read-back path
        //    can never serve a foreign tenant's order.
        const idempotencyRecord = manager.create(IdempotencyKey, {
          key: dto.idempotencyKey,
          operation_type: 'create_order',
          actor_id: user.id,
          store_id: callerStoreId,
          response_body: { orderId: savedOrder.id },
        });
        await manager.save(idempotencyRecord);

        const fullOrder = await manager.findOne(Order, {
          where: { id: savedOrder.id },
          relations: ['items'],
        });

        return { order: fullOrder, alreadyExisted: false };
      });
    } catch (err) {
      if (this.isIdempotencyUniqueViolation(err)) {
        // Concurrent caller won the race. Our transaction rolled
        // back (no ghost order, no orphan items), so we can safely
        // resolve through the deterministic replay path — which
        // re-enforces the exact same (store_id, user_id) ownership
        // guard as the pre-check. A small bounded retry absorbs the
        // narrow read-after-write window where the winner's commit
        // is not yet visible to our connection (same pool / brief
        // replication-like lag); see replayScopedOrderWithRetry.
        const replay = await this.replayScopedOrderWithRetry(
          dto.idempotencyKey,
          user,
          callerStoreId,
        );
        if (replay) return replay;
        throw new ConflictException(
          'Concurrent idempotent create_order conflict; retry with the same key.',
        );
      }
      throw err;
    }
  }

  /**
   * Deterministic scoped-replay lookup used by BOTH the happy-path
   * pre-check and the post-unique-violation recovery branch. Returns
   * the existing order wrapped as a dedup result when the scoped
   * idempotency row resolves to an order that belongs to the caller
   * (same store + same user). Returns `null` when there is no row at
   * all — the caller should proceed with the create path. Throws
   * `NotFoundException` when the row exists but the resolved order
   * fails the ownership check (defense-in-depth against legacy
   * un-backfilled rows / migration anomalies).
   */
  private async replayScopedOrder(
    idempotencyKey: string,
    user: any,
    callerStoreId: string | null,
  ): Promise<{ order: Order; alreadyExisted: boolean } | null> {
    const existingKey = await this.idempotencyRepo.findOne({
      where: {
        operation_type: 'create_order',
        actor_id: user.id,
        store_id: callerStoreId,
        key: idempotencyKey,
      },
    });
    if (!existingKey) return null;

    const orderId: string | undefined = existingKey.response_body?.orderId;
    if (orderId) {
      const existingOrder = await this.orderRepo.findOne({
        where: { id: orderId },
        relations: ['items'],
      });
      if (
        existingOrder &&
        (callerStoreId == null || existingOrder.store_id === callerStoreId) &&
        existingOrder.user_id === user.id
      ) {
        return { order: existingOrder, alreadyExisted: true };
      }
    }
    throw new NotFoundException(
      'Idempotency key exists but does not belong to this scope',
    );
  }

  /**
   * Exact-name allowlist of unique constraints/indexes whose
   * SQLSTATE 23505 from `createOrder`'s transaction we MUST resolve
   * as an idempotency-replay instead of a 500.
   *
   * Today only `UQ_idempotency_keys_scoped` (installed by
   * `1711900000003-ScopeIdempotencyKeys`) is in scope. Hard-coding
   * exact names (not a substring regex) eliminates the risk of
   * future, unrelated unique constraints whose name happens to
   * contain the substring "idempotency" being silently
   * mis-classified and swallowed as a phantom replay.
   *
   * If a future migration adds another constraint this transaction
   * can legitimately collide on, extend the set here and NOWHERE
   * ELSE in the service.
   */
  private static readonly IDEMPOTENCY_UNIQUE_CONSTRAINTS: ReadonlySet<string> =
    new Set(['UQ_idempotency_keys_scoped']);

  /**
   * Robustly extract pg-style fields (SQLSTATE + constraint name)
   * across the pg driver and every TypeORM wrapper shape observed
   * in the codebase. Walks common nested wrappers
   * (`driverError`, `originalError`, `cause`) so a single call
   * returns the same values regardless of which layer surfaced the
   * error — e.g. typeorm's `QueryFailedError` carries the pg fields
   * on `.driverError`, and some pooled-connection paths nest another
   * level deeper under `.originalError`.
   */
  private extractPgErrorFields(err: any): {
    code: string | undefined;
    constraint: string | undefined;
  } {
    let code: string | undefined;
    let constraint: string | undefined;
    const seen = new Set<any>();
    let node: any = err;
    while (node && typeof node === 'object' && !seen.has(node)) {
      seen.add(node);
      if (!code && typeof node.code === 'string') code = node.code;
      if (!constraint && typeof node.constraint === 'string') {
        constraint = node.constraint;
      }
      if (code && constraint) break;
      node = node.driverError ?? node.originalError ?? node.cause ?? null;
    }
    return { code, constraint };
  }

  /**
   * True iff the thrown error is a Postgres unique-constraint
   * violation from the *specific* scoped idempotency_keys index.
   *
   * - SQLSTATE must be exactly `23505`.
   * - Constraint name, when available, must be in the exact
   *   allowlist. No substring / regex fallback — that was the prior
   *   false-positive surface.
   * - When pg omits the constraint field (older drivers, certain
   *   error paths), we refuse to guess and let the error propagate.
   *   This fails CLOSED for correctness: worst case is a visible
   *   error the client can retry on, never a silent replay that
   *   could leak or double-book.
   */
  private isIdempotencyUniqueViolation(err: any): boolean {
    if (!err) return false;
    const { code, constraint } = this.extractPgErrorFields(err);
    if (code !== '23505') return false;
    if (!constraint) return false;
    return OrdersService.IDEMPOTENCY_UNIQUE_CONSTRAINTS.has(constraint);
  }

  /**
   * Post-conflict replay with a very small bounded retry. Closes
   * the narrow read-after-write visibility window where the winner's
   * commit exists in Postgres but a follow-up read on our connection
   * has not yet seen it (same pool, snapshot lag, etc.). Two tries
   * with jittered backoff is sufficient in practice; past that we
   * surface a 409 so the client retries with the same key instead
   * of leaking a 500.
   *
   * Jitter is bypassed under `NODE_ENV === 'test'` so unit tests
   * are deterministic and zero-wait.
   */
  private async replayScopedOrderWithRetry(
    idempotencyKey: string,
    user: any,
    callerStoreId: string | null,
  ): Promise<{ order: Order; alreadyExisted: boolean } | null> {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const replay = await this.replayScopedOrder(
        idempotencyKey,
        user,
        callerStoreId,
      );
      if (replay) return replay;
      if (attempt < maxAttempts - 1) {
        await this.replayBackoff(attempt);
      }
    }
    return null;
  }

  /**
   * Extracted for testability: jittered backoff between replay
   * attempts. Zero-wait under NODE_ENV=test so the retry unit tests
   * run instantly and are not flaky.
   */
  protected replayBackoff(attempt: number): Promise<void> {
    if (process.env.NODE_ENV === 'test') return Promise.resolve();
    const base = 5; // ms
    const jitter = Math.floor(Math.random() * 6); // 0..5ms
    const delay = base * (attempt + 1) + jitter;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private findOrderScoped(id: string, user: any): Promise<Order> {
    const where: any = { id };
    const storeId = this.enforceStoreScope(user);
    if (storeId) where.store_id = storeId;
    return this.orderRepo.findOne({ where, relations: ['items'] }).then(order => {
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      return order;
    });
  }

  async confirmOrder(id: string, user?: any): Promise<Order> {
    const order = await this.findOrderScoped(id, user || {});
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        `Cannot confirm order in status '${order.status}'. Must be 'pending'.`,
      );
    }
    order.status = OrderStatus.CONFIRMED;
    return this.orderRepo.save(order);
  }

  async fulfillOrder(id: string, user?: any): Promise<Order> {
    const order = await this.findOrderScoped(id, user || {});
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new ConflictException(
        `Cannot fulfill order in status '${order.status}'. Must be 'confirmed'.`,
      );
    }
    order.status = OrderStatus.FULFILLED;
    return this.orderRepo.save(order);
  }

  async cancelOrder(id: string, user?: any): Promise<Order> {
    const order = await this.findOrderScoped(id, user || {});
    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CONFIRMED
    ) {
      throw new ConflictException(
        `Cannot cancel order in status '${order.status}'. Must be 'pending' or 'confirmed'.`,
      );
    }
    order.status = OrderStatus.CANCELLED;
    return this.orderRepo.save(order);
  }

  async findAll(user: any): Promise<Order[]> {
    const storeId = this.enforceStoreScope(user);
    const where: any = {};
    if (storeId) where.store_id = storeId;
    return this.orderRepo.find({ where, relations: ['items'] });
  }

  async findById(id: string, user?: any): Promise<Order> {
    const order = await this.findOrderScoped(id, user || {});
    if (order.internal_notes && this.encryptionService.isEncrypted(order.internal_notes)) {
      order.internal_notes = this.encryptionService.decrypt(order.internal_notes);
    }
    return order;
  }

  // Cleanup idempotency keys older than 24 hours
  private readonly logger = new Logger(OrdersService.name);

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredIdempotencyKeys(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.idempotencyRepo.delete({
      created_at: LessThan(cutoff),
    });
    if (result.affected > 0) {
      this.logger.log(`Cleaned up ${result.affected} expired idempotency keys`);
    }
  }
}
