import { IsIn, IsObject, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateQualityRuleDto {
  @ApiProperty({
    description: 'Entity type to apply the rule to',
    enum: ['products', 'orders', 'questions', 'users', 'inventory'],
  })
  @IsString()
  @IsIn(['products', 'orders', 'questions', 'users', 'inventory'])
  entityType: string;

  @ApiProperty({
    description: 'Type of quality rule',
    enum: ['completeness', 'range', 'uniqueness'],
  })
  @IsString()
  @IsIn(['completeness', 'range', 'uniqueness'])
  ruleType: string;

  @ApiProperty({
    description: 'Rule configuration (e.g. required fields, range bounds, unique column)',
  })
  @IsObject()
  config: Record<string, any>;
}
