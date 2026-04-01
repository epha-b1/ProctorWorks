import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { QualityService } from './quality.service';
import { CreateQualityRuleDto } from './dto/create-quality-rule.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Quality')
@ApiBearerAuth()
@Controller('quality')
@UseGuards(RolesGuard)
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Post('rules')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Create a data quality rule' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  createRule(@Body() dto: CreateQualityRuleDto) {
    return this.qualityService.createRule(dto);
  }

  @Get('rules')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'List active data quality rules' })
  @ApiResponse({ status: 200, description: 'List of active rules' })
  findRules() {
    return this.qualityService.findRules();
  }

  @Get('scores')
  @Roles('platform_admin', 'auditor')
  @ApiOperation({ summary: 'Get latest data quality scores per entity type' })
  @ApiResponse({ status: 200, description: 'Latest scores' })
  getScores() {
    return this.qualityService.getScores();
  }

  @Post('scores/:entityType/compute')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Compute data quality score for an entity type' })
  @ApiParam({
    name: 'entityType',
    type: 'string',
    enum: ['products', 'orders', 'questions', 'users', 'inventory'],
  })
  @ApiResponse({ status: 201, description: 'Score computed' })
  computeScore(@Param('entityType') entityType: string) {
    return this.qualityService.computeScore(entityType);
  }
}
