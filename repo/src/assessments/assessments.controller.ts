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
import { TraceId } from '../common/decorators/trace-id.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('assessments')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class AssessmentsController {
  constructor(
    private readonly assessmentsService: AssessmentsService,
    private readonly auditService: AuditService,
  ) {}

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
  async generatePaper(
    @Body() dto: GeneratePaperDto,
    @CurrentUser() user: any,
    @Query('storeId') storeId?: string,
    @TraceId() traceId?: string,
  ) {
    // Pass the full user context so the service can force the store scope
    // for store_admin from JWT (ignoring any caller-supplied `?storeId=`)
    // while still letting platform_admin / content_reviewer optionally
    // target a specific store via the query param.
    const paper = await this.assessmentsService.generatePaper(
      dto,
      user,
      storeId,
    );
    await this.auditService.log(
      user.id,
      'generate_paper',
      'paper',
      paper.id,
      { storeId: paper.store_id, name: paper.name },
      traceId,
    );
    return paper;
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
  @ApiResponse({
    status: 404,
    description: 'Paper not found or not in caller scope',
  })
  async startAttempt(
    @Body() dto: StartAttemptDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    // audit_report-2 HIGH-1: pass the FULL user context (not just id) so the
    // service can enforce the same store-scope/hiding policy as paper reads.
    // A store_admin cannot start an attempt on a paper that lives in another
    // store — the service returns 404 (never 403) to avoid leaking the
    // paper's existence across tenants, and no attempt row is created.
    const attempt = await this.assessmentsService.startAttempt(
      dto.paperId,
      user,
    );
    await this.auditService.log(
      user.id,
      'start_attempt',
      'attempt',
      attempt.id,
      { paperId: dto.paperId },
      traceId,
    );
    return attempt;
  }

  @Post('attempts/:id/submit')
  @Roles('platform_admin', 'store_admin', 'content_reviewer')
  @ApiOperation({ summary: 'Submit an attempt with answers' })
  @ApiResponse({ status: 201, description: 'Attempt submitted and graded' })
  async submitAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser('id') userId: string,
    @TraceId() traceId?: string,
  ) {
    const attempt = await this.assessmentsService.submitAttempt(
      id,
      dto.answers,
      userId,
    );
    await this.auditService.log(
      userId,
      'submit_attempt',
      'attempt',
      id,
      { answerCount: dto.answers?.length ?? 0 },
      traceId,
    );
    return attempt;
  }

  @Post('attempts/:id/redo')
  @Roles('platform_admin', 'store_admin', 'content_reviewer')
  @ApiOperation({
    summary: 'Redo an attempt (regenerates content from original rule)',
    description:
      'Creates a new attempt whose questions are regenerated from the ' +
      'original paper\'s generation rule (a fresh question set, not a ' +
      'duplicate pointer). A new paper instance is materialised under the ' +
      'original store scope and the new attempt carries parent_attempt_id ' +
      'back to the source. The original attempt and paper are preserved.',
  })
  @ApiResponse({
    status: 201,
    description:
      'New attempt created for redo, backed by a freshly regenerated paper',
  })
  @ApiResponse({
    status: 404,
    description: 'Attempt or source paper not found / not in caller scope',
  })
  async redoAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const attempt = await this.assessmentsService.redoAttempt(id, user);
    await this.auditService.log(
      user.id,
      'redo_attempt',
      'attempt',
      id,
      {
        newAttemptId: (attempt as any)?.id,
        regeneratedPaperId: (attempt as any)?.paper_id,
      },
      traceId,
    );
    return attempt;
  }

  @Get('attempts/history')
  @Roles('platform_admin', 'store_admin', 'content_reviewer', 'auditor')
  @ApiOperation({ summary: 'Get attempt history for current user' })
  @ApiResponse({ status: 200, description: 'Attempt history' })
  getHistory(@CurrentUser('id') userId: string) {
    return this.assessmentsService.getHistory(userId);
  }
}
