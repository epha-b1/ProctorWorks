import { IsUUID, IsInt, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  lotId: string;

  @ApiProperty({ example: -5 })
  @IsInt()
  delta: number;

  @ApiProperty({ example: 'damaged' })
  @IsString()
  @IsNotEmpty()
  reasonCode: string;

  @ApiProperty({ example: 'adj-unique-key-123' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
