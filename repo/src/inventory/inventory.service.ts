import {
  Injectable,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, DataSource } from 'typeorm';
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
    @InjectRepository(Sku)
    private readonly skuRepo: Repository<Sku>,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
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

  /**
   * Apply a stock delta to a lot with concurrency-safe idempotency.
   *
   * The flow runs inside a single transaction so that:
   *   1. The target lot row is locked (`SELECT ... FOR UPDATE`), serializing
   *      any concurrent adjusters of the same lot.
   *   2. The adjustment row is inserted via `INSERT ... ON CONFLICT DO NOTHING`
   *      against the unique `idempotency_key`. The unique constraint is the
   *      first-class de-duplication guard, and detection happens atomically
   *      with the insert — so the delta below is only ever applied on the
   *      path where the row was actually created.
   *   3. On a duplicate key, we return the previously persisted adjustment
   *      WITHOUT mutating the lot quantity (no drift under N concurrent
   *      replays of the same idempotencyKey).
   */
  async adjustStock(
    dto: AdjustStockDto,
    userId: string,
    user: any,
  ): Promise<{ adjustment: InventoryAdjustment; alreadyExisted: boolean }> {
    const storeId = this.resolveStoreScope(user);

    const result = await this.dataSource.transaction(async (manager) => {
      // 1. Acquire row-level lock on the target lot. Concurrent adjusters of
      //    the same lot block here until the leader commits, so the dedupe
      //    step below cannot race against itself.
      const lot = await manager
        .createQueryBuilder(InventoryLot, 'lot')
        .setLock('pessimistic_write')
        .where('lot.id = :id', { id: dto.lotId })
        .getOne();
      if (!lot) {
        throw new NotFoundException(`Lot ${dto.lotId} not found`);
      }

      // 2. Re-verify store scope inside the transaction. A pre-check outside
      //    the transaction is not a sufficient guard for race-safety, so we
      //    enforce scoping here against the same locked row.
      if (storeId) {
        const inScope = await manager
          .createQueryBuilder(InventoryLot, 'lot')
          .innerJoin('lot.sku', 'sku')
          .innerJoin('sku.product', 'product')
          .where('lot.id = :id', { id: dto.lotId })
          .andWhere('product.store_id = :storeId', { storeId })
          .getCount();
        if (!inScope) {
          throw new NotFoundException(`Lot ${dto.lotId} not found`);
        }
      }

      // 3. Insert the adjustment as the first-class idempotency guard. The
      //    unique constraint on `idempotency_key` plus ON CONFLICT DO NOTHING
      //    means duplicate replays return zero rows from the INSERT and never
      //    abort the transaction — exactly one writer ever sees a fresh row.
      const insertResult = await manager
        .createQueryBuilder()
        .insert()
        .into(InventoryAdjustment)
        .values({
          lot_id: dto.lotId,
          delta: dto.delta,
          reason_code: dto.reasonCode,
          idempotency_key: dto.idempotencyKey,
          adjusted_by: userId,
        })
        .orIgnore()
        .returning('*')
        .execute();

      const insertedRow = insertResult.raw?.[0];

      if (!insertedRow) {
        // 4a. Duplicate idempotency key — return the original adjustment
        //     WITHOUT mutating the lot quantity. This is the replay path
        //     that all concurrent losers fall through.
        const existing = await manager.findOne(InventoryAdjustment, {
          where: { idempotency_key: dto.idempotencyKey },
        });
        return {
          adjustment: existing,
          alreadyExisted: true,
          lotQuantity: lot.quantity,
          lotSkuId: lot.sku_id,
        };
      }

      // 4b. Fresh insert — apply the delta exactly once on the winning path.
      lot.quantity += dto.delta;
      await manager.save(InventoryLot, lot);

      const adjustment = await manager.findOne(InventoryAdjustment, {
        where: { id: insertedRow.id },
      });

      return {
        adjustment,
        alreadyExisted: false,
        lotQuantity: lot.quantity,
        lotSkuId: lot.sku_id,
      };
    });

    // Post-commit: low-stock notification fires only on freshly applied
    // adjustments. Idempotent replays must not produce duplicate alerts.
    if (!result.alreadyExisted) {
      const threshold = this.configService.get<number>('lowStockThreshold', 10);
      if (result.lotQuantity < threshold && result.lotQuantity >= 0) {
        this.logger.warn(
          `Low stock: Lot ${dto.lotId} (SKU ${result.lotSkuId}) has ${result.lotQuantity} units (threshold: ${threshold})`,
        );
        await this.notificationsService.createForAdmins(
          'low_stock',
          `Low stock alert: Lot ${dto.lotId} (SKU ${result.lotSkuId}) has ${result.lotQuantity} units, below threshold of ${threshold}.`,
        );
      }
    }

    return {
      adjustment: result.adjustment,
      alreadyExisted: result.alreadyExisted,
    };
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
