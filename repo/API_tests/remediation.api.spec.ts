/**
 * Remediation API tests
 *
 * Closes the mandatory coverage gaps called out in the audit report:
 *
 *  F-01  Assessments role authorization — auditor must get 403 on every
 *        write endpoint (generate / start / submit / redo).
 *
 *  F-02  Questions tenant isolation + object-level authorization —
 *        store_admin cannot create / update / delete / read-stats for a
 *        question that lives in a different store.
 *
 *  F-03  Logout / token lifecycle — a JWT becomes unusable after the
 *        logout endpoint runs (subsequent requests return 401), and
 *        suspending a user invalidates their active sessions.
 *
 *  F-P1  Assessments paper tenant isolation — store_admin cannot
 *        enumerate or read papers that belong to a different store;
 *        out-of-scope reads return 404 (not 403).
 *
 * These all run against a real NestJS app + Postgres so they cover the
 * full guard / strategy / service stack and would have caught the
 * pre-remediation defects.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';

const U = Date.now();

async function login(srv: any, username: string, password: string) {
  const r = await request(srv)
    .post('/auth/login')
    .send({ username, password });
  return r.body.accessToken as string;
}

describe('Remediation: F-01/F-02/F-03 mandatory coverage', () => {
  let app: INestApplication;
  let server: any;

  let adminToken: string;
  let auditorToken: string;
  let reviewerToken: string;

  let storeA: { id: string };
  let storeB: { id: string };
  let storeAdminAToken: string;
  let storeAdminBToken: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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

    adminToken = await login(server, 'admin', 'Admin1234!');

    // Two distinct stores so cross-tenant tests have somewhere to point to.
    const aRes = await request(server)
      .post('/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RemA${U}` });
    storeA = aRes.body;
    const bRes = await request(server)
      .post('/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RemB${U}` });
    storeB = bRes.body;

    // Disposable users for every role variant we exercise.
    await request(server)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: `remaud${U}`,
        password: 'Admin1234!',
        role: 'auditor',
      });
    await request(server)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: `remrev${U}`,
        password: 'Admin1234!',
        role: 'content_reviewer',
      });
    await request(server)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: `remsaA${U}`,
        password: 'Admin1234!',
        role: 'store_admin',
        storeId: storeA.id,
      });
    await request(server)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: `remsaB${U}`,
        password: 'Admin1234!',
        role: 'store_admin',
        storeId: storeB.id,
      });

    auditorToken = await login(server, `remaud${U}`, 'Admin1234!');
    reviewerToken = await login(server, `remrev${U}`, 'Admin1234!');
    storeAdminAToken = await login(server, `remsaA${U}`, 'Admin1234!');
    storeAdminBToken = await login(server, `remsaB${U}`, 'Admin1234!');
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-01: Assessments role authorization
  // ──────────────────────────────────────────────────────────────────────
  describe('F-01: Assessments role authorization', () => {
    let paperId: string;
    let attemptId: string;
    let questionId: string;
    let correctOptionId: string;

    beforeAll(async () => {
      // Seed an approved objective question + paper + attempt as admin so
      // the auditor has something concrete to be denied write access to.
      const q = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'objective',
          body: `RemQ${U}`,
          options: [
            { body: 'right', isCorrect: true },
            { body: 'wrong', isCorrect: false },
          ],
        });
      questionId = q.body.id;
      correctOptionId = q.body.options.find((o: any) => o.is_correct).id;
      await request(server)
        .post(`/questions/${questionId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const p = await request(server)
        .post('/papers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `RemPaper${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      paperId = p.body.id;

      const a = await request(server)
        .post('/attempts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paperId });
      attemptId = a.body.id;
    }, 30_000);

    it('auditor cannot generate a paper → 403', async () => {
      const res = await request(server)
        .post('/papers')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          name: `Auditor${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(res.status).toBe(403);
    });

    it('auditor cannot start an attempt → 403', async () => {
      const res = await request(server)
        .post('/attempts')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ paperId });
      expect(res.status).toBe(403);
    });

    it('auditor cannot submit an attempt → 403', async () => {
      const res = await request(server)
        .post(`/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          answers: [
            { questionId, selectedOptionId: correctOptionId },
          ],
        });
      expect(res.status).toBe(403);
    });

    it('auditor cannot redo an attempt → 403', async () => {
      const res = await request(server)
        .post(`/attempts/${attemptId}/redo`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(res.status).toBe(403);
    });

    it('auditor CAN read papers list → 200 (read-only role)', async () => {
      const res = await request(server)
        .get('/papers')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(res.status).toBe(200);
    });

    it('auditor CAN read paper detail → 200', async () => {
      const res = await request(server)
        .get(`/papers/${paperId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(res.status).toBe(200);
    });

    it('auditor CAN read attempts history → 200', async () => {
      const res = await request(server)
        .get('/attempts/history')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(res.status).toBe(200);
    });

    it('content_reviewer CAN generate a paper → 201', async () => {
      const res = await request(server)
        .post('/papers')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({
          name: `Reviewer${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(res.status).toBe(201);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-02: Questions tenant isolation + object-level authorization
  // ──────────────────────────────────────────────────────────────────────
  describe('F-02: Questions tenant isolation', () => {
    let questionInStoreA: string;

    beforeAll(async () => {
      // store_admin A creates a question — derived store_id should be A.
      const res = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          type: 'objective',
          body: `OwnedByA-${U}`,
          options: [
            { body: 'a', isCorrect: true },
            { body: 'b', isCorrect: false },
          ],
        });
      expect(res.status).toBe(201);
      // store_id was derived from the JWT, never the body/query.
      expect(res.body.store_id).toBe(storeA.id);
      questionInStoreA = res.body.id;
    });

    it('store_admin cannot create a question for another store via query param', async () => {
      // Even with ?storeId=storeB on the URL, store_admin A's JWT
      // forces store_id=A. The created row must belong to A, not B.
      const res = await request(server)
        .post(`/questions?storeId=${storeB.id}`)
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          type: 'subjective',
          body: `AttemptedCrossStore-${U}`,
        });
      expect(res.status).toBe(201);
      expect(res.body.store_id).toBe(storeA.id);
      expect(res.body.store_id).not.toBe(storeB.id);
    });

    it('store_admin B cannot read store A’s question → 404', async () => {
      const res = await request(server)
        .get(`/questions/${questionInStoreA}`)
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      expect(res.status).toBe(404);
    });

    it('store_admin B cannot update store A’s question → 404', async () => {
      const res = await request(server)
        .patch(`/questions/${questionInStoreA}`)
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({ body: 'pwned' });
      expect(res.status).toBe(404);
    });

    it('store_admin B cannot delete store A’s question → 404', async () => {
      const res = await request(server)
        .delete(`/questions/${questionInStoreA}`)
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      expect(res.status).toBe(404);
    });

    it('store_admin B cannot read wrong-answer stats for store A’s question → 404', async () => {
      const res = await request(server)
        .get(`/questions/${questionInStoreA}/wrong-answer-stats`)
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      expect(res.status).toBe(404);
    });

    it('store_admin B listing questions does not see store A’s rows', async () => {
      const res = await request(server)
        .get('/questions')
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((q: any) => q.id);
      expect(ids).not.toContain(questionInStoreA);
    });

    it('store_admin A can update their own question → 200', async () => {
      const res = await request(server)
        .patch(`/questions/${questionInStoreA}`)
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({ body: `Renamed-${U}` });
      expect([200, 201]).toContain(res.status);
    });

    it('platform_admin can still read any store’s question', async () => {
      const res = await request(server)
        .get(`/questions/${questionInStoreA}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect([200, 201]).toContain(res.status);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-P1: Assessments paper tenant isolation
  //
  // A paper created in store A must be invisible (list) and 404 (detail)
  // to a store_admin belonging to store B. Store_admin A must see their
  // own paper; platform_admin sees all.
  //
  // Papers are generated by platform_admin with an explicit ?storeId=
  // query param — only platform_admin is trusted to target an arbitrary
  // store on the write path. This keeps the test focused on the read
  // path, which is the surface this defect lives on.
  // ──────────────────────────────────────────────────────────────────────
  describe('F-P1: Assessments paper tenant isolation', () => {
    let paperInStoreA: string;
    let paperInStoreB: string;

    beforeAll(async () => {
      // Seed one approved objective question per store so random paper
      // generation in each store has something to pick from. Using
      // timestamped bodies so re-runs don't collide.
      const qA = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'objective',
          body: `PapIsoA-${U}`,
          options: [
            { body: 'yes', isCorrect: true },
            { body: 'no', isCorrect: false },
          ],
        });
      await request(server)
        .post(`/questions/${qA.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const qB = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'objective',
          body: `PapIsoB-${U}`,
          options: [
            { body: 'yes', isCorrect: true },
            { body: 'no', isCorrect: false },
          ],
        });
      await request(server)
        .post(`/questions/${qB.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Paper scoped to store A (platform_admin can target any store).
      const pA = await request(server)
        .post(`/papers?storeId=${storeA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `PapIsoPaperA-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(pA.status).toBe(201);
      expect(pA.body.store_id).toBe(storeA.id);
      paperInStoreA = pA.body.id;

      // Paper scoped to store B.
      const pB = await request(server)
        .post(`/papers?storeId=${storeB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `PapIsoPaperB-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(pB.status).toBe(201);
      expect(pB.body.store_id).toBe(storeB.id);
      paperInStoreB = pB.body.id;
    }, 30_000);

    it('store_admin B listing papers does NOT include store A’s paper', async () => {
      const res = await request(server)
        .get('/papers')
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      expect(res.status).toBe(200);

      const ids: string[] = res.body.map((p: any) => p.id);
      expect(ids).not.toContain(paperInStoreA);
      expect(ids).toContain(paperInStoreB);

      // Every row returned must be in store B's scope.
      for (const p of res.body) {
        expect(p.store_id).toBe(storeB.id);
      }
    });

    it('store_admin B cannot bypass scope via ?storeId=<A> query param', async () => {
      // JWT scope must win over caller-controlled query param.
      const res = await request(server)
        .get(`/papers?storeId=${storeA.id}`)
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      expect(res.status).toBe(200);

      const ids: string[] = res.body.map((p: any) => p.id);
      expect(ids).not.toContain(paperInStoreA);
      for (const p of res.body) {
        expect(p.store_id).toBe(storeB.id);
      }
    });

    it('store_admin B GET /papers/:id for store A paper → 404', async () => {
      const res = await request(server)
        .get(`/papers/${paperInStoreA}`)
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      // Out-of-scope must look indistinguishable from "not found"
      // (hiding policy). Never 403, never 200 with the payload.
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('store_id');
    });

    it('store_admin A can GET their own store’s paper → 200', async () => {
      const res = await request(server)
        .get(`/papers/${paperInStoreA}`)
        .set('Authorization', `Bearer ${storeAdminAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(paperInStoreA);
      expect(res.body.store_id).toBe(storeA.id);
    });

    it('store_admin A listing papers only sees store A', async () => {
      const res = await request(server)
        .get('/papers')
        .set('Authorization', `Bearer ${storeAdminAToken}`);
      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((p: any) => p.id);
      expect(ids).toContain(paperInStoreA);
      expect(ids).not.toContain(paperInStoreB);
      for (const p of res.body) {
        expect(p.store_id).toBe(storeA.id);
      }
    });

    it('platform_admin can GET the same paper → 200 (unchanged)', async () => {
      const res = await request(server)
        .get(`/papers/${paperInStoreA}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(paperInStoreA);
      expect(res.body.store_id).toBe(storeA.id);
    });

    it('auditor read-only policy is preserved — GET allowed, POST denied', async () => {
      // Regression guard: the F-01 role policy must survive this fix.
      // auditor is non-store-admin so no scoping is applied; they can
      // still read any paper detail, and they are still denied on any
      // write endpoint.
      const readRes = await request(server)
        .get(`/papers/${paperInStoreA}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(readRes.status).toBe(200);

      const writeRes = await request(server)
        .post(`/papers?storeId=${storeA.id}`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          name: `AuditorShouldBeDenied-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(writeRes.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Quality compute: invalid entityType must return 400, not 500
  // (regression for the fail-causer noted in the remediation pass)
  // ──────────────────────────────────────────────────────────────────────
  describe('Quality compute: invalid entityType', () => {
    it('POST /quality/scores/not-a-valid-entity/compute → 400 with a clear message', async () => {
      const res = await request(server)
        .post('/quality/scores/not-a-valid-entity/compute')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('traceId');
      // Message should explicitly name the allowed set so callers can fix the input.
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message).toMatch(/not-a-valid-entity/);
      expect(res.body.message).toMatch(/products/);
      expect(res.body.message).toMatch(/orders/);
    });

    it('POST /quality/scores/..%2F..%2Fetc/compute → 400 (no path traversal gadget)', async () => {
      const res = await request(server)
        .post('/quality/scores/..%2Fetc%2Fpasswd/compute')
        .set('Authorization', `Bearer ${adminToken}`);
      // Must be a clean reject, never 500, never a file-system touch.
      expect([400, 404]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });

    it('POST /quality/scores/products/compute → 201 (valid entityType still works)', async () => {
      const res = await request(server)
        .post('/quality/scores/products/compute')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      // Shape: { id, entity_type, score, computed_at }
      expect(res.body).toHaveProperty('entity_type', 'products');
      expect(res.body).toHaveProperty('score');
      expect(Number(res.body.score)).toBeGreaterThanOrEqual(0);
      expect(Number(res.body.score)).toBeLessThanOrEqual(100);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-03: Logout / token lifecycle
  // ──────────────────────────────────────────────────────────────────────
  describe('F-03: Logout invalidates JWT', () => {
    it('a JWT is unusable after the logout endpoint runs', async () => {
      // Fresh login → token works → logout → same token now 401.
      const username = `remlogout_${U}_${Math.random().toString(36).slice(2, 8)}`;
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username,
          password: 'Admin1234!',
          role: 'store_admin',
          storeId: storeA.id,
        });
      const token = await login(server, username, 'Admin1234!');

      // Token is currently good — /auth/me returns 200.
      const meBefore = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meBefore.status).toBe(200);

      // Logout consumes the session row.
      const logoutRes = await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      expect(logoutRes.status).toBe(204);

      // Subsequent request with the same JWT must now 401.
      const meAfter = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meAfter.status).toBe(401);
    });

    it('suspending a user invalidates every active session', async () => {
      const username = `remsuspend_${U}_${Math.random().toString(36).slice(2, 8)}`;
      const created = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username,
          password: 'Admin1234!',
          role: 'store_admin',
          storeId: storeA.id,
        });
      const userId = created.body.id;
      const token = await login(server, username, 'Admin1234!');

      // Token works.
      const ok = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(ok.status).toBe(200);

      // Admin suspends the account.
      await request(server)
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'suspended' });

      // The previously valid token is now rejected with 401.
      const blocked = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(blocked.status).toBe(401);
    });
  });
});
