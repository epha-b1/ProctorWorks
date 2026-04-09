import {
  BadRequestException,
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

// Same set the service allowlists against — duplicated as a literal
// tuple here so the controller can reject bad input before it ever
// hits the service (defense in depth). Keeping it a tuple (rather
// than importing a runtime Set) lets us cite the allowed values in
// the 400 message without a circular dependency.
const ALLOWED_ENTITY_TYPES = [
  'products',
  'orders',
  'questions',
  'users',
  'inventory',
] as const;
type AllowedEntityType = (typeof ALLOWED_ENTITY_TYPES)[number];

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
    enum: ALLOWED_ENTITY_TYPES,
  })
  @ApiResponse({ status: 201, description: 'Score computed' })
  @ApiResponse({
    status: 400,
    description: 'Unknown or malformed entityType',
  })
  computeScore(@Param('entityType') entityType: string) {
    // Reject bad input at the HTTP boundary so callers get a clean 400
    // with a list of allowed values instead of a generic 500. The
    // service re-validates the same way as defense in depth.
    if (!ALLOWED_ENTITY_TYPES.includes(entityType as AllowedEntityType)) {
      throw new BadRequestException(
        `Unknown entity type "${entityType}". Allowed: ${ALLOWED_ENTITY_TYPES.join(', ')}.`,
      );
    }
    return this.qualityService.computeScore(entityType);
  }
}
