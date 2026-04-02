import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { CreateExplanationDto } from './dto/create-explanation.dto';
import { BulkImportDto } from './dto/bulk-import.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { QuestionType, QuestionStatus } from './entities/question.entity';

@ApiTags('questions')
@ApiBearerAuth()
@Controller('questions')
@UseGuards(RolesGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  @ApiOperation({ summary: 'List questions' })
  @ApiResponse({ status: 200, description: 'List of questions' })
  findAll(
    @Query('type') type?: QuestionType,
    @Query('status') status?: QuestionStatus,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.findAll({ type, status, storeId });
  }

  @Post()
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Create a question' })
  @ApiResponse({ status: 201, description: 'Question created' })
  createQuestion(
    @Body() dto: CreateQuestionDto,
    @CurrentUser('id') userId: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.createQuestion(dto, userId, storeId);
  }

  @Get('export')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Export questions as CSV' })
  @ApiResponse({ status: 200, description: 'CSV string of questions' })
  @Header('Content-Type', 'text/csv')
  async exportQuestions(
    @Query('type') type?: QuestionType,
    @Query('status') status?: QuestionStatus,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.bulkExport({ type, status, storeId });
  }

  @Post('import')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Bulk import questions' })
  @ApiResponse({ status: 201, description: 'Questions imported' })
  importQuestions(
    @Body() dto: BulkImportDto,
    @CurrentUser('id') userId: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.bulkImport(dto.questions, userId, storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a question by ID' })
  @ApiResponse({ status: 200, description: 'Question found' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.findById(id);
  }

  @Patch(':id')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Update a question' })
  @ApiResponse({ status: 200, description: 'Question updated' })
  updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questionsService.updateQuestion(id, dto);
  }

  @Delete(':id')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Delete a question' })
  @ApiResponse({ status: 200, description: 'Question deleted' })
  deleteQuestion(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.deleteQuestion(id);
  }

  @Post(':id/approve')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Approve a question' })
  @ApiResponse({ status: 200, description: 'Question approved' })
  approveQuestion(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.approveQuestion(id);
  }

  @Post(':id/reject')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Reject a question' })
  @ApiResponse({ status: 200, description: 'Question rejected' })
  rejectQuestion(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.rejectQuestion(id);
  }

  @Get(':id/wrong-answer-stats')
  @ApiOperation({ summary: 'Get wrong answer statistics for a question' })
  @ApiResponse({ status: 200, description: 'Wrong answer stats' })
  getWrongAnswerStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.getWrongAnswerStats(id);
  }

  @Get(':id/explanations')
  @ApiOperation({ summary: 'Get explanations for a question' })
  @ApiResponse({ status: 200, description: 'List of explanations' })
  getExplanations(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.getExplanations(id);
  }

  @Post(':id/explanations')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Add an explanation to a question' })
  @ApiResponse({ status: 201, description: 'Explanation added' })
  addExplanation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExplanationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.questionsService.addExplanation(id, dto.body, userId);
  }
}
