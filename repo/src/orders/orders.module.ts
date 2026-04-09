import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Sku } from '../products/entities/sku.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { EncryptionService } from '../common/encryption.service';
import { PromotionsModule } from '../promotions/promotions.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PromotionsModule,
    AuditModule,
    TypeOrmModule.forFeature([Order, OrderItem, IdempotencyKey, Sku]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, EncryptionService],
  exports: [TypeOrmModule, OrdersService],
})
export class OrdersModule {}
