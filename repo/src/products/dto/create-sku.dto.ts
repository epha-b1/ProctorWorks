import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PriceTierDto {
  @ApiProperty({ example: 'wholesale' })
  @IsString()
  @IsNotEmpty()
  tierName: string;

  @ApiProperty({ example: 899 })
  @IsInt()
  priceCents: number;
}

export class CreateSkuDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @IsNotEmpty()
  skuCode: string;

  @ApiProperty({ example: 999 })
  @IsInt()
  priceCents: number;

  @ApiPropertyOptional({ example: 799 })
  @IsInt()
  @IsOptional()
  memberPriceCents?: number;

  @ApiPropertyOptional({ example: { color: 'red', size: 'M' } })
  @IsObject()
  @IsOptional()
  attributes?: Record<string, any>;

  @ApiPropertyOptional({ type: [PriceTierDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  @IsOptional()
  priceTiers?: PriceTierDto[];
}
