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
    it('creates attempt with status in_progress', async () => {
      const { service, paperRepo, attemptRepo } = buildService();

      paperRepo.findOne.mockResolvedValue({ id: 'paper-1', name: 'Test' });
      attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'attempt-1', ...entity }),
      );

      const result = await service.startAttempt('paper-1', 'user-1');

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
  });

  // -----------------------------------------------------------------------
  // submitAttempt
  // -----------------------------------------------------------------------
  describe('submitAttempt', () => {
    const userId = 'user-1';
    const attemptId = 'attempt-1';

    function setupSubmit() {
      const ctx = buildService();
      ctx.attemptRepo.findOne.mockResolvedValue({
        id: attemptId,
        user_id: userId,
        status: AttemptStatus.IN_PROGRESS,
      });
      ctx.attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ ...entity }),
      );
      ctx.answerRepo.save.mockImplementation((entities: any) =>
        Promise.resolve(entities),
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
        .mockResolvedValueOnce({ id: 'opt-1', is_correct: true })
        .mockResolvedValueOnce({ id: 'opt-2', is_correct: false });

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
  });

  // -----------------------------------------------------------------------
  // redoAttempt
  // -----------------------------------------------------------------------
  describe('redoAttempt', () => {
    const userId = 'user-1';
    const originalAttemptId = 'attempt-orig';

    it('creates new attempt with parent_attempt_id set', async () => {
      const { service, attemptRepo } = buildService();

      const original = {
        id: originalAttemptId,
        paper_id: 'paper-1',
        user_id: userId,
        status: AttemptStatus.GRADED,
      };

      attemptRepo.findOne.mockResolvedValue(original);
      attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'attempt-new', ...entity }),
      );

      const result = await service.redoAttempt(originalAttemptId, userId);

      expect(attemptRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paper_id: 'paper-1',
          user_id: userId,
          parent_attempt_id: originalAttemptId,
          status: AttemptStatus.IN_PROGRESS,
          started_at: expect.any(Date),
        }),
      );
      expect(result.parent_attempt_id).toBe(originalAttemptId);
      expect(result.status).toBe(AttemptStatus.IN_PROGRESS);
    });

    it('preserves original attempt (does not modify it)', async () => {
      const { service, attemptRepo } = buildService();

      const original = {
        id: originalAttemptId,
        paper_id: 'paper-1',
        user_id: userId,
        status: AttemptStatus.GRADED,
        score: 80,
      };

      attemptRepo.findOne.mockResolvedValue(original);
      attemptRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'attempt-new', ...entity }),
      );

      await service.redoAttempt(originalAttemptId, userId);

      // The original object must remain unchanged
      expect(original.status).toBe(AttemptStatus.GRADED);
      expect(original.score).toBe(80);
      expect(original.id).toBe(originalAttemptId);

      // attemptRepo.save should only have been called once (for the NEW attempt)
      expect(attemptRepo.save).toHaveBeenCalledTimes(1);
      const savedEntity = attemptRepo.save.mock.calls[0][0];
      // The saved entity is NOT the original
      expect(savedEntity).not.toBe(original);
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
