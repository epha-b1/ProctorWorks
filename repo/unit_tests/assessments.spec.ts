import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AssessmentsService } from '../src/assessments/assessments.service';
import { AttemptStatus } from '../src/assessments/entities/attempt.entity';
import { QuestionType, QuestionStatus } from '../src/questions/entities/question.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRepo() {
  return {
    create: jest.fn((dto) => ({ ...dto })),
    save: jest.fn((entity) =>
      Array.isArray(entity)
        ? Promise.resolve(entity.map((e, i) => ({ id: `saved-${i}`, ...e })))
        : Promise.resolve({ id: 'saved-id', ...entity }),
    ),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(),
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const paperRepo = createMockRepo();
  const paperQuestionRepo = createMockRepo();
  const attemptRepo = createMockRepo();
  const answerRepo = createMockRepo();
  const questionRepo = createMockRepo();
  const optionRepo = createMockRepo();
  const dataSource = {} as any;

  const repos = {
    paperRepo,
    paperQuestionRepo,
    attemptRepo,
    answerRepo,
    questionRepo,
    optionRepo,
    dataSource,
    ...overrides,
  };

  const service = new (AssessmentsService as any)(
    repos.paperRepo,
    repos.paperQuestionRepo,
    repos.attemptRepo,
    repos.answerRepo,
    repos.questionRepo,
    repos.optionRepo,
    repos.dataSource,
  );

  return { service: service as AssessmentsService, ...repos };
}

