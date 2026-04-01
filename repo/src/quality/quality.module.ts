import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataQualityRule } from './entities/data-quality-rule.entity';
import { DataQualityScore } from './entities/data-quality-score.entity';
import { QualityService } from './quality.service';
import { QualityController } from './quality.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DataQualityRule, DataQualityScore]),
    NotificationsModule,
  ],
  controllers: [QualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
