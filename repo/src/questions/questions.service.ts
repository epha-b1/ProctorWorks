import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Question, QuestionType, QuestionStatus } from './entities/question.entity';
import { QuestionOption } from './entities/question-option.entity';
import { QuestionExplanation } from './entities/question-explanation.entity';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,
    @InjectRepository(QuestionOption)
    private readonly optionRepo: Repository<QuestionOption>,
    @InjectRepository(QuestionExplanation)
    private readonly explanationRepo: Repository<QuestionExplanation>,
    private readonly dataSource: DataSource,
  ) {}

  async createQuestion(
    dto: CreateQuestionDto,
    userId: string,
    storeId?: string,
  ): Promise<Question> {
    const question = this.questionRepo.create({
      type: dto.type,
      body: dto.body,
      created_by: userId,
      store_id: storeId ?? null,
    });

    const savedQuestion = await this.questionRepo.save(question);

    if (dto.type === QuestionType.OBJECTIVE && dto.options?.length) {
      const options = dto.options.map((opt) =>
        this.optionRepo.create({
          question_id: savedQuestion.id,
          body: opt.body,
          is_correct: opt.isCorrect,
        }),
      );
      savedQuestion.options = await this.optionRepo.save(options);
    }

    return savedQuestion;
  }

  async updateQuestion(id: string, dto: UpdateQuestionDto): Promise<Question> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    if (dto.body !== undefined) question.body = dto.body;
    if (dto.type !== undefined) question.type = dto.type;

    return this.questionRepo.save(question);
  }

  async deleteQuestion(id: string): Promise<void> {
    const result = await this.questionRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('Question not found');
    }
  }

  async findAll(filters?: {
    type?: QuestionType;
    status?: QuestionStatus;
    storeId?: string;
  }): Promise<Question[]> {
    const where: any = {};
    if (filters?.type) where.type = filters.type;
    if (filters?.status) where.status = filters.status;
    if (filters?.storeId) where.store_id = filters.storeId;

    return this.questionRepo.find({
      where,
      relations: ['options'],
    });
  }

  async findById(id: string): Promise<Question> {
    const question = await this.questionRepo.findOne({
      where: { id },
      relations: ['options', 'explanations'],
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    return question;
  }

  async approveQuestion(id: string): Promise<Question> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    question.status = QuestionStatus.APPROVED;
    return this.questionRepo.save(question);
  }

  async rejectQuestion(id: string): Promise<Question> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    question.status = QuestionStatus.REJECTED;
    return this.questionRepo.save(question);
  }

  async addExplanation(
    questionId: string,
    body: string,
    userId: string,
  ): Promise<QuestionExplanation> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // Auto-increment version_number
    const latest = await this.explanationRepo
      .createQueryBuilder('e')
      .where('e.question_id = :questionId', { questionId })
      .orderBy('e.version_number', 'DESC')
      .getOne();

    const nextVersion = latest ? latest.version_number + 1 : 1;

    const explanation = this.explanationRepo.create({
      question_id: questionId,
      version_number: nextVersion,
      body,
      created_by: userId,
    });

    return this.explanationRepo.save(explanation);
  }

  async getExplanations(questionId: string): Promise<QuestionExplanation[]> {
    return this.explanationRepo.find({
      where: { question_id: questionId },
      order: { version_number: 'ASC' },
    });
  }

  async bulkImport(
    questions: CreateQuestionDto[],
    userId: string,
    storeId?: string,
  ): Promise<{ count: number }> {
    let count = 0;

    await this.dataSource.transaction(async (manager) => {
      for (const dto of questions) {
        const question = manager.create(Question, {
          type: dto.type,
          body: dto.body,
          created_by: userId,
          store_id: storeId ?? null,
        });

        const savedQuestion = await manager.save(question);

        if (dto.type === QuestionType.OBJECTIVE && dto.options?.length) {
          const options = dto.options.map((opt) =>
            manager.create(QuestionOption, {
              question_id: savedQuestion.id,
              body: opt.body,
              is_correct: opt.isCorrect,
            }),
          );
          await manager.save(options);
        }

        count++;
      }
    });

    return { count };
  }

  async bulkExport(filters?: {
    type?: QuestionType;
    status?: QuestionStatus;
    storeId?: string;
  }): Promise<string> {
    const questions = await this.findAll(filters);

    const header = 'id,type,body,status,options';
    const rows = questions.map((q) => {
      const escapedBody = `"${q.body.replace(/"/g, '""')}"`;
      const optionsJson = q.options?.length
        ? `"${JSON.stringify(
            q.options.map((o) => ({ body: o.body, isCorrect: o.is_correct })),
          ).replace(/"/g, '""')}"`
        : '""';
      return `${q.id},${q.type},${escapedBody},${q.status},${optionsJson}`;
    });

    return [header, ...rows].join('\n');
  }

  async getWrongAnswerStats(
    questionId: string,
  ): Promise<Record<string, number>> {
    const results = await this.dataSource
      .createQueryBuilder()
      .select('aa.selected_option_id', 'optionId')
      .addSelect('COUNT(*)::int', 'count')
      .from('attempt_answers', 'aa')
      .where('aa.question_id = :questionId', { questionId })
      .andWhere('aa.is_correct = false')
      .groupBy('aa.selected_option_id')
      .getRawMany();

    const stats: Record<string, number> = {};
    for (const row of results) {
      if (row.optionId) {
        stats[row.optionId] = row.count;
      }
    }
    return stats;
  }
}
