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

  /**
   * Selects a fresh set of approved questions for a given generation rule
   * and store scope. Shared between the initial `generatePaper` path and
   * `redoAttempt` (which must re-run the original rule to produce a new
   * question set per audit_report-2 HIGH-2 — redo regeneration).
   *
   * Passing `storeId=null` means "no scope filter" (platform_admin path).
   */
  private async selectQuestionsForRule(
    generationRule: any,
    storeId: string | null,
  ): Promise<Question[]> {
    if (generationRule?.type === 'random') {
      const count = generationRule.count ?? 10;
      const qb = this.questionRepo
        .createQueryBuilder('q')
        .where('q.status = :status', { status: QuestionStatus.APPROVED });

      if (storeId) {
        qb.andWhere('(q.store_id = :storeId OR q.store_id IS NULL)', {
          storeId,
        });
      }

      return qb.orderBy('RANDOM()').limit(count).getMany();
    }

    // rule-based
    const qb = this.questionRepo
      .createQueryBuilder('q')
      .where('q.status = :status', { status: QuestionStatus.APPROVED });

    if (storeId) {
      qb.andWhere('(q.store_id = :storeId OR q.store_id IS NULL)', {
        storeId,
      });
    }

    const filters = generationRule?.filters ?? {};
    if (filters.type) {
      qb.andWhere('q.type = :type', { type: filters.type });
    }

    const count = generationRule?.count;
    if (count) {
      qb.limit(count);
    }

    return qb.getMany();
  }

  /**
   * Persists a new Paper row and its PaperQuestion rows for a freshly
   * selected question set. Factored out so `generatePaper` and the redo
   * regeneration path both materialise papers the same way.
   */
  private async persistPaperWithQuestions(params: {
    name: string;
    generationRule: any;
    createdBy: string;
    storeId: string | null;
    questions: Question[];
  }): Promise<Paper> {
    const paper = this.paperRepo.create({
      name: params.name,
      generation_rule: params.generationRule as any,
      created_by: params.createdBy,
      store_id: params.storeId ?? null,
    });

    const savedPaper = await this.paperRepo.save(paper);

    const paperQuestions = params.questions.map((q, index) =>
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

  async generatePaper(
    dto: GeneratePaperDto,
    user: any,
    requestedStoreId?: string,
  ): Promise<Paper> {
    const storeId = this.resolveTargetStoreForGenerate(user, requestedStoreId);
    const userId: string = user?.id;
    const { generationRule } = dto;

    const questions = await this.selectQuestionsForRule(
      generationRule,
      storeId,
    );

    return this.persistPaperWithQuestions({
      name: dto.name,
      generationRule,
      createdBy: userId,
      storeId,
      questions,
    });
  }

  /**
   * Start a new attempt on a paper.
   *
   * Object-level + tenant authorization (audit_report-2 HIGH-1):
   *   - store_admin with no assigned store → 403 (resolveStoreScope)
   *   - store_admin targeting a paper in another store → 404 (hiding policy,
   *     same semantics as paper reads via enforcePaperOwnership)
   *   - allowed roles (platform_admin / store_admin / content_reviewer) pass
   *     through
   *
   * Critically, the ownership check runs BEFORE attemptRepo.create so no
   * attempt row is ever persisted on the denied path.
   */
  async startAttempt(paperId: string, user: any): Promise<Attempt> {
    const userId: string = user?.id;
    const paper = await this.paperRepo.findOne({ where: { id: paperId } });
    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    // Reuse the same ownership guard as paper reads so 404 is returned for
    // out-of-scope store_admin access (never 403), matching the tenant
    // isolation hiding policy used elsewhere in the module.
    this.enforcePaperOwnership(paper, user);

    const attempt = this.attemptRepo.create({
      paper_id: paperId,
      user_id: userId,
      status: AttemptStatus.IN_PROGRESS,
      started_at: new Date(),
    });

    return this.attemptRepo.save(attempt);
  }

  /**
   * Submits answers for an in-progress attempt and grades it.
   *
   * audit_report-2 P0-4: submission integrity hardening.
   *
   * Previously:
   *   - any questionId could be submitted, even one that wasn't part
   *     of the attempt's paper (so a caller could grade themselves
   *     against a question they cherry-picked)
   *   - any optionId could be passed for a given question, including
   *     options that belonged to a *different* question (silently
   *     auto-graded as wrong, distorting analytics)
   *   - the same questionId could appear multiple times in the same
   *     submission (double-counted in score, flooded attempt_answers)
   *
   * New rules (all enforced BEFORE any answer row is persisted):
   *   1) Every `answer.questionId` must be a member of the attempt's
   *      paper, looked up via the `paper_questions` join table.
   *   2) If `selectedOptionId` is provided, it MUST belong to the same
   *      `question_id` — cross-question option references are rejected.
   *   3) Duplicate `questionId` entries inside one submission body are
   *      rejected up-front, before any DB lookup, to bound work.
   *
   * All three failures surface as 400 (BadRequestException) — these
   * are caller-supplied content errors, not authentication issues, and
   * the global exception filter wraps them in the standard envelope
   * with traceId for client diagnostics.
   */
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

    // (3) Duplicate-question guard. Bail before any DB work so a
    //     malicious client can't run up cost by spamming the same id.
    const seen = new Set<string>();
    for (const ans of answers) {
      if (seen.has(ans.questionId)) {
        throw new BadRequestException(
          `Duplicate questionId in submission: ${ans.questionId}`,
        );
      }
      seen.add(ans.questionId);
    }

    // (1) Membership guard: load the set of question ids that actually
    //     belong to this attempt's paper. Anything outside this set is
    //     a 400 — even if the caller's chosen question id exists in
    //     `questions`, it's still an invalid submission for this paper.
    const paperQuestions = await this.paperQuestionRepo.find({
      where: { paper_id: attempt.paper_id },
    });
    const allowedQuestionIds = new Set(
      paperQuestions.map((pq) => pq.question_id),
    );
    for (const ans of answers) {
      if (!allowedQuestionIds.has(ans.questionId)) {
        throw new BadRequestException(
          `Question ${ans.questionId} is not part of this attempt's paper`,
        );
      }
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
        // Belt-and-braces: even though (1) above already restricted
        // questionId to paper members, the question row itself could
        // have been deleted between the membership check and the
        // grading loop. Treat as a content error rather than a 500.
        throw new BadRequestException(
          `Question ${ans.questionId} not found`,
        );
      }

      let isCorrect: boolean | null = null;

      if (question.type === QuestionType.OBJECTIVE) {
        totalObjective++;

        if (ans.selectedOptionId) {
          const option = await this.optionRepo.findOne({
            where: { id: ans.selectedOptionId },
          });

          if (!option) {
            // Selected option does not exist at all — caller-side
            // content error.
            throw new BadRequestException(
              `Option ${ans.selectedOptionId} not found`,
            );
          }

          // (2) Cross-question option guard. The option must hang off
          //     the SAME question this answer is targeting. Without
          //     this check, an attacker could pass a known-correct
          //     option from a different question and silently grade
          //     as wrong (or worse, leak option metadata).
          if (option.question_id !== ans.questionId) {
            throw new BadRequestException(
              `Option ${ans.selectedOptionId} does not belong to question ${ans.questionId}`,
            );
          }

          isCorrect = option.is_correct;
          if (isCorrect) {
            correctCount++;
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

  /**
   * Redo an attempt — create a new attempt that RE-GENERATES its question
   * set from the ORIGINAL paper's generation rule, instead of reusing the
   * same fixed paper instance.
   *
   * audit_report-2 HIGH-2: the prior behaviour only copied `paper_id` to
   * the new attempt, so every redo walked the exact same question set
   * (violating the prompt semantics for redo regeneration and breaking
   * analytics/audit comparisons across attempts).
   *
   * New behaviour:
   *   1. Load the original attempt and its source paper.
   *   2. Enforce the same store-scope/hiding policy as paper reads so a
   *      store_admin cannot trigger a regeneration on an out-of-scope
   *      paper (404, never 403 — hiding policy).
   *   3. Re-run `selectQuestionsForRule` with the original paper's
   *      generation_rule + its store scope to pull a FRESH question set.
   *   4. Materialise a new Paper row (derived from the original rule,
   *      same store scope) so the model's fixed paper→question linkage
   *      is preserved without mutating the original paper.
   *   5. Create the redo Attempt pointing at the NEW paper and carrying
   *      `parent_attempt_id = original.id` so the chain stays intact.
   *   6. Leave the original attempt and its paper untouched.
   */
  async redoAttempt(
    attemptId: string,
    user: any,
  ): Promise<Attempt> {
    const userId: string = user?.id;
    const original = await this.attemptRepo.findOne({
      where: { id: attemptId },
    });

    if (!original) {
      throw new NotFoundException('Attempt not found');
    }

    if (original.user_id !== userId) {
      throw new BadRequestException('Attempt does not belong to this user');
    }

    // Load the source paper so we have its generation_rule + store scope.
    const sourcePaper = await this.paperRepo.findOne({
      where: { id: original.paper_id },
    });
    if (!sourcePaper) {
      // Original paper disappeared — treat same as missing attempt rather
      // than silently dropping regeneration on the floor.
      throw new NotFoundException('Source paper for attempt not found');
    }

    // Hiding policy: out-of-scope store_admin can't regenerate from a
    // foreign paper any more than they can read it.
    this.enforcePaperOwnership(sourcePaper, user);

    // Re-run the ORIGINAL generation rule, scoped to the same store as the
    // original paper. This is the "regenerate" contract — a new random
    // pull (or re-evaluated filter set) so the new attempt sees fresh
    // content, not a duplicate pointer.
    const generationRule = (sourcePaper.generation_rule as any) ?? {};
    const questions = await this.selectQuestionsForRule(
      generationRule,
      sourcePaper.store_id ?? null,
    );

    // Materialise a brand-new paper instance derived from the original
    // rule, same store scope. The name is suffixed so operators can tell
    // redo-derived papers apart from the originals in audit listings.
    const regeneratedPaper = await this.persistPaperWithQuestions({
      name: `${sourcePaper.name} (redo)`,
      generationRule,
      createdBy: userId,
      storeId: sourcePaper.store_id ?? null,
      questions,
    });

    const newAttempt = this.attemptRepo.create({
      paper_id: regeneratedPaper.id,
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
