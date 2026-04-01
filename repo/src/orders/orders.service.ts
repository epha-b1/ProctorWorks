import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Sku } from '../products/entities/sku.entity';
import { CreateOrderDto } from './dto/create-order.dto';

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
  ) {}

  private enforceStoreScope(user: any): string | null {
    if (user.role === 'store_admin') {
      if (!user.store_id) {
        throw new ForbiddenException('Store admin has no assigned store');
      }
      return user.store_id;
    }
    return null;
  }

  async createOrder(
    dto: CreateOrderDto,
    user: any,
  ): Promise<{ order: Order; alreadyExisted: boolean }> {
    // 1. Idempotency check
    const existingKey = await this.idempotencyRepo.findOne({
      where: { key: dto.idempotencyKey },
    });
    if (existingKey) {
      const existingOrder = await this.orderRepo.findOne({
        where: { idempotency_key: dto.idempotencyKey },
        relations: ['items'],
      });
      return { order: existingOrder, alreadyExisted: true };
    }

    // 2. Look up SKU prices, compute subtotal
    const skuIds = dto.items.map((i) => i.skuId);
    const skus = await this.skuRepo
      .createQueryBuilder('sku')
      .whereInIds(skuIds)
      .getMany();

    const skuMap = new Map<string, Sku>();
    for (const sku of skus) {
      skuMap.set(sku.id, sku);
    }

    for (const item of dto.items) {
      if (!skuMap.has(item.skuId)) {
        throw new NotFoundException(`SKU ${item.skuId} not found`);
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

    // 3. Promotions/coupons placeholder (Slice 8)
    const discountCents = 0;
    const totalCents = subtotalCents - discountCents;

    const storeId = this.enforceStoreScope(user) || user.store_id;

    // 4. Create order + items in transaction
    return this.dataSource.transaction(async (manager) => {
      const order = manager.create(Order, {
        store_id: storeId,
        user_id: user.id,
        idempotency_key: dto.idempotencyKey,
        total_cents: totalCents,
        discount_cents: discountCents,
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

      // 5. Store idempotency record
      const idempotencyRecord = manager.create(IdempotencyKey, {
        key: dto.idempotencyKey,
        operation_type: 'create_order',
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

  async confirmOrder(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        `Cannot confirm order in status '${order.status}'. Must be 'pending'.`,
      );
    }
    order.status = OrderStatus.CONFIRMED;
    return this.orderRepo.save(order);
  }

  async fulfillOrder(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new ConflictException(
        `Cannot fulfill order in status '${order.status}'. Must be 'confirmed'.`,
      );
    }
    order.status = OrderStatus.FULFILLED;
    return this.orderRepo.save(order);
  }

  async cancelOrder(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
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

  async findById(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }
}
