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

    const existingKey = await this.idempotencyRepo.findOne({
      where: {
        operation_type: 'create_order',
        actor_id: user.id,
        store_id: callerStoreId,
        key: dto.idempotencyKey,
      },
    });
    if (existingKey) {
      const orderId: string | undefined = existingKey.response_body?.orderId;
      if (orderId) {
        const existingOrder = await this.orderRepo.findOne({
          where: { id: orderId },
          relations: ['items'],
        });
        // Defense-in-depth: even if the index isn't trusted (e.g. a
        // legacy unscoped row was matched somehow), refuse to return
        // an order that doesn't belong to this caller's store.
        if (
          existingOrder &&
          (callerStoreId == null || existingOrder.store_id === callerStoreId) &&
          existingOrder.user_id === user.id
        ) {
          return { order: existingOrder, alreadyExisted: true };
        }
      }
      // Stored key with mismatched scope — refuse to leak. Treating
      // this as NotFound is the safest choice: the caller can retry
      // with a fresh key, and no foreign data is exposed.
      throw new NotFoundException(
        'Idempotency key exists but does not belong to this scope',
      );
    }

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

    // 4. Create order + items in transaction
    return this.dataSource.transaction(async (manager) => {
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
