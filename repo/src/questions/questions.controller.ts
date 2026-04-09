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
    @CurrentUser() user: any,
    @Query('type') type?: QuestionType,
    @Query('status') status?: QuestionStatus,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.findAll({ type, status, storeId }, user);
  }

  @Post()
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Create a question' })
  @ApiResponse({ status: 201, description: 'Question created' })
  createQuestion(
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: any,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.createQuestion(dto, user.id, user, storeId);
  }

  @Get('export')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Export questions as CSV' })
  @ApiResponse({ status: 200, description: 'CSV string of questions' })
  @Header('Content-Type', 'text/csv')
  async exportQuestions(
    @CurrentUser() user: any,
    @Query('type') type?: QuestionType,
    @Query('status') status?: QuestionStatus,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.bulkExport({ type, status, storeId }, user);
  }

  @Post('import')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Bulk import questions' })
  @ApiResponse({ status: 201, description: 'Questions imported' })
  importQuestions(
    @Body() dto: BulkImportDto,
    @CurrentUser() user: any,
    @Query('storeId') storeId?: string,
  ) {
    return this.questionsService.bulkImport(dto.questions, user.id, user, storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a question by ID' })
  @ApiResponse({ status: 200, description: 'Question found' })
  findById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.questionsService.findById(id, user);
  }

  @Patch(':id')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Update a question' })
  @ApiResponse({ status: 200, description: 'Question updated' })
  updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: any,
  ) {
    return this.questionsService.updateQuestion(id, dto, user);
  }

  @Delete(':id')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Delete a question' })
  @ApiResponse({ status: 200, description: 'Question deleted' })
  deleteQuestion(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.questionsService.deleteQuestion(id, user);
  }

  @Post(':id/approve')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Approve a question' })
  @ApiResponse({ status: 200, description: 'Question approved' })
  approveQuestion(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.questionsService.approveQuestion(id, user);
  }

  @Post(':id/reject')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Reject a question' })
  @ApiResponse({ status: 200, description: 'Question rejected' })
  rejectQuestion(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.questionsService.rejectQuestion(id, user);
  }

  @Get(':id/wrong-answer-stats')
  @ApiOperation({ summary: 'Get wrong answer statistics for a question' })
  @ApiResponse({ status: 200, description: 'Wrong answer stats' })
  getWrongAnswerStats(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.questionsService.getWrongAnswerStats(id, user);
  }

  @Get(':id/explanations')
  @ApiOperation({ summary: 'Get explanations for a question' })
  @ApiResponse({ status: 200, description: 'List of explanations' })
  getExplanations(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.questionsService.getExplanations(id);
  }

  @Post(':id/explanations')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Add an explanation to a question' })
  @ApiResponse({ status: 201, description: 'Explanation added' })
  addExplanation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExplanationDto,
    @CurrentUser() user: any,
  ) {
    return this.questionsService.addExplanation(id, dto.body, user.id, user);
  }
}
