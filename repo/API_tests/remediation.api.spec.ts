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

    it('store_admin B redeeming a store-A coupon → coupon NOT applied (no discount, no leak)', async () => {
      // Single SKU @ 10_000c, qty 1. With the cross-store coupon
      // suppressed correctly, the order total stays at the subtotal.
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
      // Discount must be ZERO — the foreign 4000c discount must NOT leak in.
      expect(res.body.discount_cents).toBe(0);
      expect(res.body.total_cents).toBe(10_000);
      // No coupon row recorded against the order either.
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
});
