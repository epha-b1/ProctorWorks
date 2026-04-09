/**
 * Quality Service Unit Tests
 * Covers: score computation, freshness checks, rule evaluation, and
 * the column-allowlist hardening that closes F-05 (SQL injection in
 * configurable quality rules).
 */
import { BadRequestException } from '@nestjs/common';
import { QualityService } from '../src/quality/quality.service';
import { RuleType } from '../src/quality/entities/data-quality-rule.entity';

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

    it('rejects unknown entity type with BadRequestException (not a plain Error)', async () => {
      // Regression for the "compute returns 500 on bad input" fail-causer.
      // It must surface as a 400-class HttpException, not a generic Error
      // that the global filter would map to 500.
      await expect(
        service.computeScore('not-a-valid-entity'),
      ).rejects.toThrow(BadRequestException);

      // And must short-circuit before touching the DB — no find / query /
      // save should fire for invalid input.
      expect(ruleRepo.find).not.toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(scoreRepo.save).not.toHaveBeenCalled();
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

  // ─── F-05: SQL injection hardening ──────────────────────────────────────
  // The createRule path validates rule.config columns/fields against a
  // strict per-entity allowlist before persistence, and the evaluator
  // re-validates at query time as defense in depth. The tests below
  // assert both halves: malicious payloads are rejected at create time,
  // and even if a row slips into the DB, evaluator can't expand it.
  describe('rule config validation (F-05)', () => {
    describe('createRule rejects malicious columns', () => {
      it('completeness with SQL fragment in fields[] is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'products',
            ruleType: 'completeness',
            config: { fields: ['name', '"; DROP TABLE users; --'] },
          } as any),
        ).rejects.toThrow(BadRequestException);
        expect(ruleRepo.save).not.toHaveBeenCalled();
      });

      it('completeness with quoted-identifier injection is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'products',
            ruleType: 'completeness',
            config: { fields: ['name"; DELETE FROM products; --'] },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('range with column referencing another table is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'products',
            ruleType: 'range',
            config: { column: 'users.password_hash', min: 0, max: 100 },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('range with non-numeric min/max is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'products',
            ruleType: 'range',
            config: { column: 'name', min: '0; DROP TABLE x; --' },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('uniqueness with arbitrary column is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'questions',
            ruleType: 'uniqueness',
            config: { column: 'definitely_not_a_real_column' },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rule with empty fields array is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'products',
            ruleType: 'completeness',
            config: { fields: [] },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('range rule without min or max is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'products',
            ruleType: 'range',
            config: { column: 'name' },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rule for unknown entity type is rejected', async () => {
        await expect(
          service.createRule({
            entityType: 'evil_entity',
            ruleType: 'completeness',
            config: { fields: ['name'] },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('column allowed for one entity is rejected for another', async () => {
        // `password_hash` is not in any allowlist — verify it's blocked
        // even when paired with the `users` entity, which has the most
        // permissive allowlist.
        await expect(
          service.createRule({
            entityType: 'users',
            ruleType: 'uniqueness',
            config: { column: 'password_hash' },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('createRule accepts whitelisted columns', () => {
      it('completeness with valid product columns persists', async () => {
        await service.createRule({
          entityType: 'products',
          ruleType: 'completeness',
          config: { fields: ['name', 'category_id', 'brand_id'] },
        } as any);
        expect(ruleRepo.save).toHaveBeenCalled();
      });

      it('range with valid order column persists', async () => {
        await service.createRule({
          entityType: 'orders',
          ruleType: 'range',
          config: { column: 'total_cents', min: 0, max: 100000 },
        } as any);
        expect(ruleRepo.save).toHaveBeenCalled();
      });

      it('uniqueness with valid user column persists', async () => {
        await service.createRule({
          entityType: 'users',
          ruleType: 'uniqueness',
          config: { column: 'username' },
        } as any);
        expect(ruleRepo.save).toHaveBeenCalled();
      });
    });

    describe('evaluator re-validates at query time (defense in depth)', () => {
      it('completeness rule with malicious field rejected at evaluation', async () => {
        // Simulate a rule row that bypassed the create-time guard
        // (e.g. inserted via direct DB write before this fix landed).
        ruleRepo.find.mockResolvedValue([
          {
            id: 'r1',
            entity_type: 'products',
            rule_type: RuleType.COMPLETENESS,
            config: { fields: ['name; DROP TABLE products; --'] },
            active: true,
          },
        ]);
        await expect(service.computeScore('products')).rejects.toThrow(
          BadRequestException,
        );
      });

      it('range rule with malicious column rejected at evaluation', async () => {
        ruleRepo.find.mockResolvedValue([
          {
            id: 'r1',
            entity_type: 'products',
            rule_type: RuleType.RANGE,
            config: { column: 'name UNION SELECT password_hash FROM users', min: 0, max: 1 },
            active: true,
          },
        ]);
        await expect(service.computeScore('products')).rejects.toThrow(
          BadRequestException,
        );
      });

      it('uniqueness rule with malicious column rejected at evaluation', async () => {
        ruleRepo.find.mockResolvedValue([
          {
            id: 'r1',
            entity_type: 'products',
            rule_type: RuleType.UNIQUENESS,
            config: { column: 'name"; DROP TABLE products; --' },
            active: true,
          },
        ]);
        await expect(service.computeScore('products')).rejects.toThrow(
          BadRequestException,
        );
      });
    });
  });
});
