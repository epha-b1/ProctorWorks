import {
  Injectable,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { CreateLotDto } from './dto/create-lot.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { Sku } from '../products/entities/sku.entity';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(InventoryLot)
    private readonly lotRepo: Repository<InventoryLot>,
    @InjectRepository(InventoryAdjustment)
    private readonly adjustmentRepo: Repository<InventoryAdjustment>,
    @InjectRepository(Sku)
    private readonly skuRepo: Repository<Sku>,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private getUserStoreId(user: any): string | null {
    return user?.storeId ?? user?.store_id ?? null;
  }

  private resolveStoreScope(user: any): string | null {
    if (user?.role === 'store_admin') {
      const storeId = this.getUserStoreId(user);
      if (!storeId) {
        throw new ForbiddenException('Store admin has no assigned store');
      }
      return storeId;
    }
    return null;
  }

  /* ── Lots ── */

  async createLot(dto: CreateLotDto, user: any): Promise<InventoryLot> {
    const storeId = this.resolveStoreScope(user);
    if (storeId) {
      const scopedSku = await this.skuRepo
        .createQueryBuilder('sku')
        .innerJoin('sku.product', 'product')
        .where('sku.id = :skuId', { skuId: dto.skuId })
        .andWhere('product.store_id = :storeId', { storeId })
        .getOne();
      if (!scopedSku) {
        throw new NotFoundException(`SKU ${dto.skuId} not found`);
      }
    }

    const lot = this.lotRepo.create({
      sku_id: dto.skuId,
      batch_code: dto.batchCode,
      expiration_date: dto.expirationDate ?? null,
      quantity: dto.quantity,
    });
    return this.lotRepo.save(lot);
  }

  async findAllLots(user: any, skuId?: string): Promise<InventoryLot[]> {
    const storeId = this.resolveStoreScope(user);
    const qb = this.lotRepo
      .createQueryBuilder('lot')
      .leftJoinAndSelect('lot.sku', 'sku')
      .leftJoin('sku.product', 'product');

    if (skuId) qb.andWhere('lot.sku_id = :skuId', { skuId });
    if (storeId) qb.andWhere('product.store_id = :storeId', { storeId });

    return qb.getMany();
  }

  async findLotById(id: string, user?: any): Promise<InventoryLot> {
    const storeId = this.resolveStoreScope(user);
    const qb = this.lotRepo
      .createQueryBuilder('lot')
      .leftJoinAndSelect('lot.sku', 'sku')
      .leftJoin('sku.product', 'product')
      .where('lot.id = :id', { id });

    if (storeId) qb.andWhere('product.store_id = :storeId', { storeId });

    const lot = await qb.getOne();
    if (!lot) throw new NotFoundException(`Lot ${id} not found`);
    return lot;
  }

  async updateLot(
    id: string,
    updates: Partial<Pick<InventoryLot, 'batch_code' | 'expiration_date' | 'quantity'>>,
    user: any,
  ): Promise<InventoryLot> {
    const lot = await this.findLotById(id, user);
    Object.assign(lot, updates);
    return this.lotRepo.save(lot);
  }

  /* ── Stock Adjustment ── */

  async adjustStock(
    dto: AdjustStockDto,
    userId: string,
    user: any,
  ): Promise<{ adjustment: InventoryAdjustment; alreadyExisted: boolean }> {
    this.resolveStoreScope(user);

    const existing = await this.adjustmentRepo.findOne({
      where: { idempotency_key: dto.idempotencyKey },
    });
    if (existing) {
      await this.findLotById(existing.lot_id, user);
      return { adjustment: existing, alreadyExisted: true };
    }

    const lot = await this.findLotById(dto.lotId, user);
    lot.quantity += dto.delta;
    await this.lotRepo.save(lot);

    const adjustment = this.adjustmentRepo.create({
      lot_id: dto.lotId,
      delta: dto.delta,
      reason_code: dto.reasonCode,
      idempotency_key: dto.idempotencyKey,
      adjusted_by: userId,
    });
    const saved = await this.adjustmentRepo.save(adjustment);

    // Check low stock threshold — persist notification
    const threshold = this.configService.get<number>('lowStockThreshold', 10);
    if (lot.quantity < threshold && lot.quantity >= 0) {
      this.logger.warn(
        `Low stock: Lot ${lot.id} (SKU ${lot.sku_id}) has ${lot.quantity} units (threshold: ${threshold})`,
      );
      await this.notificationsService.createForAdmins(
        'low_stock',
        `Low stock alert: Lot ${lot.id} (SKU ${lot.sku_id}) has ${lot.quantity} units, below threshold of ${threshold}.`,
      );
    }

    return { adjustment: saved, alreadyExisted: false };
  }

  /* ── Cron Jobs ── */

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpiringLots(): Promise<void> {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const dateStr = sevenDaysFromNow.toISOString().split('T')[0];

    const expiringLots = await this.lotRepo.find({
      where: { expiration_date: LessThanOrEqual(dateStr) },
      relations: ['sku'],
    });

    for (const lot of expiringLots) {
      if (lot.quantity > 0) {
        this.logger.warn(
          `Expiring lot: ${lot.id} (batch ${lot.batch_code}) expires ${lot.expiration_date} with ${lot.quantity} units`,
        );
        await this.notificationsService.createForAdmins(
          'expiring_inventory',
          `Lot ${lot.id} (batch ${lot.batch_code}) expires on ${lot.expiration_date} with ${lot.quantity} units remaining.`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkLowStock(): Promise<void> {
    const threshold = this.configService.get<number>('lowStockThreshold', 10);
    const lots = await this.lotRepo
      .createQueryBuilder('lot')
      .where('lot.quantity < :threshold', { threshold })
      .andWhere('lot.quantity > 0')
      .getMany();

    for (const lot of lots) {
      this.logger.warn(
        `Low stock: Lot ${lot.id} (SKU ${lot.sku_id}) has ${lot.quantity} units`,
      );
      await this.notificationsService.createForAdmins(
        'low_stock',
        `Low stock: Lot ${lot.id} (SKU ${lot.sku_id}) has ${lot.quantity} units (threshold: ${threshold}).`,
      );
    }
  }
}
