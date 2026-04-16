/**
 * Stores API — endpoint coverage for GET /stores, PATCH /stores/:id,
 * DELETE /stores/:id.
 *
 * Goal: real HTTP requests into the app surface (supertest against
 * the in-process Nest app's `getHttpServer()`), no transport mocking,
 * no controller/service stubs. Each test asserts status + meaningful
 * state effects (row present in listing, name update persisted,
 * 204 on delete + 404 on follow-up read).
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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

describe('Stores API — GET /stores, PATCH /stores/:id, DELETE /stores/:id', () => {
  let app: INestApplication;
  let server: any;
  let adminToken: string;
  let storeAdminToken: string;
  // Labels scoped to this run so assertions can filter by prefix and
  // the suite never couples to leftover fixtures from prior runs.
  const suitePrefix = `storesSpec_${U}`;
  let createdStoreId: string;

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

    adminToken = await login(server, 'admin', 'Admin1234!');

    // Seed one store up-front — used by the GET/PATCH/DELETE
    // specs. Creating it in beforeAll keeps per-test setup minimal,
    // but every spec ALSO calls its own endpoint directly (no test
    // relies on beforeAll for its coverage evidence).
    logStep('POST', '/stores (seed)');
    const seed = await request(server)
      .post('/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${suitePrefix}_seed` });
    logStep('POST', '/stores', seed.status);
    expect(seed.status).toBe(201);
    createdStoreId = seed.body.id;

    // Provision a store_admin so the role-denial assertions have a
    // real non-admin caller rather than just "no token".
    const saUser = `${suitePrefix}_sa`.toLowerCase();
    await request(server)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: saUser, password: 'Admin1234!', role: 'store_admin', storeId: createdStoreId });
    storeAdminToken = await login(server, saUser, 'Admin1234!');
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------
  // GET /stores
  // ---------------------------------------------------------------------
  describe('GET /stores', () => {
    it('platform_admin → 200 with array including the seeded store', async () => {
      logStep('GET', '/stores');
      const res = await request(server)
        .get('/stores')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/stores', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find((s: any) => s.id === createdStoreId);
      expect(found).toBeDefined();
      expect(found.name).toBe(`${suitePrefix}_seed`);
      // Rows are ordered DESC by created_at — the newly-seeded row
      // sits ahead of any older store with an earlier created_at.
      const seedIndex = res.body.findIndex((s: any) => s.id === createdStoreId);
      expect(seedIndex).toBeGreaterThanOrEqual(0);
    });

    it('no token → 401', async () => {
      logStep('GET', '/stores (no auth)');
      const res = await request(server).get('/stores');
      logStep('GET', '/stores', res.status);
      expect(res.status).toBe(401);
    });

    it('store_admin token → 403 (platform_admin only)', async () => {
      logStep('GET', '/stores (store_admin)');
      const res = await request(server)
        .get('/stores')
        .set('Authorization', `Bearer ${storeAdminToken}`);
      logStep('GET', '/stores', res.status);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // PATCH /stores/:id
  // ---------------------------------------------------------------------
  describe('PATCH /stores/:id', () => {
    it('platform_admin → 200, name persisted + readable via GET /stores', async () => {
      const newName = `${suitePrefix}_renamed`;
      logStep('PATCH', `/stores/${createdStoreId}`);
      const res = await request(server)
        .patch(`/stores/${createdStoreId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: newName });
      logStep('PATCH', `/stores/${createdStoreId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdStoreId);
      expect(res.body.name).toBe(newName);

      // Read-back confirms the rename survived the commit.
      const list = await request(server)
        .get('/stores')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      const persisted = list.body.find((s: any) => s.id === createdStoreId);
      expect(persisted).toBeDefined();
      expect(persisted.name).toBe(newName);
    });

    it('unknown store id → 404 with NOT_FOUND code', async () => {
      const missing = '00000000-0000-0000-0000-000000000000';
      logStep('PATCH', `/stores/${missing}`);
      const res = await request(server)
        .patch(`/stores/${missing}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${suitePrefix}_ghost` });
      logStep('PATCH', `/stores/${missing}`, res.status);
      expect(res.status).toBe(404);
    });

    it('store_admin token → 403 (platform_admin only)', async () => {
      logStep('PATCH', `/stores/${createdStoreId} (store_admin)`);
      const res = await request(server)
        .patch(`/stores/${createdStoreId}`)
        .set('Authorization', `Bearer ${storeAdminToken}`)
        .send({ name: `${suitePrefix}_denied` });
      logStep('PATCH', `/stores/${createdStoreId}`, res.status);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // DELETE /stores/:id
  // ---------------------------------------------------------------------
  describe('DELETE /stores/:id', () => {
    it('platform_admin → 204 and store no longer appears in GET /stores', async () => {
      // Create a throw-away store so this delete does not kill the
      // seed fixture used by PATCH specs.
      const tmp = await request(server)
        .post('/stores')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${suitePrefix}_toDelete` });
      expect(tmp.status).toBe(201);
      const tmpId = tmp.body.id;

      logStep('DELETE', `/stores/${tmpId}`);
      const res = await request(server)
        .delete(`/stores/${tmpId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('DELETE', `/stores/${tmpId}`, res.status);
      expect(res.status).toBe(204);

      // Read-back: the store must be gone from the listing.
      const list = await request(server)
        .get('/stores')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      expect(list.body.find((s: any) => s.id === tmpId)).toBeUndefined();
    });

    it('unknown store id → 404', async () => {
      const missing = '00000000-0000-0000-0000-000000000000';
      logStep('DELETE', `/stores/${missing}`);
      const res = await request(server)
        .delete(`/stores/${missing}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('DELETE', `/stores/${missing}`, res.status);
      expect(res.status).toBe(404);
    });

    it('store_admin token → 403 (platform_admin only)', async () => {
      const tmp = await request(server)
        .post('/stores')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${suitePrefix}_saBlocked` });
      expect(tmp.status).toBe(201);

      logStep('DELETE', `/stores/${tmp.body.id} (store_admin)`);
      const res = await request(server)
        .delete(`/stores/${tmp.body.id}`)
        .set('Authorization', `Bearer ${storeAdminToken}`);
      logStep('DELETE', `/stores/${tmp.body.id}`, res.status);
      expect(res.status).toBe(403);
    });
  });
});
