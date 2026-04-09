import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Paper } from './entities/paper.entity';
import { PaperQuestion } from './entities/paper-question.entity';
import { Attempt, AttemptStatus } from './entities/attempt.entity';
import { AttemptAnswer } from './entities/attempt-answer.entity';
import { Question, QuestionStatus, QuestionType } from '../questions/entities/question.entity';
import { QuestionOption } from '../questions/entities/question-option.entity';
import { GeneratePaperDto } from './dto/generate-paper.dto';
import { SubmitAnswerDto } from './dto/submit-attempt.dto';

@Injectable()
export class AssessmentsService {
  constructor(
    @InjectRepository(Paper)
    private readonly paperRepo: Repository<Paper>,
    @InjectRepository(PaperQuestion)
    private readonly paperQuestionRepo: Repository<PaperQuestion>,
    @InjectRepository(Attempt)
    private readonly attemptRepo: Repository<Attempt>,
    @InjectRepository(AttemptAnswer)
    private readonly answerRepo: Repository<AttemptAnswer>,
    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,
    @InjectRepository(QuestionOption)
    private readonly optionRepo: Repository<QuestionOption>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Resolves the effective store scope for a caller.
   *
   * - store_admin  → their assigned store id (403 if none is assigned)
   * - everyone else → null (no scope restriction applied)
   *
   * This is the single place in the service where we decide whether a
   * query needs to be tenant-scoped. Returning null for non-store-admin
   * preserves platform_admin, content_reviewer, and auditor behavior
   * exactly; returning the assigned id for store_admin is what closes
   * the cross-store paper read leak.
   */
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

  /**
   * Ownership guard for per-paper reads. For store_admin callers, the
   * paper must live in their own store — otherwise we throw 404 (not
   * 403) so the existence of cross-store papers isn't leaked through
   * the status code, matching the tenant-isolation hiding policy used
   * by the questions module.
   */
  private enforcePaperOwnership(paper: Paper, user?: any): void {
    const scope = this.resolveStoreScope(user);
    if (scope && paper.store_id !== scope) {
      throw new NotFoundException('Paper not found');
    }
  }

  /**
   * Resolves the effective target store for a generate-paper call.
   *
   * - store_admin: ALWAYS uses the JWT's assigned store. Any caller-supplied
   *   `?storeId=` is silently ignored — trusting it would re-introduce the
   *   cross-store paper-write tenant escape this method is hardened against.
   * - platform_admin / content_reviewer: may optionally target a specific
   *   store via the query param; falsy means "no scope filter".
   * - Other roles fall through to the same null-scope behavior, but the
   *   controller's @Roles decorator already restricts who can call this.
   */
  private resolveTargetStoreForGenerate(
    user: any,
    requestedStoreId?: string,
  ): string | null {
    if (user?.role === 'store_admin') {
      const jwtStoreId = user?.storeId ?? user?.store_id ?? null;
      if (!jwtStoreId) {
        throw new ForbiddenException('Store admin has no assigned store');
      }
      // Defensive: if a store_admin tries to target another store via the
      // query param, that's a tenant-escape attempt — refuse it loudly so
      // the audit trail captures it instead of silently succeeding.
      if (requestedStoreId && requestedStoreId !== jwtStoreId) {
        throw new ForbiddenException(
          'store_admin cannot generate papers for another store',
        );
      }
      return jwtStoreId;
    }
    return requestedStoreId ?? null;
  }

  async generatePaper(
    dto: GeneratePaperDto,
    user: any,
    requestedStoreId?: string,
  ): Promise<Paper> {
    const storeId = this.resolveTargetStoreForGenerate(user, requestedStoreId);
    const userId: string = user?.id;
    const { generationRule } = dto;
    let questions: Question[];

    if (generationRule.type === 'random') {
      const count = generationRule.count ?? 10;
      const qb = this.questionRepo
        .createQueryBuilder('q')
        .where('q.status = :status', { status: QuestionStatus.APPROVED });

      if (storeId) {
        qb.andWhere('(q.store_id = :storeId OR q.store_id IS NULL)', {
          storeId,
        });
      }

      questions = await qb
        .orderBy('RANDOM()')
        .limit(count)
        .getMany();
    } else {
      // rule-based
      const qb = this.questionRepo
        .createQueryBuilder('q')
        .where('q.status = :status', { status: QuestionStatus.APPROVED });

      if (storeId) {
        qb.andWhere('(q.store_id = :storeId OR q.store_id IS NULL)', {
          storeId,
        });
      }

      const filters = generationRule.filters ?? {};
      if (filters.type) {
        qb.andWhere('q.type = :type', { type: filters.type });
      }

      const count = generationRule.count;
      if (count) {
        qb.limit(count);
      }

      questions = await qb.getMany();
    }

    const paper = this.paperRepo.create({
      name: dto.name,
      generation_rule: generationRule as any,
      created_by: userId,
      store_id: storeId ?? null,
    });

    const savedPaper = await this.paperRepo.save(paper);

    const paperQuestions = questions.map((q, index) =>
      this.paperQuestionRepo.create({
        paper_id: savedPaper.id,
        question_id: q.id,
        position: index + 1,
      }),
    );

    await this.paperQuestionRepo.save(paperQuestions);
    savedPaper.paper_questions = paperQuestions;

    return savedPaper;
  }

  async startAttempt(paperId: string, userId: string): Promise<Attempt> {
    const paper = await this.paperRepo.findOne({ where: { id: paperId } });
    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    const attempt = this.attemptRepo.create({
      paper_id: paperId,
      user_id: userId,
      status: AttemptStatus.IN_PROGRESS,
      started_at: new Date(),
    });

    return this.attemptRepo.save(attempt);
  }

  async submitAttempt(
    attemptId: string,
    answers: SubmitAnswerDto[],
    userId: string,
  ): Promise<Attempt> {
    const attempt = await this.attemptRepo.findOne({
      where: { id: attemptId },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    if (attempt.user_id !== userId) {
      throw new BadRequestException('Attempt does not belong to this user');
    }

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt is not in progress');
    }

    const now = new Date();
    let correctCount = 0;
    let totalObjective = 0;
    const attemptAnswers: AttemptAnswer[] = [];

    for (const ans of answers) {
      const question = await this.questionRepo.findOne({
        where: { id: ans.questionId },
      });

      if (!question) {
        throw new NotFoundException(`Question ${ans.questionId} not found`);
      }

      let isCorrect: boolean | null = null;

      if (question.type === QuestionType.OBJECTIVE) {
        totalObjective++;

        if (ans.selectedOptionId) {
          const option = await this.optionRepo.findOne({
            where: { id: ans.selectedOptionId },
          });

          if (option) {
            isCorrect = option.is_correct;
            if (isCorrect) {
              correctCount++;
            }
          } else {
            isCorrect = false;
          }
        } else {
          isCorrect = false;
        }
      }
      // subjective: is_correct remains null

      const attemptAnswer = this.answerRepo.create({
        attempt_id: attemptId,
        question_id: ans.questionId,
        selected_option_id: ans.selectedOptionId ?? null,
        text_answer: ans.textAnswer ?? null,
        is_correct: isCorrect,
      });

      attemptAnswers.push(attemptAnswer);
    }

    await this.answerRepo.save(attemptAnswers);

    const score =
      totalObjective > 0
        ? Math.round((correctCount / totalObjective) * 10000) / 100
        : null;

    attempt.status = AttemptStatus.GRADED;
    attempt.graded_at = now;
    attempt.submitted_at = now;
    attempt.score = score;
    attempt.answers = attemptAnswers;

    return this.attemptRepo.save(attempt);
  }

  async redoAttempt(attemptId: string, userId: string): Promise<Attempt> {
    const original = await this.attemptRepo.findOne({
      where: { id: attemptId },
    });

    if (!original) {
      throw new NotFoundException('Attempt not found');
    }

    if (original.user_id !== userId) {
      throw new BadRequestException('Attempt does not belong to this user');
    }

    const newAttempt = this.attemptRepo.create({
      paper_id: original.paper_id,
      user_id: userId,
      parent_attempt_id: attemptId,
      status: AttemptStatus.IN_PROGRESS,
      started_at: new Date(),
    });

    return this.attemptRepo.save(newAttempt);
  }

  async getHistory(userId: string): Promise<Attempt[]> {
    return this.attemptRepo.find({
      where: { user_id: userId },
      order: { started_at: 'DESC' },
      relations: ['paper'],
    });
  }

  async getPapers(user?: any, storeId?: string): Promise<Paper[]> {
    // store_admin: always filter by the JWT's assigned store — the
    // caller-supplied `storeId` query param is ignored on purpose.
    // Trusting it here would re-introduce the cross-store read leak
    // this method is being hardened against.
    //
    // Everyone else (platform_admin / content_reviewer / auditor):
    // keep the existing behavior — optional `storeId` query param
    // narrows the listing; omitting it returns all papers.
    const scopedStoreId = this.resolveStoreScope(user);
    const where: any = {};
    if (scopedStoreId) {
      where.store_id = scopedStoreId;
    } else if (storeId) {
      where.store_id = storeId;
    }
    return this.paperRepo.find({ where, relations: ['paper_questions'] });
  }

  async getPaper(id: string, user?: any): Promise<Paper> {
    const paper = await this.paperRepo.findOne({
      where: { id },
      relations: ['paper_questions', 'paper_questions.question', 'paper_questions.question.options'],
    });

    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    // Tenant-isolation check — for store_admin, a paper in another
    // store is indistinguishable from a missing paper (404, not 403).
    this.enforcePaperOwnership(paper, user);

    return paper;
  }
}
