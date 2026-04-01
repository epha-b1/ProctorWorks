import { IsString, IsOptional, IsIn, IsInt, IsObject, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerationRuleDto {
  @ApiProperty({ enum: ['random', 'rule'] })
  @IsIn(['random', 'rule'])
  type: 'random' | 'rule';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;
}

export class GeneratePaperDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: GenerationRuleDto })
  @ValidateNested()
  @Type(() => GenerationRuleDto)
  generationRule: GenerationRuleDto;
}
