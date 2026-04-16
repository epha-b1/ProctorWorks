/**
 * Quality API — endpoint coverage for POST /quality/rules (success),
 * GET /quality/rules, and GET /quality/scores.
 *
 * Real HTTP against `app.getHttpServer()`; no mocking of transport,
 * controllers, or services. Assertions cover status codes PLUS
 * meaningful response/state effects (rule persists + appears in
 * listing; scores endpoint returns array with expected shape).
 *
 * The 403 negative path is already pinned in `unit_tests/quality.spec`
 * and API-level role matrix. This spec is the missing positive-path
 * coverage for the remaining endpoints.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
const request = require('supertest');
import { AppModule } from '../src/app.module';

const U = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

function logStep(m: string, p: string, s?: number) {
  console.log(s !== undefined ? `  ← ${s}` : `  → ${m} ${p}`);
}

async function login(srv: any, u: string, p: string) {
  const r = await request(srv).post('/auth/login').send({ username: u, password: p });
  return r.body.accessToken;
}

describe('Quality API — POST /quality/rules, GET /quality/rules, GET /quality/scores', () => {
  let app: INestApplication;
  let server: any;
  let ds: DataSource;
  let adminToken: string;
  let auditorToken: string;
  let storeAdminToken: string;
  let createdRuleId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    server = app.getHttpServer();
    ds = mod.get(DataSource);

    adminToken = await login(server, 'admin', 'Admin1234!');
    auditorToken = await login(server, 'auditor', 'Admin1234!');

    // Provision a store_admin for the 403-on-GET-scores path.
    const saStore = await request(server)
      .post('/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `qualStore_${U}` });
    const saUser = `qualsa_${U}`.toLowerCase();
    await request(server)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: saUser, password: 'Admin1234!', role: 'store_admin', storeId: saStore.body.id });
    storeAdminToken = await login(server, saUser, 'Admin1234!');
  }, 60_000);

  afterAll(async () => {
    // Best-effort cleanup of the rule this suite seeded — defensive
    // (prevents pagination drift in future runs) and deterministic
    // (scoped to this suite's rule id only).
    if (createdRuleId) {
      try {
        await ds.query(`DELETE FROM data_quality_rules WHERE id = $1`, [createdRuleId]);
      } catch {
        /* best effort */
      }
    }
    await app.close();
  });

  // ---------------------------------------------------------------------
  // POST /quality/rules — success path
  // ---------------------------------------------------------------------
  describe('POST /quality/rules (success path)', () => {
    it('platform_admin → 201 with persisted rule id + matching fields', async () => {
      logStep('POST', '/quality/rules');
      const res = await request(server)
        .post('/quality/rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          entityType: 'products',
          ruleType: 'completeness',
          // Use a whitelisted column from the service's field allowlist
          // so the rule survives defense-in-depth validation.
          config: { fields: ['name'] },
        });
      logStep('POST', '/quality/rules', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(typeof res.body.id).toBe('string');
      expect(res.body).toHaveProperty('entity_type', 'products');
      expect(res.body).toHaveProperty('rule_type', 'completeness');
      expect(res.body.config).toEqual({ fields: ['name'] });
      // Persistence side-effect — the row lands in the DB.
      const [row] = await ds.query(
        `SELECT id, entity_type, rule_type FROM data_quality_rules WHERE id = $1`,
        [res.body.id],
      );
      expect(row).toBeDefined();
      expect(row.entity_type).toBe('products');
      createdRuleId = res.body.id;
    });

    it('invalid entityType → 400 (validation pipe rejects before service)', async () => {
      const res = await request(server)
        .post('/quality/rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          entityType: 'not-an-entity',
          ruleType: 'completeness',
          config: { fields: ['name'] },
        });
      expect(res.status).toBe(400);
    });

    it('non-admin role → 403 and nothing persists', async () => {
      const beforeCount = await ds.query(
        `SELECT COUNT(*)::int AS n FROM data_quality_rules`,
      );
      const res = await request(server)
        .post('/quality/rules')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          entityType: 'products',
          ruleType: 'completeness',
          config: { fields: ['name'] },
        });
      expect(res.status).toBe(403);
      const afterCount = await ds.query(
        `SELECT COUNT(*)::int AS n FROM data_quality_rules`,
      );
      expect(afterCount[0].n).toBe(beforeCount[0].n);
    });
  });

  // ---------------------------------------------------------------------
  // GET /quality/rules
  // ---------------------------------------------------------------------
  describe('GET /quality/rules', () => {
    it('platform_admin → 200 with array including the rule just created', async () => {
      logStep('GET', '/quality/rules');
      const res = await request(server)
        .get('/quality/rules')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/quality/rules', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const seeded = res.body.find((r: any) => r.id === createdRuleId);
      expect(seeded).toBeDefined();
      expect(seeded.entity_type).toBe('products');
      expect(seeded.rule_type).toBe('completeness');
    });

    it('no token → 401', async () => {
      const res = await request(server).get('/quality/rules');
      expect(res.status).toBe(401);
    });

    it('auditor token → 403 (platform_admin only)', async () => {
      const res = await request(server)
        .get('/quality/rules')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // GET /quality/scores
  // ---------------------------------------------------------------------
  describe('GET /quality/scores', () => {
    it('platform_admin → 200 with array shape', async () => {
      logStep('GET', '/quality/scores');
      const res = await request(server)
        .get('/quality/scores')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/quality/scores', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Shape check on any rows present — endpoint returns LATEST
      // per entity type; schema-coherence assertions on whatever
      // rows exist at request time. Does not assume a seed.
      for (const row of res.body) {
        expect(typeof row.entity_type).toBe('string');
        // Postgres NUMERIC round-trips as a string via node-pg; the
        // contract is "coercible to finite number in [0, 100]", not
        // a specific JS type. Asserting that directly is the
        // behavioural invariant; a stricter type assertion would
        // just test pg driver internals.
        const score = Number(row.score);
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });

    it('auditor → 200 (role grants read) with array shape', async () => {
      const res = await request(server)
        .get('/quality/scores')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('store_admin → 403 (not in role list)', async () => {
      const res = await request(server)
        .get('/quality/scores')
        .set('Authorization', `Bearer ${storeAdminToken}`);
      expect(res.status).toBe(403);
    });

    it('no token → 401', async () => {
      const res = await request(server).get('/quality/scores');
      expect(res.status).toBe(401);
    });
  });
});
