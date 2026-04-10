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

  // ─── audit_report-2 P1-6: freshness query robustness ─────────────
  //
  // checkFreshness() now runs in two phases per table:
  //   1. metadata probe — query information_schema.columns to learn
  //      which timestamp columns exist
  //   2. dynamic GREATEST(...) using only the columns we know are
  //      present
  //
  // The previous SQL embedded `MAX(updated_at)` literally inside a
  // CASE WHEN EXISTS subquery — that doesn't work because Postgres
  // parses the column reference at plan time and fails for any table
  // without updated_at (products, questions, inventory_lots).
  //
  // Helper builds a `dataSource.query` mock whose ORDERED responses
  // line up with the per-table loop: for each entity type, the first
  // call gets the metadata response, the second gets the activity
  // result. Tests below configure these per case.
  describe('freshness check', () => {
    // ALL_ENTITY_TYPES inside the service is:
    //   ['products', 'orders', 'questions', 'users', 'inventory']
    // Each table goes through (metadata-probe → activity-query) so
    // each iteration consumes 1 or 2 mock calls depending on whether
    // the metadata reports any timestamp columns.
    function pushTablePair(
      mock: jest.Mock,
      columns: string[],
      lastActivity: string | null,
    ) {
      // Phase 1: metadata probe response
      mock.mockResolvedValueOnce(
        columns.map((c) => ({ column_name: c })),
      );
      // Phase 2: activity query response — only fires if columns
      // is non-empty (the service skips the activity query when
      // there are no timestamp columns).
      if (columns.length > 0) {
        mock.mockResolvedValueOnce([{ last_activity: lastActivity }]);
      }
    }

    it('creates notification when data is stale (table has updated_at)', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      // Mock the loop for all 5 entity types: every one returns
      // updated_at + created_at with a stale timestamp.
      for (let i = 0; i < 5; i++) {
        pushTablePair(dataSource.query, ['updated_at', 'created_at'], oldDate);
      }

      await service.checkFreshness();

      expect(notificationsService.createForAdmins).toHaveBeenCalledWith(
        'data_staleness',
        expect.stringContaining('has not been updated'),
      );
    });

    it('does not notify when data is fresh', async () => {
      const freshDate = new Date().toISOString();
      for (let i = 0; i < 5; i++) {
        pushTablePair(
          dataSource.query,
          ['updated_at', 'created_at'],
          freshDate,
        );
      }

      await service.checkFreshness();

      expect(notificationsService.createForAdmins).not.toHaveBeenCalled();
    });

    // ─── P1-6 robustness: works for tables WITHOUT updated_at ───
    //
    // The new metadata-driven path must produce a valid SELECT for
    // tables that only carry `created_at` (e.g. products, questions,
    // inventory_lots). The previous code generated invalid SQL here
    // and the per-table try/catch swallowed the error silently —
    // meaning freshness checks were silently no-ops on those tables.
    it('handles tables that only have created_at without raising', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      for (let i = 0; i < 5; i++) {
        pushTablePair(dataSource.query, ['created_at'], oldDate);
      }

      await service.checkFreshness();

      // Critical: the activity query must have been issued (i.e.
      // the code didn't crash on the metadata phase). The
      // notification should still fire because the date is stale.
      expect(notificationsService.createForAdmins).toHaveBeenCalled();

      // Inspect the SQL strings sent to dataSource.query: NO call
      // should reference `updated_at` for created_at-only tables.
      const queries = dataSource.query.mock.calls.map((c: any[]) =>
        String(c[0]),
      );
      const activityQueries = queries.filter((q: string) =>
        q.includes('last_activity'),
      );
      for (const q of activityQueries) {
        // For created_at-only mocks, the rendered SQL must reference
        // MAX("created_at") and NEVER MAX("updated_at"). This is
        // the regression-proof for the freshness fix.
        expect(q).toContain('"created_at"');
        expect(q).not.toContain('"updated_at"');
      }
    });

    it('skips tables with neither updated_at nor created_at (no crash)', async () => {
      // Edge case: a hypothetical table with no timestamp columns at
      // all. The freshness loop must NOT issue an activity query
      // (it would have nothing to MAX) and must NOT raise.
      for (let i = 0; i < 5; i++) {
        pushTablePair(dataSource.query, [], null);
      }

      await service.checkFreshness();

      expect(notificationsService.createForAdmins).not.toHaveBeenCalled();

      // Only metadata probes ran — no activity queries.
      const queries = dataSource.query.mock.calls.map((c: any[]) =>
        String(c[0]),
      );
      const activityQueries = queries.filter((q: string) =>
        q.includes('last_activity'),
      );
      expect(activityQueries).toHaveLength(0);
    });

    it('uses GREATEST when both updated_at and created_at exist', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      for (let i = 0; i < 5; i++) {
        pushTablePair(
          dataSource.query,
          ['updated_at', 'created_at'],
          oldDate,
        );
      }

      await service.checkFreshness();

      // Verify the SELECT actually uses GREATEST so the activity
      // signal is the LATEST timestamp, not just one of them.
      const queries = dataSource.query.mock.calls.map((c: any[]) =>
        String(c[0]),
      );
      const activityQueries = queries.filter((q: string) =>
        q.includes('last_activity'),
      );
      for (const q of activityQueries) {
        expect(q).toContain('GREATEST');
        expect(q).toContain('"updated_at"');
        expect(q).toContain('"created_at"');
      }
    });

    it('per-table failure does not abort the whole loop', async () => {
      // First metadata probe throws, but the next 4 tables still
      // need to be processed (the existing try/catch is a feature,
      // not a bug — we keep it).
      const freshDate = new Date().toISOString();
      dataSource.query.mockReset();
      dataSource.query.mockRejectedValueOnce(new Error('fake metadata fail'));
      // Remaining 4 tables: provide normal pairs.
      for (let i = 0; i < 4; i++) {
        pushTablePair(
          dataSource.query,
          ['updated_at', 'created_at'],
          freshDate,
        );
      }

      // Must not throw — the try/catch wraps each table iteration.
      await expect(service.checkFreshness()).resolves.toBeUndefined();
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
