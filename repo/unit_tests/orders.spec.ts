/// <reference types="jest" />
import { ConflictException } from '@nestjs/common';
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

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepo: ReturnType<typeof makeMockRepo>;
  let orderItemRepo: ReturnType<typeof makeMockRepo>;
  let idempotencyRepo: ReturnType<typeof makeMockRepo>;
  let skuRepo: ReturnType<typeof makeMockRepo>;
  let dataSource: ReturnType<typeof makeMockDataSource>;
  let manager: ReturnType<typeof makeMockManager>;

  beforeEach(() => {
    orderRepo = makeMockRepo();
    orderItemRepo = makeMockRepo();
    idempotencyRepo = makeMockRepo();
    skuRepo = makeMockRepo();
    manager = makeMockManager();
    dataSource = makeMockDataSource(manager);

    service = new OrdersService(
      orderRepo as any,
      orderItemRepo as any,
      idempotencyRepo as any,
      skuRepo as any,
      dataSource as any,
    );
  });

  // -----------------------------------------------------------------------
  // createOrder
  // -----------------------------------------------------------------------

  describe('createOrder', () => {
    const storeAdminUser = { id: 'user-1', role: 'store_admin', store_id: 'store-1' };

    it('creates order with correct total computed from SKU prices', async () => {
      // No existing idempotency key
      idempotencyRepo.findOne.mockResolvedValue(null);

      // Two SKUs with different prices
      const skuA = { id: 'sku-a', price_cents: 500, member_price_cents: null };
      const skuB = { id: 'sku-b', price_cents: 1200, member_price_cents: 1000 };

      const qb = {
        whereInIds: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([skuA, skuB]),
      };
      skuRepo.createQueryBuilder.mockReturnValue(qb);

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

    it('returns existing order when idempotency key already exists (dedup)', async () => {
      const existingOrder = buildOrder({ id: 'existing-order-id' });

      idempotencyRepo.findOne.mockResolvedValue({ key: 'dup-key' });
      orderRepo.findOne.mockResolvedValue(existingOrder);

      const dto = {
        idempotencyKey: 'dup-key',
        items: [{ skuId: 'sku-a', quantity: 1 }],
      };

      const result = await service.createOrder(dto, storeAdminUser);

      expect(result.alreadyExisted).toBe(true);
      expect(result.order).toBe(existingOrder);
      // Transaction should NOT have been invoked
      expect(dataSource.transaction).not.toHaveBeenCalled();
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
