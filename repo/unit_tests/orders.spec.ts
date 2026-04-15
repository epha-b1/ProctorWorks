/// <reference types="jest" />
import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { OrdersService } from '../src/orders/orders.service';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRepo() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function makeMockManager() {
  return {
    create: jest.fn((_Entity: any, plain: any) => ({ ...plain })),
    save: jest.fn(async (entity: any) => {
      if (Array.isArray(entity)) return entity.map((e: any) => ({ ...e, id: 'item-id' }));
      return { ...entity, id: 'order-uuid' };
    }),
    findOne: jest.fn(),
  };
}

function makeMockDataSource(manager: ReturnType<typeof makeMockManager>) {
  return {
    transaction: jest.fn(async (cb: (mgr: any) => Promise<any>) => cb(manager)),
  };
}

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-uuid',
    store_id: 'store-1',
    user_id: 'user-1',
    status: OrderStatus.PENDING,
    idempotency_key: 'idem-1',
    total_cents: 1000,
    discount_cents: 0,
    coupon_id: null as any,
    promotion_id: null as any,
    internal_notes: null as any,
    created_at: new Date(),
    updated_at: new Date(),
    items: [],
    ...overrides,
  } as Order;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HIGH-1 — Order entity must NOT carry `unique: true` on idempotency_key
