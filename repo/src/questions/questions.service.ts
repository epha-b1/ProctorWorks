import {
  Injectable,
  NotFoundException,
  ForbiddenException,
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

  private resolveStoreScope(user?: any): string | null {
    if (user?.role === 'store_admin') {
      const storeId = user?.storeId ?? user?.store_id ?? null;
      if (!storeId) {
        throw new ForbiddenException('Store admin has no assigned store');
      }
      return storeId;
    }
    return null;
  }

  private enforceQuestionOwnership(question: Question, user?: any): void {
    const storeId = this.resolveStoreScope(user);
    if (storeId && question.store_id !== storeId) {
      throw new NotFoundException('Question not found');
    }
  }

  async createQuestion(
    dto: CreateQuestionDto,
    userId: string,
    user?: any,
    storeId?: string,
  ): Promise<Question> {
    // store_admin: always use their own store, ignore caller-provided storeId
    const resolvedStoreId = this.resolveStoreScope(user) ?? storeId ?? null;

    const question = this.questionRepo.create({
      type: dto.type,
      body: dto.body,
      created_by: userId,
      store_id: resolvedStoreId,
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

  async updateQuestion(id: string, dto: UpdateQuestionDto, user?: any): Promise<Question> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);

    if (dto.body !== undefined) question.body = dto.body;
    if (dto.type !== undefined) question.type = dto.type;

    return this.questionRepo.save(question);
  }

  async deleteQuestion(id: string, user?: any): Promise<void> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);
    await this.questionRepo.remove(question);
  }

  async findAll(filters?: {
    type?: QuestionType;
    status?: QuestionStatus;
    storeId?: string;
  }, user?: any): Promise<Question[]> {
    const where: any = {};
    if (filters?.type) where.type = filters.type;
    if (filters?.status) where.status = filters.status;

    // store_admin: enforce their store scope regardless of query param
    const storeId = this.resolveStoreScope(user) ?? filters?.storeId;
    if (storeId) where.store_id = storeId;

    return this.questionRepo.find({
      where,
      relations: ['options'],
    });
  }

  async findById(id: string, user?: any): Promise<Question> {
    const question = await this.questionRepo.findOne({
      where: { id },
      relations: ['options', 'explanations'],
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);
    return question;
  }

  async approveQuestion(id: string, user?: any): Promise<Question> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);
    question.status = QuestionStatus.APPROVED;
    return this.questionRepo.save(question);
  }

  async rejectQuestion(id: string, user?: any): Promise<Question> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);
    question.status = QuestionStatus.REJECTED;
    return this.questionRepo.save(question);
  }

  async addExplanation(
    questionId: string,
    body: string,
    userId: string,
    user?: any,
  ): Promise<QuestionExplanation> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);

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

  /**
   * Returns versioned explanations for a question.
   *
   * audit_report-2 P0-3: object-level / tenant authorization.
   *
   * Previously this only filtered by `question_id` and emitted whatever
   * rows existed — no question existence check, no caller scope check.
   * That meant a store_admin in store B could enumerate explanations
   * for a question that lived in store A simply by knowing or guessing
   * the question id (or by harvesting ids from a noisy log). Worse,
   * because the listing was empty for non-existent ids and non-empty
   * for existing-but-foreign ids, the response itself was a tenant
   * existence oracle.
   *
   * Fix: load the parent question first, run it through the same
   * `enforceQuestionOwnership` guard used by every other read/write
   * surface, and only then return its explanations. For store_admin
   * callers, an out-of-store question is indistinguishable from a
   * missing question (404, never 403).
   */
  async getExplanations(
    questionId: string,
    user?: any,
  ): Promise<QuestionExplanation[]> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);

    return this.explanationRepo.find({
      where: { question_id: questionId },
      order: { version_number: 'ASC' },
    });
  }

  async bulkImport(
    questions: CreateQuestionDto[],
    userId: string,
    user?: any,
    storeId?: string,
  ): Promise<{ count: number }> {
    const resolvedStoreId = this.resolveStoreScope(user) ?? storeId ?? null;
    let count = 0;

    await this.dataSource.transaction(async (manager) => {
      for (const dto of questions) {
        const question = manager.create(Question, {
          type: dto.type,
          body: dto.body,
          created_by: userId,
          store_id: resolvedStoreId,
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
  }, user?: any): Promise<string> {
    const questions = await this.findAll(filters, user);

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
    user?: any,
  ): Promise<Record<string, number>> {
    const question = await this.questionRepo.findOne({ where: { id: questionId } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    this.enforceQuestionOwnership(question, user);

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
