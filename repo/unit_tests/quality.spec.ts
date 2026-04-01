/**
 * Quality Service Unit Tests
 * Covers: score computation, freshness checks, rule evaluation.
 */
import { QualityService } from '../src/quality/quality.service';

describe('QualityService', () => {
  let service: QualityService;
  let ruleRepo: any;
  let scoreRepo: any;
  let dataSource: any;
  let configService: any;
  let notificationsService: any;

  beforeEach(() => {
    ruleRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((d) => d),
      save: jest.fn().mockImplementation((d) => Promise.resolve({ id: 'r1', ...d })),
    };
    scoreRepo = {
      create: jest.fn().mockImplementation((d) => d),
      save: jest.fn().mockImplementation((d) => Promise.resolve({ id: 's1', ...d })),
      createQueryBuilder: jest.fn().mockReturnValue({
        distinctOn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        select: jest.fn().mockReturnThis(),
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([{ total: '10', passing: '8' }]),
    };
    configService = {
      get: jest.fn().mockReturnValue(24),
    };
    notificationsService = {
      createForAdmins: jest.fn().mockResolvedValue(undefined),
    };

    service = new QualityService(
      ruleRepo,
      scoreRepo,
      dataSource,
      configService,
      notificationsService,
    );
  });

  describe('createRule', () => {
    it('creates and saves a quality rule', async () => {
      const dto = { entityType: 'products', ruleType: 'completeness', config: { fields: ['name'] } };
      const result = await service.createRule(dto as any);
      expect(ruleRepo.create).toHaveBeenCalledWith({
        entity_type: 'products',
        rule_type: 'completeness',
        config: { fields: ['name'] },
      });
      expect(ruleRepo.save).toHaveBeenCalled();
    });
  });

  describe('computeScore', () => {
    it('returns 100 when no rules exist', async () => {
      ruleRepo.find.mockResolvedValue([]);
      const result = await service.computeScore('products');
      expect(result.score).toBe(100);
      expect(scoreRepo.save).toHaveBeenCalled();
    });

    it('computes score when completeness rule exists', async () => {
      ruleRepo.find.mockResolvedValue([
        { id: 'r1', entity_type: 'products', rule_type: 'completeness', config: { fields: ['name', 'category_id'] } },
      ]);
      // Query 1: total count, Query 2: complete count
      dataSource.query
        .mockResolvedValueOnce([{ total: '10' }])
        .mockResolvedValueOnce([{ complete: '8' }]);
      const result = await service.computeScore('products');
      expect(result.score).toBe(80);
    });
  });

  describe('freshness check', () => {
    it('creates notification when data is stale', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      dataSource.query.mockResolvedValue([{ last_activity: oldDate }]);
      await service.checkFreshness();
      expect(notificationsService.createForAdmins).toHaveBeenCalledWith(
        'data_staleness',
        expect.stringContaining('has not been updated'),
      );
    });

    it('does not notify when data is fresh', async () => {
      const freshDate = new Date().toISOString();
      dataSource.query.mockResolvedValue([{ last_activity: freshDate }]);
      await service.checkFreshness();
      expect(notificationsService.createForAdmins).not.toHaveBeenCalled();
    });
  });
});