// ---------------------------------------------------------------------------
//
// The previous schema enforced uniqueness on `orders.idempotency_key` at
// the table level (via `@Column({ unique: true })`). That conflicts with
// the scoped idempotency design — two callers in different stores can
// legitimately reuse the same opaque key. This test asserts the entity
// metadata so that any future regression that re-adds `unique: true`
// (or wraps the column in a single-column @Index({ unique: true }))
// fails fast in unit tests, before it ever reaches the migration layer.
describe('Order entity metadata', () => {
  it('idempotency_key column is not declared unique', () => {
    const storage = getMetadataArgsStorage();
    const col = storage.columns.find(
      (c) => c.target === Order && c.propertyName === 'idempotency_key',
    );
    expect(col).toBeDefined();
    // Either `unique` is not set OR explicitly false. Anything else
    // would re-introduce the global UNIQUE constraint that HIGH-1 fixed.
    const opts = (col!.options ?? {}) as Record<string, unknown>;
    expect(opts.unique === undefined || opts.unique === false).toBe(true);
  });

  it('no single-column unique @Index covers idempotency_key', () => {
    const storage = getMetadataArgsStorage();
    const offending = storage.indices.find((idx) => {
      if (idx.target !== Order) return false;
      if (!idx.unique) return false;
      const cols = Array.isArray(idx.columns) ? idx.columns : [];
      return cols.length === 1 && cols[0] === 'idempotency_key';
    });
    expect(offending).toBeUndefined();
  });
});

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepo: ReturnType<typeof makeMockRepo>;
  let orderItemRepo: ReturnType<typeof makeMockRepo>;
  let idempotencyRepo: ReturnType<typeof makeMockRepo>;
  let skuRepo: ReturnType<typeof makeMockRepo>;
  let dataSource: ReturnType<typeof makeMockDataSource>;
  let manager: ReturnType<typeof makeMockManager>;
  let encryptionService: {
    encrypt: jest.Mock;
    decrypt: jest.Mock;
    isEncrypted: jest.Mock;
  };
  let promotionsService: {
    resolvePromotions: jest.Mock;
  };

  beforeEach(() => {
    orderRepo = makeMockRepo();
    orderItemRepo = makeMockRepo();
    idempotencyRepo = makeMockRepo();
    skuRepo = makeMockRepo();
    manager = makeMockManager();
    dataSource = makeMockDataSource(manager);
    encryptionService = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
      isEncrypted: jest.fn((value: string) => value.startsWith('enc:')),
    };
    promotionsService = {
      resolvePromotions: jest.fn().mockResolvedValue({
        selectedPromotion: null,
        selectedCoupon: null,
        totalDiscount: 0,
      }),
    };

    service = new OrdersService(
      orderRepo as any,
      orderItemRepo as any,
      idempotencyRepo as any,
      skuRepo as any,
      dataSource as any,
      encryptionService as any,
      promotionsService as any,
    );
  });

  // -----------------------------------------------------------------------
  // createOrder
  // -----------------------------------------------------------------------

  describe('createOrder', () => {
    const storeAdminUser = { id: 'user-1', role: 'store_admin', store_id: 'store-1' };

    // ─────────────────────────────────────────────────────────────────
    // Helper: stub the SKU query-builder used by createOrder.
    //
    // After audit_report-2 P0-1 the lookup is:
    //
    //   skuRepo.createQueryBuilder('sku')
    //     .leftJoinAndSelect('sku.product', 'product')
    //     .where('sku.id IN (:...skuIds)', { skuIds })
    //     .getMany();
    //
    // so the mock chain has to expose those exact methods. Each row also
    // needs `product.store_id` populated because the store_admin
    // ownership guard reads it. Helper centralises that so individual
    // tests stay focused on the assertion they care about.
    function stubSkuQuery(rows: any[]) {
      const qb: any = {};
      qb.leftJoinAndSelect = jest.fn().mockReturnValue(qb);
      qb.where = jest.fn().mockReturnValue(qb);
      qb.whereInIds = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue(rows);
      skuRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    // Convenience: a SKU with its parent product attached, scoped to
    // the store-admin user used by all happy-path tests.
    function makeSkuInStore(
      id: string,
      priceCents: number,
      memberPriceCents: number | null,
      storeId: string,
    ) {
      return {
        id,
        price_cents: priceCents,
        member_price_cents: memberPriceCents,
        product_id: `prod-${id}`,
        product: { id: `prod-${id}`, store_id: storeId },
      };
    }

    it('creates order with correct total computed from SKU prices', async () => {
      // No existing idempotency key
      idempotencyRepo.findOne.mockResolvedValue(null);

      // Two SKUs with different prices, both in the caller's store.
      const skuA = makeSkuInStore('sku-a', 500, null, 'store-1');
      const skuB = makeSkuInStore('sku-b', 1200, 1000, 'store-1');
      stubSkuQuery([skuA, skuB]);

      const fullOrder = buildOrder({ total_cents: 2500, items: [] });
      manager.findOne.mockResolvedValue(fullOrder);

      const dto = {
        idempotencyKey: 'new-key',
        items: [
          { skuId: 'sku-a', quantity: 3 },  // 500 * 3 = 1500
          { skuId: 'sku-b', quantity: 1 },  // member_price 1000 * 1 = 1000
        ],
      };

      const result = await service.createOrder(dto, storeAdminUser);

      expect(result.alreadyExisted).toBe(false);
      expect(result.order).toBeDefined();

      // Verify manager.create was called with the correct total
      const orderCreateCall = manager.create.mock.calls.find(
        ([entity]: any) => entity === Order,
      );
      expect(orderCreateCall).toBeDefined();
      expect(orderCreateCall![1]).toMatchObject({
        total_cents: 2500, // 1500 + 1000
        discount_cents: 0,
        status: OrderStatus.PENDING,
        store_id: 'store-1',
        user_id: 'user-1',
      });
    });

    it('returns existing order when scoped idempotency key already exists (dedup)', async () => {
      // Stored idempotency row carries the orderId in response_body
      // and is bound to the same actor + store as the new request.
      // Lookup must walk the scoped index and resolve back to the same
      // order without re-running the full create transaction.
      const existingOrder = buildOrder({
        id: 'existing-order-id',
        store_id: 'store-1',
        user_id: 'user-1',
      });

      idempotencyRepo.findOne.mockResolvedValue({
        id: 'idem-row-id',
        operation_type: 'create_order',
        actor_id: 'user-1',
        store_id: 'store-1',
        key: 'dup-key',
        response_body: { orderId: 'existing-order-id' },
      });
      orderRepo.findOne.mockResolvedValue(existingOrder);

      const dto = {
        idempotencyKey: 'dup-key',
        items: [{ skuId: 'sku-a', quantity: 1 }],
      };

      const result = await service.createOrder(dto, storeAdminUser);

      expect(result.alreadyExisted).toBe(true);
      expect(result.order).toBe(existingOrder);
      // Critical: lookup is by orderId (from response_body), NOT by
      // raw idempotency_key — that was the leak surface.
      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'existing-order-id' },
        relations: ['items'],
      });
      // Idempotency lookup is scoped by operation + actor + store + key.
      expect(idempotencyRepo.findOne).toHaveBeenCalledWith({
        where: {
          operation_type: 'create_order',
          actor_id: 'user-1',
          store_id: 'store-1',
          key: 'dup-key',
        },
      });
      // Transaction should NOT have been invoked on the dedup path.
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    // ─────────────────────────────────────────────────────────────────
    // audit_report-1 §5.4 — cross-tenant key collision must NOT serve
    // a foreign actor / store the existing order. The scoped lookup
    // is the primary guard, but we also defensively re-check the
    // resolved order's store_id + user_id before returning.
    // ─────────────────────────────────────────────────────────────────
    it('does NOT return foreign-store order on scoped idempotency lookup miss', async () => {
      // The scoped lookup with (actor=user-1, store=store-1) returns
      // null — there is no row for THIS scope. The legacy unscoped
      // path would have matched a row in store-2 here, leaking it.
      idempotencyRepo.findOne.mockResolvedValue(null);

      const skuA = makeSkuInStore('sku-a', 500, null, 'store-1');
      stubSkuQuery([skuA]);
      manager.findOne.mockResolvedValue(buildOrder({ id: 'fresh-order-id' }));

      const dto = {
        idempotencyKey: 'reused-key',
        items: [{ skuId: 'sku-a', quantity: 1 }],
      };

      const result = await service.createOrder(dto, storeAdminUser);

      // A brand-new order is created, and the foreign tenant's row is
      // never even fetched.
      expect(result.alreadyExisted).toBe(false);
      expect(orderRepo.findOne).not.toHaveBeenCalled();
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('refuses to return order whose store_id mismatches caller scope (defense-in-depth)', async () => {
      // Forced edge case: somehow a row with our scope key resolves to
      // an order whose store_id is NOT ours (e.g. legacy un-backfilled
      // row, or migration anomaly). The service must refuse the leak.
      idempotencyRepo.findOne.mockResolvedValue({
        id: 'idem-row-id',
        operation_type: 'create_order',
        actor_id: 'user-1',
        store_id: 'store-1',
        key: 'leaky-key',
        response_body: { orderId: 'foreign-order-id' },
      });
      orderRepo.findOne.mockResolvedValue(
        buildOrder({
          id: 'foreign-order-id',
          store_id: 'store-FOREIGN',
          user_id: 'user-1',
        }),
      );

      await expect(
        service.createOrder(
          {
            idempotencyKey: 'leaky-key',
            items: [{ skuId: 'sku-a', quantity: 1 }],
          },
          storeAdminUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to return order whose user_id mismatches caller (defense-in-depth)', async () => {
      // Same store, but a different actor's row. The service must refuse.
      idempotencyRepo.findOne.mockResolvedValue({
        id: 'idem-row-id',
        operation_type: 'create_order',
        actor_id: 'user-1',
        store_id: 'store-1',
        key: 'shared-key',
        response_body: { orderId: 'other-user-order-id' },
      });
      orderRepo.findOne.mockResolvedValue(
        buildOrder({
          id: 'other-user-order-id',
          store_id: 'store-1',
          user_id: 'user-OTHER',
        }),
      );

      await expect(
        service.createOrder(
          {
            idempotencyKey: 'shared-key',
            items: [{ skuId: 'sku-a', quantity: 1 }],
          },
          storeAdminUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('applies resolved promotion and coupon discount to totals', async () => {
      idempotencyRepo.findOne.mockResolvedValue(null);

      const skuA = makeSkuInStore('sku-a', 1000, null, 'store-1');
      stubSkuQuery([skuA]);

      promotionsService.resolvePromotions.mockResolvedValue({
        selectedPromotion: { id: 'promo-1' },
        selectedCoupon: { id: 'coupon-1' },
        totalDiscount: 250,
      });

      manager.findOne.mockResolvedValue(buildOrder({ total_cents: 750 }));

      await service.createOrder(
        {
          idempotencyKey: 'promo-key',
          couponCode: 'SAVE10',
          items: [{ skuId: 'sku-a', quantity: 1 }],
        },
        storeAdminUser,
      );

      const orderCreateCall = manager.create.mock.calls.find(
        ([entity]: any) => entity === Order,
      );

      expect(promotionsService.resolvePromotions).toHaveBeenCalledWith(
        1000,
        'user-1',
        'store-1',
        'SAVE10',
      );
      expect(orderCreateCall![1]).toMatchObject({
        total_cents: 750,
        discount_cents: 250,
        promotion_id: 'promo-1',
        coupon_id: 'coupon-1',
      });
    });

    // ─────────────────────────────────────────────────────────────────
    // audit_report-2 P0-1: store-bound SKU ownership in createOrder.
    //
    // store_admin must only be able to order SKUs whose parent product
    // belongs to their own store. Out-of-store SKUs surface as 404 to
    // match the hiding policy used for paper/question reads — never
    // 403, so a probing caller can't tell whether a SKU id exists in
    // another store. No order row is persisted on the denied path.
    // ─────────────────────────────────────────────────────────────────
    describe('P0-1: store-bound SKU ownership', () => {
      it('store_admin: foreign-store SKU → NotFoundException, no transaction', async () => {
        idempotencyRepo.findOne.mockResolvedValue(null);
        // SKU exists, but its parent product is in a different store.
        const foreignSku = makeSkuInStore('sku-foreign', 999, null, 'store-OTHER');
        stubSkuQuery([foreignSku]);

        await expect(
          service.createOrder(
            {
              idempotencyKey: 'cross-store-sku',
              items: [{ skuId: 'sku-foreign', quantity: 1 }],
            },
            storeAdminUser,
          ),
        ).rejects.toThrow(NotFoundException);

        // Defense in depth: nothing was persisted, no order row was
        // created, no idempotency record landed.
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('store_admin: SKU with no product → NotFoundException', async () => {
        // Edge case: a SKU row exists but its product join is null.
        // We must NOT silently treat that as in-scope. Treat it as
        // "missing" — same hiding policy.
        idempotencyRepo.findOne.mockResolvedValue(null);
        const orphanSku = {
          id: 'sku-orphan',
          price_cents: 100,
          member_price_cents: null,
          product_id: null,
          product: null,
        };
        stubSkuQuery([orphanSku]);

        await expect(
          service.createOrder(
            {
              idempotencyKey: 'orphan-sku',
              items: [{ skuId: 'sku-orphan', quantity: 1 }],
            },
            storeAdminUser,
          ),
        ).rejects.toThrow(NotFoundException);

        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('store_admin: own-store SKU → order is created normally', async () => {
        idempotencyRepo.findOne.mockResolvedValue(null);
        const ownSku = makeSkuInStore('sku-own', 1500, null, 'store-1');
        stubSkuQuery([ownSku]);
        manager.findOne.mockResolvedValue(buildOrder({ id: 'fresh-id' }));

        const result = await service.createOrder(
          {
            idempotencyKey: 'own-store-key',
            items: [{ skuId: 'sku-own', quantity: 1 }],
          },
          storeAdminUser,
        );

        expect(result.alreadyExisted).toBe(false);
        expect(dataSource.transaction).toHaveBeenCalled();
      });

      it('store_admin: mixed cart with one foreign SKU → entire order rejected', async () => {
        // Even if 4 of 5 items are in scope, one foreign SKU must
        // tank the whole request. Partial-success would leak which
        // SKU ids exist outside the caller's store.
        idempotencyRepo.findOne.mockResolvedValue(null);
        const ownSku = makeSkuInStore('sku-own', 100, null, 'store-1');
        const foreignSku = makeSkuInStore('sku-foreign', 100, null, 'store-OTHER');
        stubSkuQuery([ownSku, foreignSku]);

        await expect(
          service.createOrder(
            {
              idempotencyKey: 'mixed-cart',
              items: [
                { skuId: 'sku-own', quantity: 1 },
                { skuId: 'sku-foreign', quantity: 1 },
              ],
            },
            storeAdminUser,
          ),
        ).rejects.toThrow(NotFoundException);

        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      // ─────────────────────────────────────────────────────────────────
      // Race-safety — concurrent duplicate requests must NOT 500.
      //
      // The scoped idempotency INSERT is the only unique constraint
      // this path can collide on. Pre-fix, the service returned the
      // raw pg `QueryFailedError` (SQLSTATE 23505), which the global
      // exception filter converted to a 500. Post-fix, the service
      // catches the unique violation, rolls the loser's transaction
      // back, and resolves through the same scoped-replay lookup the
      // happy-path pre-check uses — so the second call observes the
      // winner's order with `alreadyExisted: true`, same as if it had
      // arrived strictly after the winner committed.
      //
      // This test proves that contract without a real DB: the
      // transaction mock fires a synthetic 23505, and the second
      // idempotencyRepo.findOne — representing the winner's committed
      // row — serves the resolved order through the replay path.
      // ─────────────────────────────────────────────────────────────────
      describe('race-safety: concurrent idempotent duplicates', () => {
        it('unique-violation on idempotency INSERT resolves via scoped replay, not 500', async () => {
          // Pre-check miss: no existing row at first.
          const winningOrder = buildOrder({
            id: 'winner-order',
            store_id: 'store-1',
            user_id: 'user-1',
          });
          idempotencyRepo.findOne
            .mockResolvedValueOnce(null) // pre-check (our caller)
            .mockResolvedValueOnce({
              // post-conflict replay: the winner has committed.
              id: 'idem-row-id',
              operation_type: 'create_order',
              actor_id: 'user-1',
              store_id: 'store-1',
              key: 'race-key',
              response_body: { orderId: 'winner-order' },
            });
          orderRepo.findOne.mockResolvedValue(winningOrder);

          const skuA = makeSkuInStore('sku-a', 500, null, 'store-1');
          stubSkuQuery([skuA]);

          // Transaction throws a synthetic pg-style unique violation
          // from the idempotency INSERT. Everything inside the
          // transaction has therefore rolled back.
          const pgUniqueViolation: any = new Error(
            'duplicate key value violates unique constraint "UQ_idempotency_keys_scoped"',
          );
          pgUniqueViolation.code = '23505';
          pgUniqueViolation.constraint = 'UQ_idempotency_keys_scoped';
          dataSource.transaction.mockImplementationOnce(async () => {
            throw pgUniqueViolation;
          });

          const result = await service.createOrder(
            {
              idempotencyKey: 'race-key',
              items: [{ skuId: 'sku-a', quantity: 1 }],
            },
            storeAdminUser,
          );

          // The loser returns the WINNER's order as a dedup — not 500.
          expect(result.alreadyExisted).toBe(true);
          expect(result.order).toBe(winningOrder);
          // Replay went through the scoped lookup, not a raw-key path.
          expect(idempotencyRepo.findOne).toHaveBeenNthCalledWith(2, {
            where: {
              operation_type: 'create_order',
              actor_id: 'user-1',
              store_id: 'store-1',
              key: 'race-key',
            },
          });
          // Order resolved via id (from response_body), not raw key.
          expect(orderRepo.findOne).toHaveBeenCalledWith({
            where: { id: 'winner-order' },
            relations: ['items'],
          });
        });

        it('unique-violation on driverError.code path (typeorm wrapping) still resolves to replay', async () => {
          // Older / wrapped typeorm versions surface the SQLSTATE on
          // `err.driverError.code` rather than `err.code`. The guard
          // must accept both so upgrades do not silently regress the
          // 500→replay behaviour.
          idempotencyRepo.findOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'idem-row-id',
              operation_type: 'create_order',
              actor_id: 'user-1',
              store_id: 'store-1',
              key: 'race-key-wrapped',
              response_body: { orderId: 'winner-order-2' },
            });
          orderRepo.findOne.mockResolvedValue(
            buildOrder({
              id: 'winner-order-2',
              store_id: 'store-1',
              user_id: 'user-1',
            }),
          );
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const wrapped: any = new Error('QueryFailedError');
          wrapped.driverError = {
            code: '23505',
            constraint: 'UQ_idempotency_keys_scoped',
          };
          dataSource.transaction.mockImplementationOnce(async () => {
            throw wrapped;
          });

          const result = await service.createOrder(
            {
              idempotencyKey: 'race-key-wrapped',
              items: [{ skuId: 'sku-a', quantity: 1 }],
            },
            storeAdminUser,
          );
          expect(result.alreadyExisted).toBe(true);
          expect(result.order.id).toBe('winner-order-2');
        });

        it('non-idempotency unique violation is NOT swallowed — propagates as-is', async () => {
          // A future migration could introduce a different UNIQUE
          // constraint on some column we insert into inside the
          // transaction. Our catch MUST only handle the scoped
          // idempotency index; anything else is a real bug and must
          // surface, not get silently converted to a phantom replay.
          idempotencyRepo.findOne.mockResolvedValueOnce(null);
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const someOtherViolation: any = new Error(
            'duplicate key value violates unique constraint "UQ_some_other_thing"',
          );
          someOtherViolation.code = '23505';
          someOtherViolation.constraint = 'UQ_some_other_thing';
          dataSource.transaction.mockImplementationOnce(async () => {
            throw someOtherViolation;
          });

          await expect(
            service.createOrder(
              {
                idempotencyKey: 'unrelated-key',
                items: [{ skuId: 'sku-a', quantity: 1 }],
              },
              storeAdminUser,
            ),
          ).rejects.toThrow(/UQ_some_other_thing/);
        });

        // ─────────────────────────────────────────────────────────────
        // Hardening: the allowlist is EXACT NAMES, not a substring
        // regex. A future unrelated constraint whose name happens to
        // contain the substring "idempotency" must NOT be silently
        // classified as a replay. Prior implementation used
        // /idempotency/i and would have treated this as a replay —
        // this test is the regression guard.
        // ─────────────────────────────────────────────────────────────
        it('23505 on a DIFFERENT constraint whose name contains "idempotency" still propagates', async () => {
          idempotencyRepo.findOne.mockResolvedValueOnce(null);
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const lookalike: any = new Error(
            'duplicate key value violates unique constraint "UQ_future_idempotency_thing"',
          );
          lookalike.code = '23505';
          // Contains "idempotency" but is NOT in the exact allowlist.
          // A regex substring match would have mis-classified this as
          // a replay; the hardened guard must reject it.
          lookalike.constraint = 'UQ_future_idempotency_thing';
          dataSource.transaction.mockImplementationOnce(async () => {
            throw lookalike;
          });

          await expect(
            service.createOrder(
              {
                idempotencyKey: 'lookalike-key',
                items: [{ skuId: 'sku-a', quantity: 1 }],
              },
              storeAdminUser,
            ),
          ).rejects.toThrow(/UQ_future_idempotency_thing/);
        });

        // ─────────────────────────────────────────────────────────────
        // Hardening: constraint field absent is treated as UNKNOWN,
        // not silently accepted as idempotency. Prior implementation
        // returned `true` in this branch on the assumption it was the
        // only unique index reachable; the hardened guard fails
        // closed and propagates so nothing unknown is silently
        // replayed.
        // ─────────────────────────────────────────────────────────────
        it('23505 with NO constraint field propagates (fails closed)', async () => {
          idempotencyRepo.findOne.mockResolvedValueOnce(null);
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const bareViolation: any = new Error(
            'duplicate key (no constraint name in driver output)',
          );
          bareViolation.code = '23505';
          // No .constraint — older driver path.
          dataSource.transaction.mockImplementationOnce(async () => {
            throw bareViolation;
          });

          await expect(
            service.createOrder(
              {
                idempotencyKey: 'bare-key',
                items: [{ skuId: 'sku-a', quantity: 1 }],
              },
              storeAdminUser,
            ),
          ).rejects.toThrow(/no constraint name/);
        });

        // ─────────────────────────────────────────────────────────────
        // Hardening: nested wrapper shapes (driverError, originalError,
        // cause) are walked robustly. Some pooled-connection paths
        // nest the pg fields one or two levels deeper than
        // QueryFailedError's top-level .driverError.
        // ─────────────────────────────────────────────────────────────
        it('recognises pg fields when nested under driverError.originalError (deep wrapper)', async () => {
          const winningOrder = buildOrder({
            id: 'nested-winner',
            store_id: 'store-1',
            user_id: 'user-1',
          });
          idempotencyRepo.findOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'idem-row-id',
              operation_type: 'create_order',
              actor_id: 'user-1',
              store_id: 'store-1',
              key: 'nested-key',
              response_body: { orderId: 'nested-winner' },
            });
          orderRepo.findOne.mockResolvedValue(winningOrder);
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const nested: any = new Error('QueryFailedError');
          nested.driverError = {
            // Outer driverError carries neither the code nor the
            // constraint — the real pg error is one more level deep
            // on `.originalError`. The extractor must walk down.
            originalError: {
              code: '23505',
              constraint: 'UQ_idempotency_keys_scoped',
            },
          };
          dataSource.transaction.mockImplementationOnce(async () => {
            throw nested;
          });

          const result = await service.createOrder(
            {
              idempotencyKey: 'nested-key',
              items: [{ skuId: 'sku-a', quantity: 1 }],
            },
            storeAdminUser,
          );
          expect(result.alreadyExisted).toBe(true);
          expect(result.order.id).toBe('nested-winner');
        });

        it('recognises pg fields when nested under cause (alternative wrapper)', async () => {
          idempotencyRepo.findOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'idem-row-id',
              operation_type: 'create_order',
              actor_id: 'user-1',
              store_id: 'store-1',
              key: 'cause-key',
              response_body: { orderId: 'cause-winner' },
            });
          orderRepo.findOne.mockResolvedValue(
            buildOrder({
              id: 'cause-winner',
              store_id: 'store-1',
              user_id: 'user-1',
            }),
          );
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const causeWrapped: any = new Error('wrapped');
          causeWrapped.cause = {
            code: '23505',
            constraint: 'UQ_idempotency_keys_scoped',
          };
          dataSource.transaction.mockImplementationOnce(async () => {
            throw causeWrapped;
          });

          const result = await service.createOrder(
            {
              idempotencyKey: 'cause-key',
              items: [{ skuId: 'sku-a', quantity: 1 }],
            },
            storeAdminUser,
          );
          expect(result.alreadyExisted).toBe(true);
        });

        // ─────────────────────────────────────────────────────────────
        // Bounded retry: the first replay attempt misses (tiny
        // read-after-write window), the second attempt succeeds. This
        // is the hardening that closes the prior 409-on-visibility-gap
        // risk for the common case.
        // ─────────────────────────────────────────────────────────────
        it('bounded retry: replay succeeds on the SECOND attempt → returns winner, not 409', async () => {
          const winningOrder = buildOrder({
            id: 'retry-winner',
            store_id: 'store-1',
            user_id: 'user-1',
          });
          idempotencyRepo.findOne
            .mockResolvedValueOnce(null) // pre-check
            .mockResolvedValueOnce(null) // retry attempt 1 — still invisible
            .mockResolvedValueOnce({
              // retry attempt 2 — now visible
              id: 'idem-row-id',
              operation_type: 'create_order',
              actor_id: 'user-1',
              store_id: 'store-1',
              key: 'retry-key',
              response_body: { orderId: 'retry-winner' },
            });
          orderRepo.findOne.mockResolvedValue(winningOrder);
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const pgUniqueViolation: any = new Error('dup');
          pgUniqueViolation.code = '23505';
          pgUniqueViolation.constraint = 'UQ_idempotency_keys_scoped';
          dataSource.transaction.mockImplementationOnce(async () => {
            throw pgUniqueViolation;
          });

          const result = await service.createOrder(
            {
              idempotencyKey: 'retry-key',
              items: [{ skuId: 'sku-a', quantity: 1 }],
            },
            storeAdminUser,
          );

          expect(result.alreadyExisted).toBe(true);
          expect(result.order.id).toBe('retry-winner');
          // Exactly three findOne calls: pre-check + two retry attempts.
          expect(idempotencyRepo.findOne).toHaveBeenCalledTimes(3);
        });

        it('bounded retry: BOTH attempts miss → ConflictException (not 500)', async () => {
          // Extreme pathological case: the winner's row is not
          // visible even after the bounded retry. We must NOT leak a
          // 500 — we surface a retry-safe 409 so clients hit the same
          // idempotency key again and observe the now-committed
          // winner at the application layer.
          idempotencyRepo.findOne
            .mockResolvedValueOnce(null) // pre-check
            .mockResolvedValueOnce(null) // retry 1
            .mockResolvedValueOnce(null); // retry 2
          stubSkuQuery([makeSkuInStore('sku-a', 500, null, 'store-1')]);

          const pgUniqueViolation: any = new Error('dup key');
          pgUniqueViolation.code = '23505';
          pgUniqueViolation.constraint = 'UQ_idempotency_keys_scoped';
          dataSource.transaction.mockImplementationOnce(async () => {
            throw pgUniqueViolation;
          });

          await expect(
            service.createOrder(
              {
                idempotencyKey: 'race-invisible',
                items: [{ skuId: 'sku-a', quantity: 1 }],
              },
              storeAdminUser,
            ),
          ).rejects.toThrow(ConflictException);
        });

        it('replayBackoff returns immediately under NODE_ENV=test', async () => {
          // Direct unit contract for the backoff short-circuit. The
          // retry unit tests above prove the END-TO-END flow resolves
          // without hanging; this test pins the local property that
          // enables it so a refactor that accidentally removes the
          // NODE_ENV guard shows up here, not as a slow unit suite.
          const prior = process.env.NODE_ENV;
          process.env.NODE_ENV = 'test';
          try {
            const before = Date.now();
            // Backoff is protected but reachable from this file via
            // the subclass of a service instance; reuse the local
            // `service` and invoke via bracket access to keep the
            // test free of "any" casts elsewhere.
            await (service as any).replayBackoff(0);
            await (service as any).replayBackoff(1);
            const elapsed = Date.now() - before;
            // Zero-wait should finish well inside 50ms even under
            // heavy CI load. If this ever flakes, the NODE_ENV
            // short-circuit is no longer active.
            expect(elapsed).toBeLessThan(50);
          } finally {
            process.env.NODE_ENV = prior;
          }
        });
      });

      it('platform_admin: cross-store SKU is allowed (existing behaviour preserved)', async () => {
        // platform_admin retains the cross-store admin capability.
        // This is the regression guard that proves the tightening is
        // store_admin-only and doesn't break the admin path.
        idempotencyRepo.findOne.mockResolvedValue(null);
        const skuFar = makeSkuInStore('sku-far', 200, null, 'store-X');
        stubSkuQuery([skuFar]);
        manager.findOne.mockResolvedValue(buildOrder({ id: 'platform-order' }));

        const platformAdmin = { id: 'pa-1', role: 'platform_admin' };
        const result = await service.createOrder(
          {
            idempotencyKey: 'pa-cross',
            items: [{ skuId: 'sku-far', quantity: 1 }],
          },
          platformAdmin,
        );

        expect(result.alreadyExisted).toBe(false);
        expect(dataSource.transaction).toHaveBeenCalled();
      });
    });
  });

  // -----------------------------------------------------------------------
  // confirmOrder
  // -----------------------------------------------------------------------

  describe('confirmOrder', () => {
    it('transitions pending → confirmed', async () => {
      const order = buildOrder({ status: OrderStatus.PENDING });
      orderRepo.findOne.mockResolvedValue(order);
      orderRepo.save.mockResolvedValue({ ...order, status: OrderStatus.CONFIRMED });

      const result = await service.confirmOrder('order-uuid');

      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(orderRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException when order is fulfilled', async () => {
      const order = buildOrder({ status: OrderStatus.FULFILLED });
      orderRepo.findOne.mockResolvedValue(order);

      await expect(service.confirmOrder('order-uuid')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when order is cancelled', async () => {
      const order = buildOrder({ status: OrderStatus.CANCELLED });
      orderRepo.findOne.mockResolvedValue(order);

      await expect(service.confirmOrder('order-uuid')).rejects.toThrow(ConflictException);
    });
  });

  // -----------------------------------------------------------------------
  // fulfillOrder
  // -----------------------------------------------------------------------

  describe('fulfillOrder', () => {
    it('transitions confirmed → fulfilled', async () => {
      const order = buildOrder({ status: OrderStatus.CONFIRMED });
      orderRepo.findOne.mockResolvedValue(order);
      orderRepo.save.mockResolvedValue({ ...order, status: OrderStatus.FULFILLED });

      const result = await service.fulfillOrder('order-uuid');

      expect(result.status).toBe(OrderStatus.FULFILLED);
      expect(orderRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException when order is pending', async () => {
      const order = buildOrder({ status: OrderStatus.PENDING });
      orderRepo.findOne.mockResolvedValue(order);

      await expect(service.fulfillOrder('order-uuid')).rejects.toThrow(ConflictException);
    });
  });

  // -----------------------------------------------------------------------
  // cancelOrder
  // -----------------------------------------------------------------------

  describe('cancelOrder', () => {
    it('transitions pending → cancelled', async () => {
      const order = buildOrder({ status: OrderStatus.PENDING });
      orderRepo.findOne.mockResolvedValue(order);
      orderRepo.save.mockResolvedValue({ ...order, status: OrderStatus.CANCELLED });

      const result = await service.cancelOrder('order-uuid');

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('transitions confirmed → cancelled', async () => {
      const order = buildOrder({ status: OrderStatus.CONFIRMED });
      orderRepo.findOne.mockResolvedValue(order);
      orderRepo.save.mockResolvedValue({ ...order, status: OrderStatus.CANCELLED });

      const result = await service.cancelOrder('order-uuid');

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('throws ConflictException when order is fulfilled', async () => {
      const order = buildOrder({ status: OrderStatus.FULFILLED });
      orderRepo.findOne.mockResolvedValue(order);

      await expect(service.cancelOrder('order-uuid')).rejects.toThrow(ConflictException);
    });
  });

  // -----------------------------------------------------------------------
  // findAll
  // -----------------------------------------------------------------------

  describe('findAll', () => {
    it('scopes results to store for store_admin', async () => {
      const orders = [buildOrder()];
      orderRepo.find.mockResolvedValue(orders);

      const user = { id: 'user-1', role: 'store_admin', store_id: 'store-1' };
      const result = await service.findAll(user);

      expect(result).toEqual(orders);
      expect(orderRepo.find).toHaveBeenCalledWith({
        where: { store_id: 'store-1' },
        relations: ['items'],
      });
    });

    it('returns all orders for platform_admin (no store scope)', async () => {
      const orders = [buildOrder(), buildOrder({ id: 'order-2', store_id: 'store-2' })];
      orderRepo.find.mockResolvedValue(orders);

      const user = { id: 'admin-1', role: 'platform_admin' };
      const result = await service.findAll(user);

      expect(result).toEqual(orders);
      expect(orderRepo.find).toHaveBeenCalledWith({
        where: {},
        relations: ['items'],
      });
    });
  });
});
