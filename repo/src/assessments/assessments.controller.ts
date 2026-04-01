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
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('assessments')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Get('papers')
  @ApiOperation({ summary: 'List papers' })
  @ApiResponse({ status: 200, description: 'List of papers' })
  getPapers(@Query('storeId') storeId?: string) {
    return this.assessmentsService.getPapers(storeId);
  }

  @Post('papers')
  @ApiOperation({ summary: 'Generate a paper' })
  @ApiResponse({ status: 201, description: 'Paper generated' })
  generatePaper(
    @Body() dto: GeneratePaperDto,
    @CurrentUser('id') userId: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.assessmentsService.generatePaper(dto, userId, storeId);
  }

  @Get('papers/:id')
  @ApiOperation({ summary: 'Get a paper by ID' })
  @ApiResponse({ status: 200, description: 'Paper found' })
  getPaper(@Param('id', ParseUUIDPipe) id: string) {
    return this.assessmentsService.getPaper(id);
  }

  @Post('attempts')
  @ApiOperation({ summary: 'Start an attempt' })
  @ApiResponse({ status: 201, description: 'Attempt started' })
  startAttempt(
    @Body() dto: StartAttemptDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessmentsService.startAttempt(dto.paperId, userId);
  }

  @Post('attempts/:id/submit')
  @ApiOperation({ summary: 'Submit an attempt with answers' })
  @ApiResponse({ status: 200, description: 'Attempt submitted and graded' })
  submitAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessmentsService.submitAttempt(id, dto.answers, userId);
  }

  @Post('attempts/:id/redo')
  @ApiOperation({ summary: 'Redo an attempt' })
  @ApiResponse({ status: 201, description: 'New attempt created for redo' })
  redoAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessmentsService.redoAttempt(id, userId);
  }

  @Get('attempts/history')
  @ApiOperation({ summary: 'Get attempt history for current user' })
  @ApiResponse({ status: 200, description: 'Attempt history' })
  getHistory(@CurrentUser('id') userId: string) {
    return this.assessmentsService.getHistory(userId);
  }
}
