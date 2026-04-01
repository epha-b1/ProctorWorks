import {
  IsInt,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PriceTierDto } from './create-sku.dto';

export class UpdateSkuDto {
  @ApiPropertyOptional({ example: 1099 })
  @IsInt()
  @IsOptional()
  priceCents?: number;

  @ApiPropertyOptional({ example: 899 })
  @IsInt()
  @IsOptional()
  memberPriceCents?: number;

  @ApiPropertyOptional({ example: { color: 'blue' } })
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
