/**
 * Security & Authorization Tests
 * Covers: object-level authz, tenant isolation, role matrix, audit immutability,
 * masking, notification ownership, sensitive log checks.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
const request = require('supertest');
import { AppModule } from '../src/app.module';

const U = Date.now();

function logStep(m: string, p: string, s?: number) {
  console.log(s !== undefined ? `  ← ${s}` : `  → ${m} ${p}`);
}

async function login(srv: any, u: string, p: string): Promise<string> {
  const r = await request(srv).post('/auth/login').send({ username: u, password: p });
  return r.body.accessToken;
}

describe('Security & Authorization', () => {
  let app: INestApplication;
  let server: any;
  let ds: DataSource;
  let adminToken: string;
  let storeAdminToken: string;
  let auditorToken: string;
  let reviewerToken: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    server = app.getHttpServer();
    ds = mod.get(DataSource);

    adminToken = await login(server, 'admin', 'Admin1234!');

    // Create test users if they don't exist
    const storeRes = await request(server).post('/stores').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `SecStore${U}` });
    const storeId = storeRes.body.id;

    await request(server).post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `sa${U}`, password: 'Admin1234!', role: 'store_admin', storeId });
    await request(server).post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `aud${U}`, password: 'Admin1234!', role: 'auditor' });
    await request(server).post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `rev${U}`, password: 'Admin1234!', role: 'content_reviewer' });

    storeAdminToken = await login(server, `sa${U}`, 'Admin1234!');
    auditorToken = await login(server, `aud${U}`, 'Admin1234!');
    reviewerToken = await login(server, `rev${U}`, 'Admin1234!');
  }, 30000);

  afterAll(async () => { await app.close(); });

  // ── Object-level authorization: Orders ─────────────────────────────────
  describe('Order object-level authz', () => {
    let orderId: string;

    beforeAll(async () => {
      // Admin creates category/brand/product/SKU/order
      const cat = await request(server).post('/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: `SecCat${U}` });
      const brand = await request(server).post('/brands').set('Authorization', `Bearer ${adminToken}`).send({ name: `SecBrand${U}` });
      const prod = await request(server).post('/products').set('Authorization', `Bearer ${adminToken}`).send({ name: `SecProd${U}`, categoryId: cat.body.id, brandId: brand.body.id });
      const sku = await request(server).post(`/products/${prod.body.id}/skus`).set('Authorization', `Bearer ${adminToken}`).send({ skuCode: `SEC-${U}`, priceCents: 500 });
      const ord = await request(server).post('/orders').set('Authorization', `Bearer ${adminToken}`)
        .send({ idempotencyKey: `sec-ord-${U}`, items: [{ skuId: sku.body.id, quantity: 1 }] });
      orderId = ord.body.id;
    });

    it('store_admin cannot read order from another store by ID → 403 or 404', async () => {
      logStep('GET', `/orders/${orderId}`);
      const res = await request(server).get(`/orders/${orderId}`).set('Authorization', `Bearer ${storeAdminToken}`);
      logStep('GET', 'order-by-id', res.status);
      expect([403, 404]).toContain(res.status);
    });

    it('auditor cannot access orders → 403', async () => {
      logStep('GET', '/orders');
      const res = await request(server).get('/orders').set('Authorization', `Bearer ${auditorToken}`);
      logStep('GET', '/orders', res.status);
      expect(res.status).toBe(403);
    });
  });

  // ── Notification ownership ─────────────────────────────────────────────
  describe('Notification ownership', () => {
    it('user cannot mark another user notification as read → 403', async () => {
      // Create notification for admin via DB
      await ds.query(
        `INSERT INTO notifications (user_id, type, message) VALUES ((SELECT id FROM users WHERE username='admin'), 'test', 'admin-only-notif-${U}')`,
      );
      const notifs = await request(server).get('/notifications').set('Authorization', `Bearer ${adminToken}`);
      const notif = notifs.body.find((n: any) => n.message.includes(`admin-only-notif-${U}`));
      expect(notif).toBeDefined();

      logStep('PATCH', `/notifications/${notif.id}/read (wrong user)`);
      const res = await request(server).patch(`/notifications/${notif.id}/read`).set('Authorization', `Bearer ${storeAdminToken}`);
      logStep('PATCH', 'mark-read', res.status);
      expect(res.status).toBe(403);
    });

    it('owner can mark their own notification as read → 200', async () => {
      const notifs = await request(server).get('/notifications').set('Authorization', `Bearer ${adminToken}`);
      const notif = notifs.body.find((n: any) => !n.read);
      if (!notif) return; // skip if no unread
      logStep('PATCH', `/notifications/${notif.id}/read`);
      const res = await request(server).patch(`/notifications/${notif.id}/read`).set('Authorization', `Bearer ${adminToken}`);
      logStep('PATCH', 'mark-read', res.status);
      expect([200, 201]).toContain(res.status);
      expect(res.body.read).toBe(true);
    });
  });

  // ── Promotions store isolation ─────────────────────────────────────────
  describe('Promotions store isolation', () => {
    it('store_admin list shows only their store promotions', async () => {
      const me = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${storeAdminToken}`);
      expect([200, 201]).toContain(me.status);
      const storeId = me.body.storeId;
      expect(storeId).toBeDefined();

      // Store admin creates an owned promotion (controller assigns storeId)
      const owned = await request(server)
        .post('/promotions')
        .set('Authorization', `Bearer ${storeAdminToken}`)
        .send({
          name: `OwnedPromo${U}`,
          type: 'percentage',
          priority: 120,
          discountType: 'percentage',
          discountValue: 7,
        });
      expect(owned.status).toBe(201);

      // Admin creates promotion without store_id
      await request(server).post('/promotions').set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `GlobalPromo${U}`, type: 'percentage', priority: 100, discountType: 'percentage', discountValue: 5 });
      logStep('GET', '/promotions (store_admin)');
      const res = await request(server).get('/promotions').set('Authorization', `Bearer ${storeAdminToken}`);
      logStep('GET', 'promotions', res.status);
      expect([200, 201]).toContain(res.status);

      const ids = res.body.map((p: any) => p.id);
      expect(ids).toContain(owned.body.id);
      expect(res.body.length).toBeGreaterThan(0);
      for (const p of res.body) {
        expect(p.store_id).toBe(storeId);
      }
    });

    it('promotion update persists to DB', async () => {
      const cr = await request(server).post('/promotions').set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Persist${U}`, type: 'threshold', priority: 200, discountType: 'fixed_cents', discountValue: 100 });
      const id = cr.body.id;
      logStep('PATCH', `/promotions/${id}`);
      const upd = await request(server).patch(`/promotions/${id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Updated${U}` });
      logStep('PATCH', 'promo', upd.status);
      expect([200, 201]).toContain(upd.status);
      // Re-read from DB
      const list = await request(server).get('/promotions').set('Authorization', `Bearer ${adminToken}`);
      const found = list.body.find((p: any) => p.id === id);
      expect(found.name).toBe(`Updated${U}`);
    });

    it('promotion delete removes from DB', async () => {
      const cr = await request(server).post('/promotions').set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Del${U}`, type: 'percentage', priority: 50, discountType: 'percentage', discountValue: 1 });
      const id = cr.body.id;
      logStep('DELETE', `/promotions/${id}`);
      const del = await request(server).delete(`/promotions/${id}`).set('Authorization', `Bearer ${adminToken}`);
      logStep('DELETE', 'promo', del.status);
      expect(del.status).toBe(204);
      // Verify gone
      const list = await request(server).get('/promotions').set('Authorization', `Bearer ${adminToken}`);
      expect(list.body.find((p: any) => p.id === id)).toBeUndefined();
    });

    it('store_admin cannot distribute coupon from another store → 403/404', async () => {
      const promo = await request(server)
        .post('/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `CrossStorePromo${U}`,
          type: 'percentage',
          priority: 90,
          discountType: 'percentage',
          discountValue: 5,
        });
      expect(promo.status).toBe(201);

      const coupon = await request(server)
        .post('/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `XSTORE-${U}`,
          promotionId: promo.body.id,
          remainingQuantity: 5,
        });
      expect(coupon.status).toBe(201);

      const me = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${storeAdminToken}`);
      expect(me.status).toBe(200);

      const res = await request(server)
        .post(`/coupons/${coupon.body.id}/distribute`)
        .set('Authorization', `Bearer ${storeAdminToken}`)
        .send({ userIds: [me.body.id] });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Inventory store isolation ──────────────────────────────────────────
  describe('Inventory store isolation', () => {
    it('store_admin cannot update lot from another store scope → 403/404', async () => {
      const cat = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `InvSecCat${U}` });
      expect(cat.status).toBe(201);

      const brand = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `InvSecBrand${U}` });
      expect(brand.status).toBe(201);

      const prod = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `InvSecProd${U}`, categoryId: cat.body.id, brandId: brand.body.id });
      expect(prod.status).toBe(201);

      const sku = await request(server)
        .post(`/products/${prod.body.id}/skus`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ skuCode: `INVSEC-${U}`, priceCents: 700 });
      expect(sku.status).toBe(201);

      const lot = await request(server)
        .post('/inventory/lots')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          skuId: sku.body.id,
          batchCode: `LOT-${U}`,
          quantity: 20,
          expirationDate: '2027-01-01',
        });
      expect(lot.status).toBe(201);

      const res = await request(server)
        .patch(`/inventory/lots/${lot.body.id}`)
        .set('Authorization', `Bearer ${storeAdminToken}`)
        .send({ quantity: 1 });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Role 403 matrix ────────────────────────────────────────────────────
  describe('Role 403 matrix', () => {
    it('auditor cannot create users → 403', async () => {
      const res = await request(server).post('/users').set('Authorization', `Bearer ${auditorToken}`)
        .send({ username: `x${U}`, password: 'Test1234!', role: 'auditor' });
      expect(res.status).toBe(403);
    });

    it('auditor cannot create stores → 403', async () => {
      const res = await request(server).post('/stores').set('Authorization', `Bearer ${auditorToken}`)
        .send({ name: `x${U}` });
      expect(res.status).toBe(403);
    });

    it('content_reviewer cannot create products → 403', async () => {
      const res = await request(server).post('/products').set('Authorization', `Bearer ${reviewerToken}`)
        .send({ name: 'x', categoryId: '00000000-0000-0000-0000-000000000000', brandId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(403);
    });

    it('auditor cannot create orders → 403', async () => {
      const res = await request(server).post('/orders').set('Authorization', `Bearer ${auditorToken}`)
        .send({ idempotencyKey: 'x', items: [] });
      expect(res.status).toBe(403);
    });

    it('auditor cannot create reservations → 403', async () => {
      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ seatId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(403);
    });

    it('auditor cannot create questions → 403', async () => {
      const res = await request(server)
        .post('/questions')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          type: 'objective',
          body: `forbidden-${U}`,
          options: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });
      expect(res.status).toBe(403);
    });

    it('auditor can read audit logs → 200', async () => {
      const res = await request(server).get('/audit-logs').set('Authorization', `Bearer ${auditorToken}`);
      expect([200, 201]).toContain(res.status);
    });

    it('store_admin cannot read audit logs → 403', async () => {
      const res = await request(server).get('/audit-logs').set('Authorization', `Bearer ${storeAdminToken}`);
      expect(res.status).toBe(403);
    });

    it('content_reviewer cannot create quality rules → 403', async () => {
      const res = await request(server).post('/quality/rules').set('Authorization', `Bearer ${reviewerToken}`)
        .send({ entityType: 'products', ruleType: 'completeness', config: {} });
      expect(res.status).toBe(403);
    });

    it('no token → 401 on protected route', async () => {
      const res = await request(server).get('/orders');
      expect(res.status).toBe(401);
    });
  });

  // ── Audit immutability + masking ───────────────────────────────────────
  describe('Audit immutability and masking', () => {
    it('audit log DELETE is blocked by DB trigger', async () => {
      try {
        await ds.query(`DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs LIMIT 1)`);
        fail('DELETE should have been blocked');
      } catch (e: any) {
        expect(e.message).toContain('immutable');
      }
    });

    it('audit log UPDATE is blocked by DB trigger', async () => {
      try {
        await ds.query(`UPDATE audit_logs SET action='hacked' WHERE id = (SELECT id FROM audit_logs LIMIT 1)`);
        fail('UPDATE should have been blocked');
      } catch (e: any) {
        expect(e.message).toContain('immutable');
      }
    });

    // ──────────────────────────────────────────────────────────────────
    // Strengthened append-only guarantees for `audit_logs`.
    //
    // The pre-existing two specs above prove that DB trigger raises on
    // a blind DELETE / UPDATE. That is necessary but not sufficient:
    //
    //   - A silent trigger that raises AFTER the row was modified would
    //     still be visible as "error thrown" from the caller's POV.
    //   - A trigger that only fires on unqualified DELETEs would pass
    //     the blind test but fail a targeted DELETE.
    //
    // The block below locks down the real contract: row content and
    // row count are unchanged by targeted mutation attempts, and the
    // immutability signal is surfaced in the DB error.
    // ──────────────────────────────────────────────────────────────────
    describe('audit_logs append-only trigger (targeted proof)', () => {
      const ACTION_SENTINEL = `audit_immut_${U}`;
      let targetId: string;

      beforeAll(async () => {
        // Insert one known row we can reason about by id. The DB
        // trigger policy allows INSERTs (only UPDATE/DELETE fire the
        // immutability function).
        const [row] = await ds.query(
          `INSERT INTO audit_logs (actor_id, action, detail)
           VALUES (NULL, $1, '{"kind":"baseline"}'::jsonb)
           RETURNING id, action, detail`,
          [ACTION_SENTINEL],
        );
        targetId = row.id;
      });

      it('targeted DELETE WHERE id = <known row> is rejected and the row survives', async () => {
        const before = await ds.query(
          `SELECT COUNT(*)::int AS n FROM audit_logs`,
        );
        const baseline = before[0].n;

        let captured: any = null;
        try {
          await ds.query(
            `DELETE FROM audit_logs WHERE id = $1`,
            [targetId],
          );
        } catch (e) {
          captured = e;
        }
        expect(captured).not.toBeNull();
        // Resilient but meaningful — match the immutability signal the
        // project's trigger function raises, not the full verbatim.
        expect(String(captured.message)).toMatch(/immutable/i);

        const [still] = await ds.query(
          `SELECT id, action FROM audit_logs WHERE id = $1`,
          [targetId],
        );
        expect(still).toBeDefined();
        expect(still.action).toBe(ACTION_SENTINEL);

        const after = await ds.query(
          `SELECT COUNT(*)::int AS n FROM audit_logs`,
        );
        expect(after[0].n).toBe(baseline);
      });

      it('targeted UPDATE SET action, detail WHERE id = <known row> is rejected and the row content is unchanged', async () => {
        let captured: any = null;
        try {
          await ds.query(
            `UPDATE audit_logs
               SET action = 'tampered', detail = '{"kind":"tampered"}'::jsonb
             WHERE id = $1`,
            [targetId],
          );
        } catch (e) {
          captured = e;
        }
        expect(captured).not.toBeNull();
        expect(String(captured.message)).toMatch(/immutable/i);

        const [still] = await ds.query(
          `SELECT action, detail FROM audit_logs WHERE id = $1`,
          [targetId],
        );
        expect(still.action).toBe(ACTION_SENTINEL);
        // jsonb round-trips as an object from node-postgres.
        expect(still.detail).toEqual({ kind: 'baseline' });
      });

      it('unqualified DELETE FROM audit_logs is rejected and the table is NOT emptied', async () => {
        // The prior blind-DELETE test deleted WHERE id IN (SELECT ...
        // LIMIT 1). This one probes the true blast-radius case: an
        // unqualified DELETE must also surface the trigger.
        const before = await ds.query(
          `SELECT COUNT(*)::int AS n FROM audit_logs`,
        );
        const baseline = before[0].n;
        expect(baseline).toBeGreaterThan(0);

        let captured: any = null;
        try {
          await ds.query(`DELETE FROM audit_logs`);
        } catch (e) {
          captured = e;
        }
        expect(captured).not.toBeNull();
        expect(String(captured.message)).toMatch(/immutable/i);

        const after = await ds.query(
          `SELECT COUNT(*)::int AS n FROM audit_logs`,
        );
        expect(after[0].n).toBe(baseline);
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // GET /audit-logs query parameters — exercise the real HTTP path
    // (controller → service → SQL) so the contract for filter +
    // pagination is pinned end-to-end. The unit suite covers the
    // service in isolation; this block adds boundary coverage at the
    // request surface.
    // ──────────────────────────────────────────────────────────────────
    describe('GET /audit-logs query semantics', () => {
      const ACTION = `audit_query_${U}`;
      let actorId: string;

      beforeAll(async () => {
        const me = await request(server)
          .get('/auth/me')
          .set('Authorization', `Bearer ${adminToken}`);
        actorId = me.body.id;
        // Seed a small known set of rows tagged with the sentinel
        // action so filter assertions are not polluted by unrelated
        // background traffic from other tests in this suite.
        for (let i = 0; i < 5; i++) {
          await ds.query(
            `INSERT INTO audit_logs (actor_id, action, detail)
             VALUES ($1, $2, $3::jsonb)`,
            [actorId, ACTION, JSON.stringify({ i })],
          );
        }
      });

      it('action filter returns only matching rows + paginated envelope', async () => {
        const res = await request(server)
          .get(`/audit-logs?action=${ACTION}&limit=10`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('total');
        expect(res.body).toHaveProperty('page', 1);
        expect(res.body).toHaveProperty('limit', 10);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.total).toBeGreaterThanOrEqual(5);
        for (const row of res.body.data) {
          expect(row.action).toBe(ACTION);
        }
      });

      it('limit + page slice the result deterministically (DESC by created_at)', async () => {
        const p1 = await request(server)
          .get(`/audit-logs?action=${ACTION}&limit=2&page=1`)
          .set('Authorization', `Bearer ${adminToken}`);
        const p2 = await request(server)
          .get(`/audit-logs?action=${ACTION}&limit=2&page=2`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(p1.status).toBe(200);
        expect(p2.status).toBe(200);
        expect(p1.body.data.length).toBeLessThanOrEqual(2);
        expect(p2.body.data.length).toBeLessThanOrEqual(2);
        // Pages must not overlap on the same filter scope.
        const p1ids = new Set(p1.body.data.map((r: any) => r.id));
        for (const r of p2.body.data) {
          expect(p1ids.has(r.id)).toBe(false);
        }
      });

      it('actorId + future "to" date returns the seeded rows; far-past "to" returns none', async () => {
        // 1) Future ceiling — should include our seed rows.
        const future = '2099-01-01';
        const inWindow = await request(server)
          .get(`/audit-logs?action=${ACTION}&actorId=${actorId}&to=${future}&limit=100`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(inWindow.status).toBe(200);
        expect(inWindow.body.total).toBeGreaterThanOrEqual(5);

        // 2) Far-past ceiling — must exclude every recently-seeded row.
        const past = '2000-01-01';
        const outOfWindow = await request(server)
          .get(`/audit-logs?action=${ACTION}&actorId=${actorId}&to=${past}&limit=100`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(outOfWindow.status).toBe(200);
        expect(outOfWindow.body.total).toBe(0);
        expect(outOfWindow.body.data).toEqual([]);
      });
    });

    it('audit CSV export masks sensitive fields', async () => {
      // Create a log with sensitive detail
      await ds.query(
        `INSERT INTO audit_logs (actor_id, action, detail) VALUES (NULL, 'test_mask', '{"password_hash":"secret123","username":"normal"}')`,
      );
      logStep('GET', '/audit-logs/export');
      const res = await request(server).get('/audit-logs/export').set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', 'export', res.status);
      expect([200, 201]).toContain(res.status);
      expect(res.text).toContain('[REDACTED]');
      expect(res.text).not.toContain('secret123');
    });
  });

  // ── Field-level encryption ─────────────────────────────────────────────
  describe('Field-level encryption', () => {
    it('user notes are encrypted at rest in DB', async () => {
      // Get admin user ID directly from DB
      const [adminRow] = await ds.query(`SELECT id FROM users WHERE username = 'admin'`);
      const admin = { id: adminRow.id };
      // Update notes
      await request(server).patch(`/users/${admin.id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: `Sensitive SSN ${U}` });
      // Read raw from DB — should be encrypted
      const [row] = await ds.query(`SELECT notes FROM users WHERE id = $1`, [admin.id]);
      expect(row.notes).not.toBe(`Sensitive SSN ${U}`);
      expect(row.notes).toContain(':'); // iv:tag:ciphertext format
      // Read via API — should be decrypted
      const user = await request(server).get(`/users/${admin.id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(user.body.notes).toBe(`Sensitive SSN ${U}`);
    });
  });

  // ── Sensitive logging check ────────────────────────────────────────────
  describe('Sensitive data in responses', () => {
    it('login response does not contain password_hash', async () => {
      const res = await request(server).post('/auth/login').send({ username: 'admin', password: 'Admin1234!' });
      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.body.user).not.toHaveProperty('password_hash');
      expect(JSON.stringify(res.body)).not.toContain('password_hash');
    });

    it('user list does not contain password_hash', async () => {
      const res = await request(server).get('/users').set('Authorization', `Bearer ${adminToken}`);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('password_hash');
    });

    it('error responses contain traceId but no stack trace', async () => {
      const res = await request(server).get('/orders/not-a-uuid');
      expect(res.body).toHaveProperty('traceId');
      expect(JSON.stringify(res.body)).not.toContain('at Object');
      expect(JSON.stringify(res.body)).not.toContain('node_modules');
    });
  });
});
