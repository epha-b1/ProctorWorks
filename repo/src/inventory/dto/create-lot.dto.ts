import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLotDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ example: 'BATCH-2026-001' })
  @IsString()
  @IsNotEmpty()
  batchCode: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsString()
  @IsOptional()
  expirationDate?: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  quantity: number;
}
