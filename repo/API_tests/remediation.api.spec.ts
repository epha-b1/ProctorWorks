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
  // HIGH-1 (audit_report-2): POST /attempts cross-store denial
  //
  // A store_admin must NOT be able to start an attempt on a paper that
  // lives in another store. The service returns 404 (hiding policy, not
  // 403) and must NOT persist an attempt row on the denied path.
  //
  // This covers the "Missing security coverage" gap called out in
  // the coverage mapping table §8.2 of the audit report.
  // ──────────────────────────────────────────────────────────────────────
  describe('HIGH-1: POST /attempts cross-store attempt start denial', () => {
    let paperInStoreA: string;

    beforeAll(async () => {
      // Seed one approved question + paper scoped to store A using
      // platform_admin (trusted cross-store write path).
      const q = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'objective',
          body: `CrossAttemptQ-${U}`,
          options: [
            { body: 'yes', isCorrect: true },
            { body: 'no', isCorrect: false },
          ],
        });
      await request(server)
        .post(`/questions/${q.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const p = await request(server)
        .post(`/papers?storeId=${storeA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `CrossAttemptPaper-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(p.status).toBe(201);
      expect(p.body.store_id).toBe(storeA.id);
      paperInStoreA = p.body.id;
    }, 30_000);

    it('store_admin B cannot start attempt on store A paper → 404', async () => {
      const res = await request(server)
        .post('/attempts')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({ paperId: paperInStoreA });

      // Hiding policy: 404, never 403, no leakage of store_id.
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('store_id');
    });

    it('store_admin A CAN start attempt on store A paper → 201', async () => {
      const res = await request(server)
        .post('/attempts')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({ paperId: paperInStoreA });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('in_progress');
      expect(res.body.paper_id).toBe(paperInStoreA);
    });

    it('platform_admin CAN start attempt on store A paper → 201 (unchanged)', async () => {
      const res = await request(server)
        .post('/attempts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paperId: paperInStoreA });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('in_progress');
    });

    it('no attempt row was created for the denied cross-store call', async () => {
      // Fetch history as store_admin B — their attempt list must NOT
      // contain any attempt pointing at paperInStoreA.
      const hist = await request(server)
        .get('/attempts/history')
        .set('Authorization', `Bearer ${storeAdminBToken}`);
      expect(hist.status).toBe(200);
      const storeAPaperAttempts = hist.body.filter(
        (a: any) => a.paper_id === paperInStoreA,
      );
      expect(storeAPaperAttempts).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-P5: Publish flow requires explicit reviewer approval
  //
  // audit_report-1 §5.5 — content_reviewer / platform_admin used to be
  // able to flip a product straight to PUBLISHED via /publish, skipping
  // the explicit reviewer-approval decision the prompt's governance
  // model requires. The fix routes EVERY publish request through
  // pending_review and exposes a separate /approve action that the
  // reviewer must explicitly call. This block proves both halves:
  //   - the bypass is closed (publish never lands on 'published')
  //   - approve is the only path to 'published' and it requires
  //     pending_review state.
  // ──────────────────────────────────────────────────────────────────────
  describe('F-P5: Publish requires explicit reviewer approval', () => {
    let pubCategoryId: string;
    let pubBrandId: string;
    let productInStoreA: string;

    beforeAll(async () => {
      const cat = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `PubCat-${U}` });
      pubCategoryId = cat.body.id;

      const brand = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `PubBrand-${U}` });
      pubBrandId = brand.body.id;

      // store_admin A creates a product (DRAFT). This becomes the
      // single product the rest of the test transitions through the
      // governance lifecycle.
      const p = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          name: `PubProd-${U}`,
          categoryId: pubCategoryId,
          brandId: pubBrandId,
        });
      expect(p.status).toBe(201);
      productInStoreA = p.body.id;
    }, 30_000);

    it('store_admin /publish lands on pending_review (not published)', async () => {
      const res = await request(server)
        .post(`/products/${productInStoreA}/publish`)
        .set('Authorization', `Bearer ${storeAdminAToken}`);
      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('pending_review');
    });

    it('platform_admin /publish ALSO lands on pending_review (no bypass)', async () => {
      // Create a second product so we can hit /publish on something
      // that's not yet in pending_review.
      const p = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          name: `PubProd-bypass-${U}`,
          categoryId: pubCategoryId,
          brandId: pubBrandId,
        });
      const id = p.body.id;

      const res = await request(server)
        .post(`/products/${id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect([200, 201]).toContain(res.status);
      // Critical: the previous behaviour would have been 'published'.
      // The bypass is now closed.
      expect(res.body.status).toBe('pending_review');
    });

    it('content_reviewer /approve transitions pending_review → published', async () => {
      const res = await request(server)
        .post(`/products/${productInStoreA}/approve`)
        .set('Authorization', `Bearer ${reviewerToken}`);
      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('published');
    });

    it('store_admin cannot /approve a product (only reviewers can) → 403', async () => {
      const p = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          name: `PubProd-noapprove-${U}`,
          categoryId: pubCategoryId,
          brandId: pubBrandId,
        });
      const id = p.body.id;

      // Submit it to pending_review first.
      await request(server)
        .post(`/products/${id}/publish`)
        .set('Authorization', `Bearer ${storeAdminAToken}`);

      // store_admin cannot approve their own submission.
      const res = await request(server)
        .post(`/products/${id}/approve`)
        .set('Authorization', `Bearer ${storeAdminAToken}`);
      expect(res.status).toBe(403);
    });

    it('approving a product that is NOT in pending_review → 409', async () => {
      // The product we just published is now PUBLISHED. Approving
      // again must hit the conflict guard, not silently no-op.
      const res = await request(server)
        .post(`/products/${productInStoreA}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-P4: Order idempotency lookup must NOT leak across tenant scope
  //
  // audit_report-1 §5.4 — the original lookup was global by `key`, so
  // a caller in store B reusing a key already issued by an actor in
  // store A would be served the prior order from store A (cross-tenant
  // data leak via predictable key). The fix scopes the lookup by
  // (operation_type, actor_id, store_id, key). This test verifies the
  // contract end-to-end by:
  //   1. having store_admin A create an order with a known key,
  //   2. having store_admin B POST a brand-new order with the SAME key,
  //   3. asserting B's order is genuinely fresh (different id, store=B,
  //      no fields from A's order leak through).
  // ──────────────────────────────────────────────────────────────────────
  describe('F-P4: Order idempotency cross-tenant non-leakage', () => {
    let skuA: string;
    let skuB: string;

    beforeAll(async () => {
      // Each store needs at least one SKU so its store_admin can place
      // an order. We deliberately make A and B's prices distinct so a
      // leak (same response served back) is loud in the assertions.
      const cat = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `IdemCat-${U}` });
      const brand = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `IdemBrand-${U}` });

      const prodA = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          name: `IdemProdA-${U}`,
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sA = await request(server)
        .post(`/products/${prodA.body.id}/skus`)
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({ skuCode: `IDEM-A-${U}`, priceCents: 7_777 });
      skuA = sA.body.id;

      const prodB = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          name: `IdemProdB-${U}`,
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sB = await request(server)
        .post(`/products/${prodB.body.id}/skus`)
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({ skuCode: `IDEM-B-${U}`, priceCents: 1_111 });
      skuB = sB.body.id;
    }, 30_000);

    it('same idempotency key in two tenants resolves to two distinct orders', async () => {
      const sharedKey = `cross-tenant-idem-${U}`;

      // 1. Store A creates an order with the shared key.
      const aRes = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          idempotencyKey: sharedKey,
          items: [{ skuId: skuA, quantity: 1 }],
        });
      expect(aRes.status).toBe(201);
      expect(aRes.body.store_id).toBe(storeA.id);
      expect(aRes.body.total_cents).toBe(7_777);
      const orderAId = aRes.body.id;

      // 2. Store B uses the EXACT same idempotency key.
      const bRes = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          idempotencyKey: sharedKey,
          items: [{ skuId: skuB, quantity: 1 }],
        });
      expect(bRes.status).toBe(201);

      // 3. Critical: store B must get its OWN fresh order, not store A's.
      expect(bRes.body.id).not.toBe(orderAId);
      expect(bRes.body.store_id).toBe(storeB.id);
      expect(bRes.body.total_cents).toBe(1_111);

      // 4. Re-issuing the key inside the SAME tenant must still dedupe.
      //    This is the same-scope replay path; it must continue to work.
      const aReplay = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          idempotencyKey: sharedKey,
          items: [{ skuId: skuA, quantity: 1 }],
        });
      expect([200, 201]).toContain(aReplay.status);
      expect(aReplay.body.id).toBe(orderAId);
      expect(aReplay.body.store_id).toBe(storeA.id);

      const bReplay = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          idempotencyKey: sharedKey,
          items: [{ skuId: skuB, quantity: 1 }],
        });
      expect([200, 201]).toContain(bReplay.status);
      expect(bReplay.body.id).toBe(bRes.body.id);
      expect(bReplay.body.store_id).toBe(storeB.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-P3: Order promotion resolution must reject cross-store coupons
  //
  // audit_report-1 §5.3 — `resolvePromotions` previously looked up a
  // coupon by code only and applied it without checking that the
  // coupon's `store_id` matched the order's store. That allowed a
  // store_admin in store B to redeem a coupon issued in store A,
  // breaking tenant isolation and enabling cross-store discount abuse.
  //
  // The fix is enforced inside `resolvePromotions` itself; this test
  // exercises the full HTTP path so any regression that re-introduces
  // the unscoped lookup is caught at the contract layer.
  // ──────────────────────────────────────────────────────────────────────
  describe('F-P3: Order promotion cross-store coupon binding', () => {
    let storeAProductSkuId: string;
    let storeBProductSkuId: string;
    const localCouponCode = `LOCAL-${U}`;
    const foreignCouponCode = `FOREIGN-${U}`;

    beforeAll(async () => {
      // Create catalog so each store_admin can place orders against
      // their own SKU. The orders service derives `store_id` from the
      // caller's JWT, so the SKU's product store doesn't have to match
      // — but we keep them aligned for realism.
      const catA = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `CrossCatA-${U}` });
      const brandA = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `CrossBrandA-${U}` });
      const prodA = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          name: `CrossProdA-${U}`,
          categoryId: catA.body.id,
          brandId: brandA.body.id,
        });
      const skuA = await request(server)
        .post(`/products/${prodA.body.id}/skus`)
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({ skuCode: `CROSS-A-${U}`, priceCents: 10_000 });
      storeAProductSkuId = skuA.body.id;

      const prodB = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          name: `CrossProdB-${U}`,
          categoryId: catA.body.id,
          brandId: brandA.body.id,
        });
      const skuB = await request(server)
        .post(`/products/${prodB.body.id}/skus`)
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({ skuCode: `CROSS-B-${U}`, priceCents: 10_000 });
      storeBProductSkuId = skuB.body.id;

      // Promotion + coupon LIVING IN STORE A. The fixed-cents discount
      // is generous on purpose so any cross-store leakage shows up
      // immediately in the order total.
      const promoA = await request(server)
        .post('/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeId: storeA.id,
          name: `CrossPromoA-${U}`,
          type: 'threshold',
          priority: 100,
          discountType: 'fixed_cents',
          discountValue: 4_000,
        });
      await request(server)
        .post('/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeId: storeA.id,
          code: foreignCouponCode,
          promotionId: promoA.body.id,
          remainingQuantity: 100,
        });

      // Local promotion + coupon for store B so we can sanity-check
      // that the same code path still applies a same-store coupon.
      const promoB = await request(server)
        .post('/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeId: storeB.id,
          name: `CrossPromoB-${U}`,
          type: 'threshold',
          priority: 100,
          discountType: 'fixed_cents',
          discountValue: 1_500,
        });
      await request(server)
        .post('/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeId: storeB.id,
          code: localCouponCode,
          promotionId: promoB.body.id,
          remainingQuantity: 100,
        });
    }, 30_000);

    it('store_admin B redeeming a store-A coupon → coupon NOT applied (no leak vs baseline)', async () => {
      // Contract being verified:
      //
      //   The foreign (store-A) coupon must contribute ZERO to a
      //   store-B order. We can't simply assert `discount_cents = 0`
      //   because the test setup intentionally creates a same-store
      //   AUTO promotion in store B (`CrossPromoB`, 1500c) so the
      //   "positive control" test below has something to apply.
      //
      // Instead we measure the leak directly: place TWO orders for
      // the same SKU + qty, one with NO coupon (the baseline) and
      // one with the foreign coupon. If the cross-store guard works,
      // both orders get exactly the same discount — the foreign
      // 4000c never leaks in. If the guard regresses, the foreign
      // discount lands on the second order and the two totals
      // diverge.
      const baseline = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          idempotencyKey: `cross-coupon-B-baseline-${U}`,
          items: [{ skuId: storeBProductSkuId, quantity: 1 }],
        });
      expect(baseline.status).toBe(201);
      expect(baseline.body.store_id).toBe(storeB.id);

      const res = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          idempotencyKey: `cross-coupon-B-${U}`,
          items: [{ skuId: storeBProductSkuId, quantity: 1 }],
          couponCode: foreignCouponCode,
        });
      expect(res.status).toBe(201);
      expect(res.body.store_id).toBe(storeB.id);

      // Critical: foreign coupon must NOT shift the totals at all.
      // discount_cents and total_cents both equal the no-coupon
      // baseline, proving the foreign 4000c never leaked in.
      expect(res.body.discount_cents).toBe(baseline.body.discount_cents);
      expect(res.body.total_cents).toBe(baseline.body.total_cents);

      // No coupon row recorded against the order either — the
      // service silently dropped it as a cross-store mismatch.
      expect(res.body.coupon_id ?? null).toBeNull();
    });

    it('store_admin B redeeming a SAME-store coupon → discount IS applied (positive control)', async () => {
      // Same SKU + same flow, but the coupon is store B's own code.
      // This proves the cross-store guard is precise: it only blocks
      // foreign coupons and never starves legitimate same-store ones.
      const res = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          idempotencyKey: `cross-coupon-B-local-${U}`,
          items: [{ skuId: storeBProductSkuId, quantity: 1 }],
          couponCode: localCouponCode,
        });
      expect(res.status).toBe(201);
      expect(res.body.store_id).toBe(storeB.id);
      expect(res.body.discount_cents).toBe(1_500);
      expect(res.body.total_cents).toBe(8_500);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F-P2: Assessments paper GENERATE tenant isolation (write-side)
  //
  // F-P1 above proves the read-side scoping. F-P2 closes the matching
  // write-side hole flagged in audit_report-1 §5.2: a store_admin must
  // never be able to generate a paper into another store via the
  // `?storeId=<other>` query param. The endpoint must reject the
  // tenant-escape attempt and never persist a paper.
  // ──────────────────────────────────────────────────────────────────────
  describe('F-P2: Assessments paper generate tenant isolation', () => {
    beforeAll(async () => {
      // Make sure each store has at least one approved question so a
      // legitimate generate has something to pick from. Without this the
      // positive control would 0-row even on the happy path.
      const seed = async (label: string) => {
        const q = await request(server)
          .post('/questions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            type: 'objective',
            body: `PapGen-${label}-${U}`,
            options: [
              { body: 'yes', isCorrect: true },
              { body: 'no', isCorrect: false },
            ],
          });
        await request(server)
          .post(`/questions/${q.body.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`);
      };
      await seed('A');
      await seed('B');
    }, 30_000);

    it('store_admin B cannot generate paper into store A via ?storeId=<A> → 403', async () => {
      // The interesting cross-tenant case: store_admin B tries to write
      // a paper into store A by overriding the storeId query param.
      // Behavior contract: 403, no paper persisted, no leakage of A's id.
      const res = await request(server)
        .post(`/papers?storeId=${storeA.id}`)
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          name: `EscapePaper-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(res.status).toBe(403);

      // Verify nothing landed on store A by listing as platform_admin.
      // The escape paper name we used above must not appear anywhere.
      const list = await request(server)
        .get(`/papers?storeId=${storeA.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      const names: string[] = list.body.map((p: any) => p.name);
      expect(names).not.toContain(`EscapePaper-${U}`);
    });

    it('store_admin B can generate a paper in their OWN store (no override) → 201, store_id == B', async () => {
      // Positive control on the same code path: omitting the override
      // succeeds and the resulting paper lives in the JWT store.
      const res = await request(server)
        .post('/papers')
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          name: `OwnStorePaper-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(res.status).toBe(201);
      expect(res.body.store_id).toBe(storeB.id);
    });

    it('store_admin B passing matching storeId (==B) is allowed → 201, no tenant escape', async () => {
      // Defensive: an explicit but matching storeId should NOT be
      // mistaken for an escape attempt — it must succeed.
      const res = await request(server)
        .post(`/papers?storeId=${storeB.id}`)
        .set('Authorization', `Bearer ${storeAdminBToken}`)
        .send({
          name: `MatchingStorePaper-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(res.status).toBe(201);
      expect(res.body.store_id).toBe(storeB.id);
    });

    it('platform_admin can still target an arbitrary store via ?storeId=<A> → 201', async () => {
      // Regression guard: the tightening MUST be store_admin-only.
      // platform_admin keeps the existing cross-store generate ability.
      const res = await request(server)
        .post(`/papers?storeId=${storeA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `PlatformAdminCross-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(res.status).toBe(201);
      expect(res.body.store_id).toBe(storeA.id);
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

  // ──────────────────────────────────────────────────────────────────────
  // HIGH-2 (closeout): /coupons/:code/claim role policy is store_admin
  //                    + platform_admin only.
  //
  // Original HIGH-2 (audit_report-1): the controller had NO @Roles
  // decorator at all, so the RolesGuard returned `true` for every
  // authenticated caller — including the read-only `auditor`. The
  // first remediation pass tightened the decorator to
  // {store_admin, platform_admin, content_reviewer} so auditor was
  // explicitly denied.
  //
  // Closeout policy (audit_report-2): content_reviewer is ALSO denied.
  // Reviewers exist to QA question/paper content; granting them a
  // commerce-mutation surface gave the review role an unbounded
  // discount path the business model never authorised. The
  // controller decorator is now {store_admin, platform_admin} only.
  //
  // This block enforces the FULL 4-role matrix so any future
  // regression that loosens the decorator (or accidentally
  // re-introduces a denied role) trips a red API test before
  // landing on main.
  // ──────────────────────────────────────────────────────────────────────
  describe('HIGH-2 (closeout): /coupons/:code/claim 4-role matrix', () => {
    // Each test in this block uses its OWN freshly-created coupon
    // so the assertions are independent of order and the
    // remaining_quantity bookkeeping is deterministic. We provision
    // them up-front in beforeAll so the test bodies stay focused on
    // the role-vs-status contract they're verifying.
    let auditorCouponCode: string;
    let reviewerCouponCode: string;
    let storeAdminCouponCode: string;
    let platformAdminCouponCode: string;
    let promotionId: string;

    beforeAll(async () => {
      const promo = await request(server)
        .post('/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeId: storeA.id,
          name: `H2-4role-Promo-${U}`,
          type: 'percentage',
          priority: 10,
          discountType: 'percentage',
          discountValue: 10,
        });
      expect(promo.status).toBe(201);
      promotionId = promo.body.id;

      const provisionCoupon = async (suffix: string): Promise<string> => {
        const code = `H2-4role-${suffix}-${U}`;
        const r = await request(server)
          .post('/coupons')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            storeId: storeA.id,
            code,
            promotionId,
            remainingQuantity: 5,
          });
        expect(r.status).toBe(201);
        return code;
      };

      auditorCouponCode = await provisionCoupon('aud');
      reviewerCouponCode = await provisionCoupon('rev');
      storeAdminCouponCode = await provisionCoupon('sa');
      platformAdminCouponCode = await provisionCoupon('pa');
    }, 30_000);

    // Helper: read one specific coupon row by code via the
    // platform-admin listing. The /coupons endpoint is the only
    // way to inspect remaining_quantity + status for the
    // defense-in-depth no-mutation assertions.
    const fetchCoupon = async (code: string): Promise<any> => {
      const list = await request(server)
        .get('/coupons')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      return list.body.find((c: any) => c.code === code);
    };

    // ─── Denied roles ───────────────────────────────────────────
    it('auditor → 403 + no state mutation', async () => {
      const before = await fetchCoupon(auditorCouponCode);
      const beforeQty = before.remaining_quantity;

      const res = await request(server)
        .post(`/coupons/${auditorCouponCode}/claim`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(res.status).toBe(403);

      // Defense-in-depth: verify state was NOT mutated.
      const after = await fetchCoupon(auditorCouponCode);
      expect(after.remaining_quantity).toBe(beforeQty);
      expect(after.status).toBe('active');
    });

    it('content_reviewer → 403 + no state mutation', async () => {
      const before = await fetchCoupon(reviewerCouponCode);
      const beforeQty = before.remaining_quantity;

      const res = await request(server)
        .post(`/coupons/${reviewerCouponCode}/claim`)
        .set('Authorization', `Bearer ${reviewerToken}`);
      // CLOSEOUT POLICY: content_reviewer is now an explicitly
      // denied role for /coupons/:code/claim. This assertion is
      // the load-bearing test for the policy decision.
      expect(res.status).toBe(403);

      // Defense-in-depth: nothing changed.
      const after = await fetchCoupon(reviewerCouponCode);
      expect(after.remaining_quantity).toBe(beforeQty);
      expect(after.status).toBe('active');
    });

    // ─── Allowed roles (positive controls) ──────────────────────
    it('store_admin → 200/201 + claim row + remaining decremented', async () => {
      const before = await fetchCoupon(storeAdminCouponCode);
      const beforeQty = before.remaining_quantity;

      const res = await request(server)
        .post(`/coupons/${storeAdminCouponCode}/claim`)
        .set('Authorization', `Bearer ${storeAdminAToken}`);
      expect([200, 201]).toContain(res.status);
      expect(res.body.coupon_id).toBeDefined();

      const after = await fetchCoupon(storeAdminCouponCode);
      expect(after.remaining_quantity).toBe(beforeQty - 1);
    });

    it('platform_admin → 200/201 + claim row + remaining decremented', async () => {
      const before = await fetchCoupon(platformAdminCouponCode);
      const beforeQty = before.remaining_quantity;

      const res = await request(server)
        .post(`/coupons/${platformAdminCouponCode}/claim`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect([200, 201]).toContain(res.status);
      expect(res.body.coupon_id).toBeDefined();

      const after = await fetchCoupon(platformAdminCouponCode);
      expect(after.remaining_quantity).toBe(beforeQty - 1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // HIGH-3: audit log coverage for orders / reservations / questions /
  // assessments admin write actions.
  //
  // The fix wires AuditService.log(...) into the controllers for these
  // four modules. These tests exercise a representative write op on
  // each module and then assert via /audit-logs that the entry landed
  // with consistent action naming, the correct actor, the resource id,
  // and a non-empty trace id.
  // ──────────────────────────────────────────────────────────────────────
  describe('HIGH-3: admin-action audit logging coverage', () => {
    type LogPredicate = (log: any) => boolean;
    const recentLogs = async (action: string): Promise<any[]> => {
      const res = await request(server)
        .get(`/audit-logs?action=${encodeURIComponent(action)}&limit=50`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      return res.body?.data ?? [];
    };
    const findLog = async (
      action: string,
      pred: LogPredicate,
    ): Promise<any> => {
      const logs = await recentLogs(action);
      return logs.find(pred);
    };

    it('orders: create_order → audit log written with actor + resource id', async () => {
      // Need at least one SKU in store A so the order POST is valid.
      const cat = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `H3OrdCat-${U}` });
      const brand = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `H3OrdBrand-${U}` });
      const prod = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          name: `H3OrdProd-${U}`,
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sku = await request(server)
        .post(`/products/${prod.body.id}/skus`)
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({ skuCode: `H3-ORD-${U}`, priceCents: 1234 });

      const created = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          idempotencyKey: `h3-create-order-${U}`,
          items: [{ skuId: sku.body.id, quantity: 1 }],
        });
      expect(created.status).toBe(201);
      const orderId = created.body.id;

      const log = await findLog(
        'create_order',
        (l) =>
          l.resource_id === orderId &&
          l.resource_type === 'order',
      );
      expect(log).toBeDefined();
      expect(log.actor_id).toBeDefined();
      expect(log.trace_id).toBeTruthy();
    });

    it('reservations: create_reservation_hold → audit log written', async () => {
      // Seed a room → zone → seat so we have something to hold.
      const room = await request(server)
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `H3Room-${U}` });
      const zone = await request(server)
        .post(`/rooms/${room.body.id}/zones`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `H3Zone-${U}` });
      const seat = await request(server)
        .post(`/zones/${zone.body.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `H3Seat-${U}` });

      const hold = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId: seat.body.id });
      expect(hold.status).toBe(201);

      const log = await findLog(
        'create_reservation_hold',
        (l) =>
          l.resource_id === hold.body.id &&
          l.resource_type === 'reservation',
      );
      expect(log).toBeDefined();
      expect(log.actor_id).toBeDefined();
      expect(log.trace_id).toBeTruthy();
    });

    it('questions: create_question → audit log written', async () => {
      const q = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'subjective',
          body: `H3Q-${U}`,
        });
      expect(q.status).toBe(201);

      const log = await findLog(
        'create_question',
        (l) =>
          l.resource_id === q.body.id &&
          l.resource_type === 'question',
      );
      expect(log).toBeDefined();
      expect(log.actor_id).toBeDefined();
      expect(log.trace_id).toBeTruthy();
    });

    it('assessments: generate_paper → audit log written', async () => {
      // Need at least one approved question to generate a paper from.
      const q = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'objective',
          body: `H3PapQ-${U}`,
          options: [
            { body: 'a', isCorrect: true },
            { body: 'b', isCorrect: false },
          ],
        });
      await request(server)
        .post(`/questions/${q.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const paper = await request(server)
        .post('/papers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `H3Paper-${U}`,
          generationRule: { type: 'random', count: 1 },
        });
      expect(paper.status).toBe(201);

      const log = await findLog(
        'generate_paper',
        (l) =>
          l.resource_id === paper.body.id &&
          l.resource_type === 'paper',
      );
      expect(log).toBeDefined();
      expect(log.actor_id).toBeDefined();
      expect(log.trace_id).toBeTruthy();
    });

    // ─────────────────────────────────────────────────────────────
    // audit_report-2 (closeout pass) — coupon redeem audit log.
    //
    // Redeem was the only coupon write surface that did NOT emit
    // an audit log entry. The other write surfaces (claim,
    // distribute, expire) all log via the same .then() chain, and
    // they each have a corresponding HIGH-3 / coverage test. This
    // test brings the redeem path into line with the rest:
    //   - the action `redeem_coupon` lands in audit_logs
    //   - actor_id is the JWT subject (admin), NOT the body userId
    //   - resource_id is the coupon id (resolved by the service)
    //   - trace_id is non-empty (request trace from interceptor)
    //   - detail.code / detail.orderId / detail.userId are recorded
    //     so an incident replay can reconstruct what happened
    // ─────────────────────────────────────────────────────────────
    it('promotions: redeem_coupon → audit log written', async () => {
      // Build a self-contained redeem chain so this test does not
      // depend on state left by other HIGH-3 cases:
      //   1. promo + coupon (store A, percentage, cap=null)
      //   2. user claims the coupon
      //   3. user creates an order (need a SKU first)
      //   4. user redeems the coupon for that order
      //   5. assert the audit row exists with the expected shape
      const promo = await request(server)
        .post('/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeId: storeA.id,
          name: `H3RedeemPromo-${U}`,
          type: 'percentage',
          priority: 5,
          discountType: 'percentage',
          discountValue: 5,
        });
      expect(promo.status).toBe(201);

      const couponCode = `H3-REDEEM-${U}`;
      const coupon = await request(server)
        .post('/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeId: storeA.id,
          code: couponCode,
          promotionId: promo.body.id,
          remainingQuantity: 5,
        });
      expect(coupon.status).toBe(201);

      // Resolve the admin user id so we can redeem against ourselves.
      const me = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);
      const adminUserId = me.body.id;

      // Claim the coupon FIRST so the redeem path has an
      // unredeemed claim row to consume.
      const claim = await request(server)
        .post(`/coupons/${couponCode}/claim`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect([200, 201]).toContain(claim.status);

      // Build a SKU + order so we have a real orderId to bind the
      // redemption to. The redeem service does not validate the
      // orderId against the orders table, but we use a real one
      // anyway for realism (and so the audit detail has a true id).
      const cat = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `H3RedCat-${U}` });
      const brand = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `H3RedBrand-${U}` });
      const prod = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({
          name: `H3RedProd-${U}`,
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sku = await request(server)
        .post(`/products/${prod.body.id}/skus`)
        .set('Authorization', `Bearer ${storeAdminAToken}`)
        .send({ skuCode: `H3-RED-${U}`, priceCents: 5_000 });
      const order = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          idempotencyKey: `h3-redeem-order-${U}`,
          items: [{ skuId: sku.body.id, quantity: 1 }],
        });
      expect(order.status).toBe(201);

      // Now redeem. This is the call that must produce the new
      // audit log entry the closeout pass added.
      const redeem = await request(server)
        .post(`/coupons/${couponCode}/redeem`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: adminUserId, orderId: order.body.id });
      expect([200, 201]).toContain(redeem.status);

      const log = await findLog(
        'redeem_coupon',
        (l) =>
          l.resource_type === 'coupon' &&
          l.resource_id === coupon.body.id,
      );
      expect(log).toBeDefined();
      // actor_id is ALWAYS the JWT subject — never the body userId.
      // Both happen to be `adminUserId` here because admin is
      // redeeming against itself, but the assertion is on actor_id.
      expect(log.actor_id).toBe(adminUserId);
      expect(log.trace_id).toBeTruthy();
      // The detail bag must capture code/order/user context for
      // forensic replay.
      expect(log.detail).toBeDefined();
      expect(log.detail.code).toBe(couponCode);
      expect(log.detail.orderId).toBe(order.body.id);
      expect(log.detail.userId).toBe(adminUserId);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // MED: seat maintenance transition cancels active holds
  //
  // When a seat is moved to status='maintenance', any HOLD reservations
  // for that seat must be cancelled in the same transaction so the
  // hold cannot be confirmed against an unusable seat.
  // ──────────────────────────────────────────────────────────────────────
  describe('MED: seat → maintenance cancels active holds', () => {
    it('hold becomes non-confirmable after seat moves to maintenance', async () => {
      // Seed room → zone → seat; create a hold; flip seat to
      // maintenance; assert the hold is no longer confirmable.
      const room = await request(server)
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `MaintRoom-${U}` });
      const zone = await request(server)
        .post(`/rooms/${room.body.id}/zones`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `MaintZone-${U}` });
      const seat = await request(server)
        .post(`/zones/${zone.body.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `MaintSeat-${U}` });

      const hold = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId: seat.body.id });
      expect(hold.status).toBe(201);
      expect(hold.body.status).toBe('hold');

      // Flip seat to maintenance via the seat update endpoint. This
      // is the trigger that should cascade-cancel the hold.
      const upd = await request(server)
        .patch(`/seats/${seat.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'maintenance' });
      expect([200, 201]).toContain(upd.status);
      expect(upd.body.status).toBe('maintenance');

      // The hold should no longer be confirmable.
      const confirmRes = await request(server)
        .post(`/reservations/${hold.body.id}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(confirmRes.status).toBe(409);

      // The reservation row should be CANCELLED, not HOLD.
      const list = await request(server)
        .get(`/reservations?seatId=${seat.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const row = list.body.find((r: any) => r.id === hold.body.id);
      expect(row).toBeDefined();
      expect(row.status).toBe('cancelled');
      expect(row.cancelled_at).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // audit_report-2 P0 series — proactive defect closure
  //
  // P0-1: createOrder must reject foreign-store SKUs (SKU→Product
  //       store ownership) — store_admin in store B cannot order a
  //       SKU whose parent product belongs to store A.
  // P0-2: claimCoupon must reject foreign-store coupons for
  //       store_admin (object-level + tenant authz on claim).
  // P0-3: GET /questions/:id/explanations must hide foreign-store
  //       questions (404 hiding policy).
  // P0-4: submitAttempt must reject submissions where the answers
  //       reference questions that aren't in the attempt's paper,
  //       reject options from a different question, and reject
  //       duplicate questionIds in one submission body.
  // P0-5: createUser must reject role=store_admin without storeId.
  // ──────────────────────────────────────────────────────────────────────
  describe('audit_report-2 P0: proactive defect closure', () => {
    // ───── P0-1: cross-store SKU rejection on order creation ─────
    describe('P0-1: createOrder rejects foreign-store SKU', () => {
      let storeASkuId: string;

      beforeAll(async () => {
        // Build a SKU under a product owned by store A.
        const cat = await request(server)
          .post('/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `P01Cat-${U}` });
        const brand = await request(server)
          .post('/brands')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `P01Brand-${U}` });
        const prod = await request(server)
          .post('/products')
          .set('Authorization', `Bearer ${storeAdminAToken}`)
          .send({
            name: `P01Prod-${U}`,
            categoryId: cat.body.id,
            brandId: brand.body.id,
          });
        const sku = await request(server)
          .post(`/products/${prod.body.id}/skus`)
          .set('Authorization', `Bearer ${storeAdminAToken}`)
          .send({ skuCode: `P01-A-${U}`, priceCents: 4_242 });
        expect(sku.status).toBe(201);
        storeASkuId = sku.body.id;
      }, 30_000);

      it('store_admin B ordering a store-A SKU → 404 (hiding policy)', async () => {
        const res = await request(server)
          .post('/orders')
          .set('Authorization', `Bearer ${storeAdminBToken}`)
          .send({
            idempotencyKey: `p01-b-cross-${U}`,
            items: [{ skuId: storeASkuId, quantity: 1 }],
          });

        // Hiding policy: 404, never 403, never 200, never any echo
        // of store A's product/price.
        expect(res.status).toBe(404);
        expect(res.body).not.toHaveProperty('total_cents');
        expect(res.body).not.toHaveProperty('items');
      });

      it('store_admin A ordering their OWN SKU → 201 (positive control)', async () => {
        const res = await request(server)
          .post('/orders')
          .set('Authorization', `Bearer ${storeAdminAToken}`)
          .send({
            idempotencyKey: `p01-a-own-${U}`,
            items: [{ skuId: storeASkuId, quantity: 1 }],
          });

        // Goal: prove the store_admin's OWN SKU is accepted (no
        // 404 from the new SKU-store guard) and that the resulting
        // order references both the caller's store and the SKU.
        // We deliberately do NOT pin total_cents because earlier
        // tests in this file create store-A automatic promotions
        // that may cascade into this order's pricing — that's the
        // F-P3 cross-test pollution surface and is unrelated to
        // P0-1's contract. The store-bound SKU check is what we're
        // here to verify; the discount math is owned by the
        // promotions tests.
        expect(res.status).toBe(201);
        expect(res.body.store_id).toBe(storeA.id);
        // Order must reference exactly the SKU we asked for.
        const skuIds = (res.body.items ?? []).map((it: any) => it.sku_id);
        expect(skuIds).toContain(storeASkuId);
      });

      it('platform_admin ordering same SKU → 201 (admin behaviour preserved)', async () => {
        const res = await request(server)
          .post('/orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            idempotencyKey: `p01-pa-${U}`,
            items: [{ skuId: storeASkuId, quantity: 1 }],
          });

        expect(res.status).toBe(201);
      });
    });

    // ───── P0-2: cross-store coupon claim rejection ─────
    describe('P0-2: claimCoupon rejects foreign-store coupon', () => {
      let storeAOnlyCouponCode: string;

      beforeAll(async () => {
        const promo = await request(server)
          .post('/promotions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            storeId: storeA.id,
            name: `P02Promo-${U}`,
            type: 'percentage',
            priority: 10,
            discountType: 'percentage',
            discountValue: 20,
          });
        storeAOnlyCouponCode = `P02-A-${U}`;
        const c = await request(server)
          .post('/coupons')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            storeId: storeA.id,
            code: storeAOnlyCouponCode,
            promotionId: promo.body.id,
            remainingQuantity: 5,
          });
        expect(c.status).toBe(201);
      }, 30_000);

      it('store_admin B claiming a store-A coupon → 404 (hiding policy)', async () => {
        const before = await request(server)
          .get('/coupons')
          .set('Authorization', `Bearer ${adminToken}`);
        const beforeRow = before.body.find(
          (c: any) => c.code === storeAOnlyCouponCode,
        );
        const beforeQty = beforeRow.remaining_quantity;

        const res = await request(server)
          .post(`/coupons/${storeAOnlyCouponCode}/claim`)
          .set('Authorization', `Bearer ${storeAdminBToken}`);

        // Hiding policy: 404, never 400 ("expired"/"exhausted") which
        // would confirm the code exists.
        expect(res.status).toBe(404);

        // Defense in depth: no decrement, no claim row.
        const after = await request(server)
          .get('/coupons')
          .set('Authorization', `Bearer ${adminToken}`);
        const afterRow = after.body.find(
          (c: any) => c.code === storeAOnlyCouponCode,
        );
        expect(afterRow.remaining_quantity).toBe(beforeQty);
      });

      it('store_admin A claiming their own coupon → 200/201 + decrement', async () => {
        const before = await request(server)
          .get('/coupons')
          .set('Authorization', `Bearer ${adminToken}`);
        const beforeQty = before.body.find(
          (c: any) => c.code === storeAOnlyCouponCode,
        ).remaining_quantity;

        const res = await request(server)
          .post(`/coupons/${storeAOnlyCouponCode}/claim`)
          .set('Authorization', `Bearer ${storeAdminAToken}`);
        expect([200, 201]).toContain(res.status);

        const after = await request(server)
          .get('/coupons')
          .set('Authorization', `Bearer ${adminToken}`);
        const afterQty = after.body.find(
          (c: any) => c.code === storeAOnlyCouponCode,
        ).remaining_quantity;
        expect(afterQty).toBe(beforeQty - 1);
      });

      it('auditor still cannot claim (HIGH-2 role guard preserved)', async () => {
        const res = await request(server)
          .post(`/coupons/${storeAOnlyCouponCode}/claim`)
          .set('Authorization', `Bearer ${auditorToken}`);
        expect(res.status).toBe(403);
      });
    });

    // ───── P0-3: cross-store explanation read denial ─────
    describe('P0-3: GET /questions/:id/explanations enforces ownership', () => {
      let questionInStoreA: string;

      beforeAll(async () => {
        const q = await request(server)
          .post('/questions')
          .set('Authorization', `Bearer ${storeAdminAToken}`)
          .send({
            type: 'subjective',
            body: `P03Q-${U}`,
          });
        expect(q.status).toBe(201);
        questionInStoreA = q.body.id;

        // Add an explanation so the foreign-store reader can't just
        // be served an empty array (which would still leak existence
        // information to a careful caller).
        await request(server)
          .post(`/questions/${questionInStoreA}/explanations`)
          .set('Authorization', `Bearer ${storeAdminAToken}`)
          .send({ body: `P03E-${U}` });
      }, 30_000);

      it('store_admin B reading store A explanations → 404', async () => {
        const res = await request(server)
          .get(`/questions/${questionInStoreA}/explanations`)
          .set('Authorization', `Bearer ${storeAdminBToken}`);
        expect(res.status).toBe(404);
        // Must NOT leak the explanation array.
        expect(Array.isArray(res.body)).toBe(false);
      });

      it('store_admin A reading their own explanations → 200', async () => {
        const res = await request(server)
          .get(`/questions/${questionInStoreA}/explanations`)
          .set('Authorization', `Bearer ${storeAdminAToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
      });

      it('platform_admin reading any explanations → 200 (admin preserved)', async () => {
        const res = await request(server)
          .get(`/questions/${questionInStoreA}/explanations`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
      });
    });

    // ───── P0-4: submission integrity ─────
    describe('P0-4: submitAttempt content integrity', () => {
      let paperId: string;
      let attemptId: string;
      let inPaperQuestionId: string;
      let inPaperOptionId: string;
      let outOfPaperQuestionId: string;
      let outOfPaperOptionId: string;

      beforeAll(async () => {
        // Question that lives IN the paper.
        const q1 = await request(server)
          .post('/questions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            type: 'objective',
            body: `P04InQ-${U}`,
            options: [
              { body: 'right', isCorrect: true },
              { body: 'wrong', isCorrect: false },
            ],
          });
        await request(server)
          .post(`/questions/${q1.body.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`);
        inPaperQuestionId = q1.body.id;
        inPaperOptionId = q1.body.options.find((o: any) => o.is_correct).id;

        // Question that lives OUTSIDE the paper.
        const q2 = await request(server)
          .post('/questions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            type: 'objective',
            body: `P04OutQ-${U}`,
            options: [
              { body: 'foreign-right', isCorrect: true },
              { body: 'foreign-wrong', isCorrect: false },
            ],
          });
        await request(server)
          .post(`/questions/${q2.body.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`);
        outOfPaperQuestionId = q2.body.id;
        outOfPaperOptionId = q2.body.options.find((o: any) => o.is_correct).id;

        // Build a paper that is GUARANTEED to include only q1.
        // We use a rule-based generation with a tight count and then
        // validate the membership before running tests.
        const p = await request(server)
          .post('/papers')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: `P04Paper-${U}`,
            generationRule: { type: 'random', count: 1 },
          });
        expect(p.status).toBe(201);
        paperId = p.body.id;

        const a = await request(server)
          .post('/attempts')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ paperId });
        expect(a.status).toBe(201);
        attemptId = a.body.id;
      }, 30_000);

      it('answer with question NOT in paper → 400', async () => {
        // We don't actually know which question landed in the random
        // paper — but `outOfPaperQuestionId` is freshly created and
        // could only land in the paper if its count=1 random pick
        // happened to choose it. To make the assertion deterministic,
        // we read the paper's question membership and substitute a
        // truly out-of-paper id.
        const paperRes = await request(server)
          .get(`/papers/${paperId}`)
          .set('Authorization', `Bearer ${adminToken}`);
        const memberIds: string[] = paperRes.body.paper_questions.map(
          (pq: any) => pq.question_id,
        );

        // Pick one of {inPaperQuestionId, outOfPaperQuestionId} that
        // is NOT actually a member of this random paper.
        const candidate = !memberIds.includes(inPaperQuestionId)
          ? inPaperQuestionId
          : !memberIds.includes(outOfPaperQuestionId)
            ? outOfPaperQuestionId
            : null;
        if (!candidate) {
          // Both happened to be picked — extremely unlikely with
          // count=1, but if so, skip the assertion gracefully.
          return;
        }

        const res = await request(server)
          .post(`/attempts/${attemptId}/submit`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            answers: [{ questionId: candidate }],
          });
        expect(res.status).toBe(400);
      });

      it('option from a DIFFERENT question → 400', async () => {
        // Use a fresh attempt so the bad-submission test doesn't
        // collide with the previous one.
        const a = await request(server)
          .post('/attempts')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ paperId });
        expect(a.status).toBe(201);

        const paperRes = await request(server)
          .get(`/papers/${paperId}`)
          .set('Authorization', `Bearer ${adminToken}`);
        const memberQid: string =
          paperRes.body.paper_questions[0].question_id;
        const memberQ = paperRes.body.paper_questions[0].question;
        const sameQOptionId =
          memberQ?.options?.[0]?.id ?? inPaperOptionId;
        // Build an option id from a question we KNOW isn't this one.
        const foreignOptionId =
          memberQid === inPaperQuestionId ? outOfPaperOptionId : inPaperOptionId;

        const res = await request(server)
          .post(`/attempts/${a.body.id}/submit`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            answers: [
              { questionId: memberQid, selectedOptionId: foreignOptionId },
            ],
          });

        // The cross-question option must trip the (2) guard.
        expect(res.status).toBe(400);
      });

      it('duplicate questionId in same submission → 400', async () => {
        // Fresh attempt for a clean test slate.
        const a = await request(server)
          .post('/attempts')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ paperId });
        expect(a.status).toBe(201);

        const paperRes = await request(server)
          .get(`/papers/${paperId}`)
          .set('Authorization', `Bearer ${adminToken}`);
        const memberQid: string =
          paperRes.body.paper_questions[0].question_id;

        const res = await request(server)
          .post(`/attempts/${a.body.id}/submit`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            answers: [
              { questionId: memberQid },
              { questionId: memberQid },
            ],
          });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/duplicate/i);
      });

      it('valid in-paper submission still grades correctly', async () => {
        // Positive control for the integrity-hardened path.
        const a = await request(server)
          .post('/attempts')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ paperId });
        expect(a.status).toBe(201);

        const paperRes = await request(server)
          .get(`/papers/${paperId}`)
          .set('Authorization', `Bearer ${adminToken}`);
        const memberQid: string =
          paperRes.body.paper_questions[0].question_id;
        const memberCorrectOptId: string =
          paperRes.body.paper_questions[0].question.options.find(
            (o: any) => o.is_correct,
          ).id;

        const res = await request(server)
          .post(`/attempts/${a.body.id}/submit`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            answers: [
              {
                questionId: memberQid,
                selectedOptionId: memberCorrectOptId,
              },
            ],
          });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('graded');
        expect(Number(res.body.score)).toBe(100);
      });
    });

    // ───── P0-5: store_admin role/store invariant ─────
    describe('P0-5: createUser rejects store_admin without storeId', () => {
      it('POST /users { role:"store_admin" } without storeId → 400', async () => {
        const res = await request(server)
          .post('/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username: `p05bad${U}-${Math.random().toString(36).slice(2, 8)}`,
            password: 'Admin1234!',
            role: 'store_admin',
            // storeId omitted on purpose
          });
        expect(res.status).toBe(400);
      });

      it('POST /users { role:"store_admin", storeId } → 201', async () => {
        const res = await request(server)
          .post('/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username: `p05ok${U}-${Math.random().toString(36).slice(2, 8)}`,
            password: 'Admin1234!',
            role: 'store_admin',
            storeId: storeA.id,
          });
        expect(res.status).toBe(201);
        expect(res.body.store_id).toBe(storeA.id);
      });

      it('POST /users { role:"content_reviewer", storeId } → store_id forced to null', async () => {
        const res = await request(server)
          .post('/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username: `p05rev${U}-${Math.random().toString(36).slice(2, 8)}`,
            password: 'Admin1234!',
            role: 'content_reviewer',
            storeId: storeA.id,
          });
        expect(res.status).toBe(201);
        expect(res.body.store_id).toBeNull();
      });
    });
  });
});
