import {
  Injectable,
  NotFoundException,
  Logger,
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

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(InventoryLot)
    private readonly lotRepo: Repository<InventoryLot>,
    @InjectRepository(InventoryAdjustment)
    private readonly adjustmentRepo: Repository<InventoryAdjustment>,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /* ── Lots ── */

  async createLot(dto: CreateLotDto): Promise<InventoryLot> {
    const lot = this.lotRepo.create({
      sku_id: dto.skuId,
      batch_code: dto.batchCode,
      expiration_date: dto.expirationDate ?? null,
      quantity: dto.quantity,
    });
    return this.lotRepo.save(lot);
  }

  async findAllLots(skuId?: string): Promise<InventoryLot[]> {
    const where: any = {};
    if (skuId) where.sku_id = skuId;
    return this.lotRepo.find({ where, relations: ['sku'] });
  }

  async findLotById(id: string): Promise<InventoryLot> {
    const lot = await this.lotRepo.findOne({ where: { id }, relations: ['sku'] });
    if (!lot) throw new NotFoundException(`Lot ${id} not found`);
    return lot;
  }

  async updateLot(
    id: string,
    updates: Partial<Pick<InventoryLot, 'batch_code' | 'expiration_date' | 'quantity'>>,
  ): Promise<InventoryLot> {
    const lot = await this.findLotById(id);
    Object.assign(lot, updates);
    return this.lotRepo.save(lot);
  }

  /* ── Stock Adjustment ── */

  async adjustStock(
    dto: AdjustStockDto,
    userId: string,
  ): Promise<{ adjustment: InventoryAdjustment; alreadyExisted: boolean }> {
    const existing = await this.adjustmentRepo.findOne({
      where: { idempotency_key: dto.idempotencyKey },
    });
    if (existing) {
      return { adjustment: existing, alreadyExisted: true };
    }

    const lot = await this.findLotById(dto.lotId);
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