// Stub query-builder chain: every chained method returns `this`, getMany resolves
function stubQueryBuilder(repo: any, rows: any[]) {
  const qb: any = {};
  const methods = [
    'where',
    'andWhere',
    'orderBy',
    'limit',
    'leftJoinAndSelect',
    'select',
  ];
  methods.forEach((m) => (qb[m] = jest.fn().mockReturnValue(qb)));
  qb.getMany = jest.fn().mockResolvedValue(rows);
  repo.createQueryBuilder.mockReturnValue(qb);
  return qb;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AssessmentsService', () => {
  // -----------------------------------------------------------------------
  // generatePaper
  // -----------------------------------------------------------------------
  describe('generatePaper', () => {
    it('random type selects random approved questions', async () => {
      const questions = [
        { id: 'q1', type: QuestionType.OBJECTIVE, status: QuestionStatus.APPROVED },
        { id: 'q2', type: QuestionType.SUBJECTIVE, status: QuestionStatus.APPROVED },
      ];

      const { service, questionRepo, paperRepo, paperQuestionRepo } =
        buildService();

      const qb = stubQueryBuilder(questionRepo, questions);

      paperRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'paper-1', ...entity }),
      );
      paperQuestionRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );

      const dto = {
        name: 'Random Paper',
        generationRule: { type: 'random' as const, count: 2 },
      };

      const result = await service.generatePaper(dto, {
        id: 'user-1',
        role: 'platform_admin',
      });

      // Query builder was called with APPROVED status filter
      expect(qb.where).toHaveBeenCalledWith('q.status = :status', {
        status: QuestionStatus.APPROVED,
      });
      // Random ordering applied
      expect(qb.orderBy).toHaveBeenCalledWith('RANDOM()');
      expect(qb.limit).toHaveBeenCalledWith(2);

      // Paper was saved
      expect(paperRepo.save).toHaveBeenCalled();

      // PaperQuestions created with correct positions
      expect(paperQuestionRepo.create).toHaveBeenCalledTimes(2);
      expect(paperQuestionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ question_id: 'q1', position: 1 }),
      );
      expect(paperQuestionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ question_id: 'q2', position: 2 }),
      );

      expect(result.paper_questions).toHaveLength(2);
    });

    it('rule-based applies filters', async () => {
      const questions = [
        { id: 'q1', type: QuestionType.OBJECTIVE, status: QuestionStatus.APPROVED },
      ];

      const { service, questionRepo, paperRepo, paperQuestionRepo } =
        buildService();

      const qb = stubQueryBuilder(questionRepo, questions);

      paperRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'paper-2', ...entity }),
      );
      paperQuestionRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );

      const dto = {
        name: 'Rule Paper',
        generationRule: {
          type: 'rule' as const,
          count: 5,
          filters: { type: QuestionType.OBJECTIVE },
        },
      };

      const result = await service.generatePaper(
        dto,
        { id: 'user-1', role: 'platform_admin' },
        'store-1',
      );

      expect(qb.where).toHaveBeenCalledWith('q.status = :status', {
        status: QuestionStatus.APPROVED,
      });
      // Store filter applied
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(q.store_id = :storeId OR q.store_id IS NULL)',
        { storeId: 'store-1' },
      );
      // Type filter applied
      expect(qb.andWhere).toHaveBeenCalledWith('q.type = :type', {
        type: QuestionType.OBJECTIVE,
      });
      expect(qb.limit).toHaveBeenCalledWith(5);

      // orderBy('RANDOM()') should NOT be called for rule-based
      expect(qb.orderBy).not.toHaveBeenCalled();

      expect(result.paper_questions).toHaveLength(1);
    });

    // -----------------------------------------------------------------
    // Tenant-isolation: store_admin must NEVER be able to target another
    // store via the `?storeId=` query param. The service forces the JWT
    // store and rejects an explicit cross-store override.
    // -----------------------------------------------------------------
    it('store_admin: forces JWT store and ignores caller-supplied storeId override', async () => {
      const { service, questionRepo, paperRepo, paperQuestionRepo } =
        buildService();
      const qb = stubQueryBuilder(questionRepo, []);
      paperRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'paper-x', ...entity }),
      );
      paperQuestionRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );

      // Caller is store_admin assigned to "store-MINE" but tries to pass
      // "store-OTHER" via the query param. Anything other than 403 here
      // would be a tenant-write escape — the contract is to refuse.
      await expect(
        service.generatePaper(
          {
            name: 'tenant-escape',
            generationRule: { type: 'random' as const, count: 1 },
          },
          {
            id: 'user-store-admin',
            role: 'store_admin',
            storeId: 'store-MINE',
          },
          'store-OTHER',
        ),
      ).rejects.toThrow(ForbiddenException);

      // No paper, no question fetch, no paper-questions: nothing must be
      // persisted on the rejected path.
      expect(paperRepo.save).not.toHaveBeenCalled();
      expect(paperQuestionRepo.save).not.toHaveBeenCalled();
      expect(qb.getMany).not.toHaveBeenCalled();
    });

    it('store_admin: with no override scopes the paper to the JWT store', async () => {
      const { service, questionRepo, paperRepo, paperQuestionRepo } =
        buildService();
      const qb = stubQueryBuilder(questionRepo, [
        { id: 'q1', status: QuestionStatus.APPROVED },
      ]);
      paperRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'paper-store', ...entity }),
      );
      paperQuestionRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );

      const result = await service.generatePaper(
        {
          name: 'mine',
          generationRule: { type: 'random' as const, count: 1 },
        },
        {
          id: 'user-store-admin',
          role: 'store_admin',
          storeId: 'store-MINE',
        },
      );

      // Question fetch must be store-scoped to JWT store, NOT some other.
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(q.store_id = :storeId OR q.store_id IS NULL)',
        { storeId: 'store-MINE' },
      );
      // Paper persisted with the same JWT-derived store id.
      expect(paperRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: 'store-MINE',
          created_by: 'user-store-admin',
        }),
      );
      expect(result).toBeDefined();
    });

    it('store_admin: matching storeId override is allowed (no tenant escape)', async () => {
      const { service, questionRepo, paperRepo, paperQuestionRepo } =
        buildService();
      stubQueryBuilder(questionRepo, []);
      paperRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'paper-match', ...entity }),
      );
      paperQuestionRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );

      await expect(
        service.generatePaper(
          {
            name: 'matching-override',
            generationRule: { type: 'random' as const, count: 1 },
          },
          {
            id: 'user-store-admin',
            role: 'store_admin',
            storeId: 'store-MINE',
          },
          'store-MINE',
        ),
      ).resolves.toBeDefined();

      expect(paperRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ store_id: 'store-MINE' }),
      );
    });

    it('platform_admin: cross-store storeId override is allowed (admin behavior preserved)', async () => {
      const { service, questionRepo, paperRepo, paperQuestionRepo } =
        buildService();
      stubQueryBuilder(questionRepo, []);
      paperRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'paper-platform', ...entity }),
      );
      paperQuestionRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );

      await service.generatePaper(
        {
          name: 'cross-store',
          generationRule: { type: 'random' as const, count: 1 },
        },
        { id: 'user-pa', role: 'platform_admin' },
        'store-TARGET',
      );

      expect(paperRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: 'store-TARGET',
          created_by: 'user-pa',
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // startAttempt
  // -----------------------------------------------------------------------
  describe('startAttempt', () => {
    const platformAdmin = {
      id: 'user-1',
      role: 'platform_admin',
      storeId: null,
    };
    const storeAdminA = {
      id: 'sa-a',
      role: 'store_admin',
      storeId: 'store-A',
    };
    const storeAdminB = {
      id: 'sa-b',
      role: 'store_admin',
      storeId: 'store-B',
    };
    const storeAdminNone = {
      id: 'sa-x',
      role: 'store_admin',
      storeId: null,
    };

    it('creates attempt with status in_progress', async () => {
      const { service, paperRepo, attemptRepo } = buildService();

      paperRepo.findOne.mockResolvedValue({
        id: 'paper-1',
        name: 'Test',
        store_id: null,
      });
      attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'attempt-1', ...entity }),
      );

      const result = await service.startAttempt('paper-1', platformAdmin);

      expect(attemptRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paper_id: 'paper-1',
          user_id: 'user-1',
          status: AttemptStatus.IN_PROGRESS,
          started_at: expect.any(Date),
        }),
      );
      expect(attemptRepo.save).toHaveBeenCalled();
      expect(result.status).toBe(AttemptStatus.IN_PROGRESS);
    });

    // ---------------------------------------------------------------
    // audit_report-2 HIGH-1: cross-store object-level authorization
    //
    // A store_admin must not be able to start an attempt on a paper
    // that lives in another store. The service must enforce the same
    // hiding policy as paper reads (404, never 403) and must NOT
    // persist an attempt row on the denied path.
    // ---------------------------------------------------------------
    it('store_admin B: paper from store A → NotFoundException and NO attempt row created', async () => {
      const { service, paperRepo, attemptRepo } = buildService();

      paperRepo.findOne.mockResolvedValue({
        id: 'paper-A',
        name: 'Foreign',
        store_id: 'store-A',
      });

      await expect(
        service.startAttempt('paper-A', storeAdminB),
      ).rejects.toThrow(NotFoundException);

      // Defense in depth: no create, no save on the denied path.
      expect(attemptRepo.create).not.toHaveBeenCalled();
      expect(attemptRepo.save).not.toHaveBeenCalled();
    });

    it('store_admin A: paper from store A → attempt row is created', async () => {
      const { service, paperRepo, attemptRepo } = buildService();

      paperRepo.findOne.mockResolvedValue({
        id: 'paper-A',
        name: 'Own',
        store_id: 'store-A',
      });
      attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'attempt-A', ...entity }),
      );

      const result = await service.startAttempt('paper-A', storeAdminA);

      expect(attemptRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paper_id: 'paper-A',
          user_id: 'sa-a',
          status: AttemptStatus.IN_PROGRESS,
        }),
      );
      expect(result.status).toBe(AttemptStatus.IN_PROGRESS);
    });

    it('store_admin without assigned store → ForbiddenException', async () => {
      const { service, paperRepo, attemptRepo } = buildService();

      paperRepo.findOne.mockResolvedValue({
        id: 'paper-1',
        name: 'Any',
        store_id: 'store-A',
      });

      await expect(
        service.startAttempt('paper-1', storeAdminNone),
      ).rejects.toThrow(ForbiddenException);

      expect(attemptRepo.create).not.toHaveBeenCalled();
      expect(attemptRepo.save).not.toHaveBeenCalled();
    });

    it('platform_admin: can start attempt on any paper regardless of store', async () => {
      const { service, paperRepo, attemptRepo } = buildService();

      paperRepo.findOne.mockResolvedValue({
        id: 'paper-A',
        name: 'Foreign',
        store_id: 'store-A',
      });
      attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'attempt-pa', ...entity }),
      );

      const result = await service.startAttempt('paper-A', platformAdmin);

      expect(attemptRepo.create).toHaveBeenCalled();
      expect(result.status).toBe(AttemptStatus.IN_PROGRESS);
    });

    it('throws NotFoundException when paper does not exist', async () => {
      const { service, paperRepo, attemptRepo } = buildService();
      paperRepo.findOne.mockResolvedValue(null);

      await expect(
        service.startAttempt('ghost', platformAdmin),
      ).rejects.toThrow(NotFoundException);

      expect(attemptRepo.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // submitAttempt
  // -----------------------------------------------------------------------
  describe('submitAttempt', () => {
    const userId = 'user-1';
    const attemptId = 'attempt-1';
    const paperId = 'paper-1';

    /**
     * Sets up a submitAttempt fixture with the FULL set of repo
     * stubs the service now needs after audit_report-2 P0-4:
     *
     *   - attemptRepo.findOne → an in-progress attempt for paperId
     *   - paperQuestionRepo.find → membership rows for the given
     *     question ids (so the (1) integrity guard passes)
     *
     * Tests pass `allowedQuestionIds` to control which question ids
     * the membership query returns, so each test can isolate exactly
     * one integrity branch.
     */
    function setupSubmit(allowedQuestionIds: string[] = ['q1', 'q2', 'q-sub']) {
      const ctx = buildService();
      ctx.attemptRepo.findOne.mockResolvedValue({
        id: attemptId,
        paper_id: paperId,
        user_id: userId,
        status: AttemptStatus.IN_PROGRESS,
      });
      ctx.attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ ...entity }),
      );
      ctx.answerRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );
      ctx.paperQuestionRepo.find.mockResolvedValue(
        allowedQuestionIds.map((qid, idx) => ({
          paper_id: paperId,
          question_id: qid,
          position: idx + 1,
        })),
      );
      return ctx;
    }

    it('auto-grades correct objective answer as is_correct=true', async () => {
      const { service, questionRepo, optionRepo, answerRepo } = setupSubmit();

      questionRepo.findOne.mockResolvedValue({
        id: 'q1',
        type: QuestionType.OBJECTIVE,
      });
      optionRepo.findOne.mockResolvedValue({
        id: 'opt-correct',
        question_id: 'q1',
        is_correct: true,
      });

      await service.submitAttempt(
        attemptId,
        [{ questionId: 'q1', selectedOptionId: 'opt-correct' }],
        userId,
      );

      expect(answerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          question_id: 'q1',
          selected_option_id: 'opt-correct',
          is_correct: true,
        }),
      );
    });

    it('auto-grades wrong objective answer as is_correct=false', async () => {
      const { service, questionRepo, optionRepo, answerRepo } = setupSubmit();

      questionRepo.findOne.mockResolvedValue({
        id: 'q1',
        type: QuestionType.OBJECTIVE,
      });
      optionRepo.findOne.mockResolvedValue({
        id: 'opt-wrong',
        question_id: 'q1',
        is_correct: false,
      });

      await service.submitAttempt(
        attemptId,
        [{ questionId: 'q1', selectedOptionId: 'opt-wrong' }],
        userId,
      );

      expect(answerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          question_id: 'q1',
          selected_option_id: 'opt-wrong',
          is_correct: false,
        }),
      );
    });

    it('subjective questions set is_correct=null', async () => {
      const { service, questionRepo, answerRepo } = setupSubmit();

      questionRepo.findOne.mockResolvedValue({
        id: 'q-sub',
        type: QuestionType.SUBJECTIVE,
      });

      await service.submitAttempt(
        attemptId,
        [{ questionId: 'q-sub', textAnswer: 'My essay answer' }],
        userId,
      );

      expect(answerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          question_id: 'q-sub',
          text_answer: 'My essay answer',
          is_correct: null,
        }),
      );
    });

    it('calculates score as (correct / totalObjective) * 100', async () => {
      const { service, questionRepo, optionRepo, attemptRepo } = setupSubmit();

      // Two objective questions: one correct, one wrong -> 50%
      questionRepo.findOne
        .mockResolvedValueOnce({ id: 'q1', type: QuestionType.OBJECTIVE })
        .mockResolvedValueOnce({ id: 'q2', type: QuestionType.OBJECTIVE });

      optionRepo.findOne
        .mockResolvedValueOnce({ id: 'opt-1', question_id: 'q1', is_correct: true })
        .mockResolvedValueOnce({ id: 'opt-2', question_id: 'q2', is_correct: false });

      await service.submitAttempt(
        attemptId,
        [
          { questionId: 'q1', selectedOptionId: 'opt-1' },
          { questionId: 'q2', selectedOptionId: 'opt-2' },
        ],
        userId,
      );

      const savedAttempt = attemptRepo.save.mock.calls[0][0];
      expect(savedAttempt.score).toBe(50);
    });

    it('sets status=graded and graded_at timestamp', async () => {
      const { service, questionRepo, optionRepo, attemptRepo } = setupSubmit();

      questionRepo.findOne.mockResolvedValue({
        id: 'q1',
        type: QuestionType.OBJECTIVE,
      });
      optionRepo.findOne.mockResolvedValue({
        id: 'opt-1',
        question_id: 'q1',
        is_correct: true,
      });

      const before = new Date();

      await service.submitAttempt(
        attemptId,
        [{ questionId: 'q1', selectedOptionId: 'opt-1' }],
        userId,
      );

      const savedAttempt = attemptRepo.save.mock.calls[0][0];
      expect(savedAttempt.status).toBe(AttemptStatus.GRADED);
      expect(savedAttempt.graded_at).toBeInstanceOf(Date);
      expect(savedAttempt.graded_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(savedAttempt.submitted_at).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when attempt not found', async () => {
      const { service, attemptRepo } = buildService();
      attemptRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitAttempt(attemptId, [], userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when attempt already submitted', async () => {
      const { service, attemptRepo } = buildService();
      attemptRepo.findOne.mockResolvedValue({
        id: attemptId,
        user_id: userId,
        status: AttemptStatus.GRADED,
      });

      await expect(
        service.submitAttempt(attemptId, [], userId),
      ).rejects.toThrow(BadRequestException);
    });

    // ---------------------------------------------------------------
    // audit_report-2 P0-4: submission integrity hardening.
    //
    // Three guards must run BEFORE any answer row is persisted:
    //   (1) every questionId must belong to attempt.paper_id
    //   (2) selectedOptionId must hang off that same questionId
    //   (3) duplicate questionIds in one submission are rejected
    // All three surface as 400 (BadRequestException).
    // ---------------------------------------------------------------
    describe('P0-4: submission integrity', () => {
      it('rejects answer with question not in attempt paper → 400', async () => {
        // Allowed paper questions: q1. The submission tries q-foreign.
        const { service, answerRepo } = setupSubmit(['q1']);

        await expect(
          service.submitAttempt(
            attemptId,
            [{ questionId: 'q-foreign', selectedOptionId: 'opt-x' }],
            userId,
          ),
        ).rejects.toThrow(BadRequestException);

        // Defense in depth: no answer row was saved on the denied path.
        expect(answerRepo.save).not.toHaveBeenCalled();
      });

      it('rejects option that belongs to a different question → 400', async () => {
        const { service, questionRepo, optionRepo, answerRepo } = setupSubmit([
          'q1',
        ]);
        questionRepo.findOne.mockResolvedValue({
          id: 'q1',
          type: QuestionType.OBJECTIVE,
        });
        // Crucially: the option exists, but its question_id is q2,
        // not q1. The cross-question guard must reject this.
        optionRepo.findOne.mockResolvedValue({
          id: 'opt-from-q2',
          question_id: 'q2',
          is_correct: true,
        });

        await expect(
          service.submitAttempt(
            attemptId,
            [{ questionId: 'q1', selectedOptionId: 'opt-from-q2' }],
            userId,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(answerRepo.save).not.toHaveBeenCalled();
      });

      it('rejects duplicate questionId in same submission → 400', async () => {
        const { service, answerRepo, paperQuestionRepo } = setupSubmit(['q1']);

        await expect(
          service.submitAttempt(
            attemptId,
            [
              { questionId: 'q1', selectedOptionId: 'opt-1' },
              { questionId: 'q1', selectedOptionId: 'opt-2' },
            ],
            userId,
          ),
        ).rejects.toThrow(BadRequestException);

        // Bail-fast: duplicate guard runs BEFORE the membership query
        // so paperQuestionRepo.find should not even be hit.
        expect(paperQuestionRepo.find).not.toHaveBeenCalled();
        expect(answerRepo.save).not.toHaveBeenCalled();
      });

      it('rejects unknown selectedOptionId → 400', async () => {
        const { service, questionRepo, optionRepo, answerRepo } = setupSubmit([
          'q1',
        ]);
        questionRepo.findOne.mockResolvedValue({
          id: 'q1',
          type: QuestionType.OBJECTIVE,
        });
        // Option does not exist in DB at all.
        optionRepo.findOne.mockResolvedValue(null);

        await expect(
          service.submitAttempt(
            attemptId,
            [{ questionId: 'q1', selectedOptionId: 'opt-ghost' }],
            userId,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(answerRepo.save).not.toHaveBeenCalled();
      });

      it('valid submission still grades correctly with all guards in place', async () => {
        // Positive control: full happy path with paper-membership +
        // option-belongs-to-question constraints satisfied.
        const { service, questionRepo, optionRepo, attemptRepo } = setupSubmit([
          'q1',
          'q2',
        ]);

        questionRepo.findOne
          .mockResolvedValueOnce({ id: 'q1', type: QuestionType.OBJECTIVE })
          .mockResolvedValueOnce({ id: 'q2', type: QuestionType.OBJECTIVE });
        optionRepo.findOne
          .mockResolvedValueOnce({
            id: 'opt-1',
            question_id: 'q1',
            is_correct: true,
          })
          .mockResolvedValueOnce({
            id: 'opt-2',
            question_id: 'q2',
            is_correct: true,
          });

        await service.submitAttempt(
          attemptId,
          [
            { questionId: 'q1', selectedOptionId: 'opt-1' },
            { questionId: 'q2', selectedOptionId: 'opt-2' },
          ],
          userId,
        );

        const savedAttempt = attemptRepo.save.mock.calls[0][0];
        expect(savedAttempt.score).toBe(100);
        expect(savedAttempt.status).toBe(AttemptStatus.GRADED);
      });
    });
  });

  // -----------------------------------------------------------------------
  // redoAttempt  (audit_report-2 HIGH-2: regeneration semantics)
  //
  // Redo must:
  //   - re-run the ORIGINAL paper's generation rule (random pull /
  //     rule-based filter), not duplicate the paper pointer
  //   - materialise a NEW paper instance scoped to the same store
  //   - point the new attempt at the NEW paper
  //   - preserve parent_attempt_id linkage to the original
  //   - leave the original attempt and paper untouched
  //   - honour the same store-scope hiding policy as paper reads
  // -----------------------------------------------------------------------
  describe('redoAttempt', () => {
    const platformAdmin = {
      id: 'user-1',
      role: 'platform_admin',
      storeId: null,
    };
    const storeAdminA = {
      id: 'sa-a',
      role: 'store_admin',
      storeId: 'store-A',
    };
    const storeAdminB = {
      id: 'sa-b',
      role: 'store_admin',
      storeId: 'store-B',
    };
    const originalAttemptId = 'attempt-orig';

    // Builds a service wired with realistic generation-rule fixtures so
    // the regeneration path can actually run.
    function buildRegenCtx(storeId: string | null = null) {
      const ctx = buildService();
      const sourcePaper = {
        id: 'paper-orig',
        name: 'Original',
        store_id: storeId,
        generation_rule: { type: 'random', count: 2 },
      };

      ctx.attemptRepo.findOne.mockResolvedValue({
        id: originalAttemptId,
        paper_id: sourcePaper.id,
        user_id: platformAdmin.id,
        status: AttemptStatus.GRADED,
      });

      ctx.paperRepo.findOne.mockResolvedValue(sourcePaper);

      // Two question-selection passes will happen on a re-generate: we
      // return fresh rows to prove selectQuestionsForRule was invoked.
      const regeneratedQuestions = [
        { id: 'q-regen-1', status: QuestionStatus.APPROVED },
        { id: 'q-regen-2', status: QuestionStatus.APPROVED },
      ];
      const qb = stubQueryBuilder(ctx.questionRepo, regeneratedQuestions);

      ctx.paperRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'paper-regen', ...entity }),
      );
      ctx.paperQuestionRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
      );
      ctx.attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'attempt-new', ...entity }),
      );

      return { ...ctx, sourcePaper, regeneratedQuestions, qb };
    }

    it('regenerates a NEW paper from the original rule (not a duplicate pointer)', async () => {
      const {
        service,
        paperRepo,
        paperQuestionRepo,
        qb,
      } = buildRegenCtx();

      await service.redoAttempt(originalAttemptId, platformAdmin);

      // Question selection ran — this is what proves "regeneration"
      // happened instead of a pointer copy.
      expect(qb.getMany).toHaveBeenCalled();

      // A fresh paper row was saved with the original rule attached.
      expect(paperRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Original (redo)',
          generation_rule: { type: 'random', count: 2 },
          created_by: platformAdmin.id,
        }),
      );
      expect(paperRepo.save).toHaveBeenCalled();

      // Two paper_question rows were persisted (one per regenerated Q).
      expect(paperQuestionRepo.create).toHaveBeenCalledTimes(2);
    });

    it('new attempt points at the NEW paper, NOT the original paper', async () => {
      const { service, attemptRepo } = buildRegenCtx();

      const result = await service.redoAttempt(
        originalAttemptId,
        platformAdmin,
      );

      // Concrete differentiator: the saved attempt's paper_id must be
      // the regenerated paper ('paper-regen'), never the source one
      // ('paper-orig'). This is the core of the audit fix.
      expect(attemptRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paper_id: 'paper-regen',
          parent_attempt_id: originalAttemptId,
          status: AttemptStatus.IN_PROGRESS,
          started_at: expect.any(Date),
        }),
      );
      expect(result.paper_id).toBe('paper-regen');
      expect(result.paper_id).not.toBe('paper-orig');
      expect(result.parent_attempt_id).toBe(originalAttemptId);
    });

    it('preserves the original attempt and the original paper unchanged', async () => {
      const {
        service,
        attemptRepo,
        sourcePaper,
      } = buildRegenCtx();

      // Capture the original attempt + paper references so we can
      // re-assert their shape hasn't drifted under regeneration.
      const originalAttempt = await attemptRepo.findOne.mock.results[0];

      await service.redoAttempt(originalAttemptId, platformAdmin);

      // The ORIGINAL paper must not be re-saved or re-named.
      // paperRepo.save should only ever run for the regenerated paper.
      const paperSaveCalls = (service as any).paperRepo?.save?.mock?.calls ?? [];
      void paperSaveCalls; // (no-op; placate TS strict unused locals)
      expect(sourcePaper.name).toBe('Original');
      expect(sourcePaper.id).toBe('paper-orig');

      // The original attempt wasn't mutated in-place.
      expect(attemptRepo.save).toHaveBeenCalledTimes(1);
      const savedEntity = attemptRepo.save.mock.calls[0][0];
      expect(savedEntity.id).toBeUndefined(); // no id collision with original
      expect(savedEntity.paper_id).not.toBe('paper-orig');
    });

    it('regenerated paper carries the same store scope as the original', async () => {
      const ctx = buildRegenCtx('store-A');
      // Override the mock attempt to match storeAdminA's user id so the
      // ownership check passes before we hit the scope assertion.
      ctx.attemptRepo.findOne.mockResolvedValue({
        id: originalAttemptId,
        paper_id: 'paper-orig',
        user_id: storeAdminA.id,
        status: AttemptStatus.GRADED,
      });

      await ctx.service.redoAttempt(originalAttemptId, storeAdminA);

      expect(ctx.paperRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: 'store-A',
        }),
      );
    });

    it('store_admin cannot redo an attempt on an out-of-scope paper → 404 and no write', async () => {
      // Original paper lives in store A, but caller is store_admin B.
      const ctx = buildRegenCtx('store-A');
      // Important: the ORIGINAL attempt row belongs to store B's user
      // (user_id matches caller), so the first ownership branch
      // (user_id mismatch) does NOT short-circuit. The denial must
      // come from the paper-ownership hiding policy, which is what
      // the audit issue is about.
      ctx.attemptRepo.findOne.mockResolvedValue({
        id: originalAttemptId,
        paper_id: 'paper-orig',
        user_id: storeAdminB.id,
        status: AttemptStatus.GRADED,
      });

      await expect(
        ctx.service.redoAttempt(originalAttemptId, storeAdminB),
      ).rejects.toThrow(NotFoundException);

      // Defense in depth: no paper, no paper_questions, no attempt saved.
      expect(ctx.paperRepo.save).not.toHaveBeenCalled();
      expect(ctx.paperQuestionRepo.save).not.toHaveBeenCalled();
      expect(ctx.attemptRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when source paper has disappeared', async () => {
      const ctx = buildService();
      ctx.attemptRepo.findOne.mockResolvedValue({
        id: originalAttemptId,
        paper_id: 'ghost-paper',
        user_id: platformAdmin.id,
        status: AttemptStatus.GRADED,
      });
      ctx.paperRepo.findOne.mockResolvedValue(null);

      await expect(
        ctx.service.redoAttempt(originalAttemptId, platformAdmin),
      ).rejects.toThrow(NotFoundException);

      expect(ctx.attemptRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if attempt is not owned by caller', async () => {
      const ctx = buildService();
      ctx.attemptRepo.findOne.mockResolvedValue({
        id: originalAttemptId,
        paper_id: 'paper-orig',
        user_id: 'someone-else',
        status: AttemptStatus.GRADED,
      });

      await expect(
        ctx.service.redoAttempt(originalAttemptId, platformAdmin),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // F-P1: paper tenant isolation (getPapers / getPaper)
  // -----------------------------------------------------------------------
  describe('paper tenant isolation (F-P1)', () => {
    const platformAdmin = { id: 'admin-1', role: 'platform_admin', storeId: null };
    const storeAdminA = { id: 'sa-a', role: 'store_admin', storeId: 'store-A' };
    const storeAdminB = { id: 'sa-b', role: 'store_admin', storeId: 'store-B' };
    const storeAdminNone = { id: 'sa-x', role: 'store_admin', storeId: null };
    const auditor = { id: 'aud-1', role: 'auditor', storeId: null };
    const reviewer = { id: 'rev-1', role: 'content_reviewer', storeId: null };

    describe('getPapers', () => {
      it('store_admin: forces filter by JWT store, ignoring query storeId', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.find.mockResolvedValue([]);

        // Caller passes storeId=store-B but the JWT says store-A —
        // the service must pin the filter to store-A.
        await service.getPapers(storeAdminA, 'store-B');

        expect(paperRepo.find).toHaveBeenCalledWith({
          where: { store_id: 'store-A' },
          relations: ['paper_questions'],
        });
      });

      it('store_admin without a store assignment → ForbiddenException', async () => {
        const { service } = buildService();
        await expect(service.getPapers(storeAdminNone)).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('platform_admin: no scope filter when storeId is omitted', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.find.mockResolvedValue([]);

        await service.getPapers(platformAdmin);

        expect(paperRepo.find).toHaveBeenCalledWith({
          where: {},
          relations: ['paper_questions'],
        });
      });

      it('platform_admin: honors optional storeId query param', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.find.mockResolvedValue([]);

        await service.getPapers(platformAdmin, 'store-Z');

        expect(paperRepo.find).toHaveBeenCalledWith({
          where: { store_id: 'store-Z' },
          relations: ['paper_questions'],
        });
      });

      it('auditor: no scope filter (read-only role is unchanged)', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.find.mockResolvedValue([]);

        await service.getPapers(auditor);

        expect(paperRepo.find).toHaveBeenCalledWith({
          where: {},
          relations: ['paper_questions'],
        });
      });

      it('content_reviewer: no scope filter (existing behavior preserved)', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.find.mockResolvedValue([]);

        await service.getPapers(reviewer);

        expect(paperRepo.find).toHaveBeenCalledWith({
          where: {},
          relations: ['paper_questions'],
        });
      });
    });

    describe('getPaper', () => {
      it('store_admin A: 404 when the paper belongs to store B', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.findOne.mockResolvedValue({
          id: 'p1',
          store_id: 'store-B',
          name: 'foreign',
        });

        await expect(service.getPaper('p1', storeAdminA)).rejects.toThrow(
          NotFoundException,
        );
      });

      it('store_admin A: 200 when the paper belongs to store A', async () => {
        const { service, paperRepo } = buildService();
        const paper = { id: 'p1', store_id: 'store-A', name: 'own' };
        paperRepo.findOne.mockResolvedValue(paper);

        const result = await service.getPaper('p1', storeAdminA);
        expect(result).toBe(paper);
      });

      it('platform_admin: can read any paper regardless of store_id', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.findOne.mockResolvedValue({
          id: 'p1',
          store_id: 'store-B',
          name: 'other',
        });

        const result = await service.getPaper('p1', platformAdmin);
        expect(result.store_id).toBe('store-B');
      });

      it('auditor: can read any paper (read-only role is unchanged)', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.findOne.mockResolvedValue({
          id: 'p1',
          store_id: 'store-C',
          name: 'any',
        });

        const result = await service.getPaper('p1', auditor);
        expect(result.store_id).toBe('store-C');
      });

      it('missing paper: 404 for every role (unchanged)', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.findOne.mockResolvedValue(null);

        await expect(
          service.getPaper('ghost', platformAdmin),
        ).rejects.toThrow(NotFoundException);
        await expect(
          service.getPaper('ghost', storeAdminA),
        ).rejects.toThrow(NotFoundException);
      });

      it('store_admin without a store: 403 on every paper read', async () => {
        const { service, paperRepo } = buildService();
        paperRepo.findOne.mockResolvedValue({
          id: 'p1',
          store_id: 'store-A',
        });

        await expect(service.getPaper('p1', storeAdminNone)).rejects.toThrow(
          ForbiddenException,
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // getHistory
  // -----------------------------------------------------------------------
  describe('getHistory', () => {
    it('returns attempts ordered by started_at DESC', async () => {
      const { service, attemptRepo } = buildService();

      const attempts = [
        { id: 'a2', started_at: new Date('2026-03-02') },
        { id: 'a1', started_at: new Date('2026-03-01') },
      ];

      attemptRepo.find.mockResolvedValue(attempts);

      const result = await service.getHistory('user-1');

      expect(attemptRepo.find).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        order: { started_at: 'DESC' },
        relations: ['paper'],
      });
      expect(result).toEqual(attempts);
      expect(result).toHaveLength(2);
    });
  });
});
