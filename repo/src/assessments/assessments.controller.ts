import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AssessmentsService } from './assessments.service';
import { GeneratePaperDto } from './dto/generate-paper.dto';
import { StartAttemptDto } from './dto/start-attempt.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('assessments')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Get('papers')
  @Roles('platform_admin', 'store_admin', 'content_reviewer', 'auditor')
  @ApiOperation({ summary: 'List papers' })
  @ApiResponse({ status: 200, description: 'List of papers' })
  getPapers(@CurrentUser() user: any, @Query('storeId') storeId?: string) {
    // User context is passed down so the service can force store-scope
    // filtering for store_admin, regardless of any caller-supplied
    // `?storeId=` query param. Platform_admin / content_reviewer /
    // auditor behavior is unchanged.
    return this.assessmentsService.getPapers(user, storeId);
  }

  @Post('papers')
  @Roles('platform_admin', 'store_admin', 'content_reviewer')
  @ApiOperation({ summary: 'Generate a paper' })
  @ApiResponse({ status: 201, description: 'Paper generated' })
  generatePaper(
    @Body() dto: GeneratePaperDto,
    @CurrentUser() user: any,
    @Query('storeId') storeId?: string,
  ) {
    // Pass the full user context so the service can force the store scope
    // for store_admin from JWT (ignoring any caller-supplied `?storeId=`)
    // while still letting platform_admin / content_reviewer optionally
    // target a specific store via the query param.
    return this.assessmentsService.generatePaper(dto, user, storeId);
  }

  @Get('papers/:id')
  @Roles('platform_admin', 'store_admin', 'content_reviewer', 'auditor')
  @ApiOperation({ summary: 'Get a paper by ID' })
  @ApiResponse({ status: 200, description: 'Paper found' })
  @ApiResponse({
    status: 404,
    description: 'Paper not found or not in caller scope',
  })
  getPaper(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    // Ownership check lives in the service so direct service callers
    // (cron jobs, other services) also get the same 404-on-out-of-scope
    // behavior. For store_admin, a paper in a different store is
    // indistinguishable from a missing paper — 404, never 403.
    return this.assessmentsService.getPaper(id, user);
  }

  @Post('attempts')
  @Roles('platform_admin', 'store_admin', 'content_reviewer')
  @ApiOperation({ summary: 'Start an attempt' })
  @ApiResponse({ status: 201, description: 'Attempt started' })
  startAttempt(
    @Body() dto: StartAttemptDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessmentsService.startAttempt(dto.paperId, userId);
  }

  @Post('attempts/:id/submit')
  @Roles('platform_admin', 'store_admin', 'content_reviewer')
  @ApiOperation({ summary: 'Submit an attempt with answers' })
  @ApiResponse({ status: 201, description: 'Attempt submitted and graded' })
  submitAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessmentsService.submitAttempt(id, dto.answers, userId);
  }

  @Post('attempts/:id/redo')
  @Roles('platform_admin', 'store_admin', 'content_reviewer')
  @ApiOperation({ summary: 'Redo an attempt' })
  @ApiResponse({ status: 201, description: 'New attempt created for redo' })
  redoAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessmentsService.redoAttempt(id, userId);
  }

  @Get('attempts/history')
  @Roles('platform_admin', 'store_admin', 'content_reviewer', 'auditor')
  @ApiOperation({ summary: 'Get attempt history for current user' })
  @ApiResponse({ status: 200, description: 'Attempt history' })
  getHistory(@CurrentUser('id') userId: string) {
    return this.assessmentsService.getHistory(userId);
  }
}
