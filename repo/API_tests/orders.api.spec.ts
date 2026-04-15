process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';

const U = Date.now();

function logStep(m: string, p: string, s?: number) {
  console.log(s !== undefined ? `  ← ${s}` : `  → ${m} ${p}`);
}

async function login(srv: any, u: string, p: string) {
  const r = await request(srv).post('/auth/login').send({ username: u, password: p });
  return r.body.accessToken;
}

describe('Orders API', () => {
  let app: INestApplication;
  let server: any;
  let token: string;
  let skuId: string;
  let orderId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    server = app.getHttpServer();
    token = await login(server, 'admin', 'Admin1234!');

    // Create category, brand, product, SKU
    const cat = await request(server).post('/categories').set('Authorization', `Bearer ${token}`).send({ name: `OrdCat${U}` });
    const brand = await request(server).post('/brands').set('Authorization', `Bearer ${token}`).send({ name: `OrdBrand${U}` });
    const prod = await request(server).post('/products').set('Authorization', `Bearer ${token}`).send({ name: `OrdProd${U}`, categoryId: cat.body.id, brandId: brand.body.id });
    const sku = await request(server).post(`/products/${prod.body.id}/skus`).set('Authorization', `Bearer ${token}`).send({ skuCode: `ORD-SKU-${U}`, priceCents: 1000 });
    skuId = sku.body.id;
  }, 30000);

  afterAll(async () => { await app.close(); });

  it('POST /orders → 201 with correct total', async () => {
    logStep('POST', '/orders');
    const res = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-1`, items: [{ skuId, quantity: 3 }] });
    logStep('POST', '/orders', res.status);
    expect(res.status).toBe(201);
    expect(res.body.total_cents).toBe(3000);
    expect(res.body.status).toBe('pending');
    orderId = res.body.id;
  });

  it('POST /orders same idempotency key → 200 dedup with identical body', async () => {
    logStep('POST', '/orders (dup)');
    const res = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-1`, items: [{ skuId, quantity: 3 }] });
    logStep('POST', '/orders', res.status);
    // Controller pins HttpStatus.OK on the dedup branch and
    // HttpStatus.CREATED on the create branch — strict 200 here.
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orderId);
    expect(res.body.total_cents).toBe(3000);
    expect(res.body.status).toBe('pending');
  });

  it('GET /orders → 200 returning the created order', async () => {
    logStep('GET', '/orders');
    const res = await request(server).get('/orders').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/orders', res.status);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((o: any) => o.id === orderId);
    expect(found).toBeDefined();
    expect(found.total_cents).toBe(3000);
  });

  it('GET /orders/:id → 200 with totals and status', async () => {
    logStep('GET', `/orders/${orderId}`);
    const res = await request(server).get(`/orders/${orderId}`).set('Authorization', `Bearer ${token}`);
    logStep('GET', `/orders/${orderId}`, res.status);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orderId);
    expect(res.body.total_cents).toBe(3000);
    expect(res.body.status).toBe('pending');
  });

  it('POST /orders/:id/confirm → 201 transitions to confirmed', async () => {
    logStep('POST', `/orders/${orderId}/confirm`);
    const res = await request(server).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'confirm', res.status);
    // @Post with no @HttpCode → NestJS default 201.
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.id).toBe(orderId);
  });

  it('POST /orders/:id/fulfill → 201 transitions to fulfilled', async () => {
    logStep('POST', `/orders/${orderId}/fulfill`);
    const res = await request(server).post(`/orders/${orderId}/fulfill`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'fulfill', res.status);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('fulfilled');
    expect(res.body.id).toBe(orderId);
  });

  it('POST /orders/:id/cancel on fulfilled → 409', async () => {
    logStep('POST', `/orders/${orderId}/cancel`);
    const res = await request(server).post(`/orders/${orderId}/cancel`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'cancel', res.status);
    expect(res.status).toBe(409);
  });

  it('Cancel from pending → 201, status=cancelled, timestamp set', async () => {
    const cr = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-2`, items: [{ skuId, quantity: 1 }] });
    expect(cr.status).toBe(201);
    logStep('POST', `/orders/${cr.body.id}/cancel`);
    const res = await request(server).post(`/orders/${cr.body.id}/cancel`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'cancel', res.status);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.id).toBe(cr.body.id);
  });

  it('Cancel from confirmed → 201, status=cancelled', async () => {
    const cr = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-3`, items: [{ skuId, quantity: 1 }] });
    expect(cr.status).toBe(201);
    const cf = await request(server).post(`/orders/${cr.body.id}/confirm`).set('Authorization', `Bearer ${token}`);
    expect(cf.status).toBe(201);
    logStep('POST', `/orders/${cr.body.id}/cancel`);
    const res = await request(server).post(`/orders/${cr.body.id}/cancel`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'cancel', res.status);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.id).toBe(cr.body.id);
  });

  it('POST /orders without idempotencyKey → 400', async () => {
    logStep('POST', '/orders (no key)');
    const res = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ items: [{ skuId, quantity: 1 }] });
    logStep('POST', '/orders', res.status);
    expect(res.status).toBe(400);
  });

  it('POST /orders without items → 400', async () => {
    logStep('POST', '/orders (no items)');
    const res = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-4` });
    logStep('POST', '/orders', res.status);
    expect(res.status).toBe(400);
  });

  // ──────────────────────────────────────────────────────────────────
  // HIGH-1 — Order idempotency must be scoped, not globally unique.
  //
  // The InitialSchema migration installed a UNIQUE constraint on
  // `orders.idempotency_key`. That contract is now broken on purpose
  // by `1711900000004-DropOrdersIdempotencyKeyUnique`, so this block
  // proves both halves of the new contract end-to-end:
  //
  //   1. Schema-level: the global UNIQUE constraint is GONE. We
  //      verify by inserting two distinct order rows that share the
  //      same `idempotency_key` directly via the live DataSource —
  //      this would have raised SQLSTATE 23505 on the old schema.
  //
  //   2. Service-level: the same idempotency key reused by two
  //      different (store, actor) tuples produces two distinct
  //      orders. Reusing the key inside the SAME (store, actor)
  //      tuple still dedupes back to the original order.
  //
  // The full multi-tenant HTTP path is also covered by
  // `remediation.api.spec.ts:687`; this block keeps the schema-level
  // assertion close to the orders test surface so the contract is
  // visible alongside the rest of the order-level idempotency tests.
  // ──────────────────────────────────────────────────────────────────
  describe('HIGH-1: order idempotency scoping vs schema uniqueness', () => {
    let dataSource: any;
    let crossA: any;
    let crossB: any;
    let crossSkuA: string;
    let crossSkuB: string;
    let crossAdminAId: string;
    let crossAdminBId: string;
    let crossAdminAToken: string;
    let crossAdminBToken: string;

    beforeAll(async () => {
      const { DataSource } = require('typeorm');
      dataSource = (app as any).get(DataSource);

      // Disposable stores + store_admins so this block can run
      // independently from the cross-tenant block in remediation.api.
      crossA = (
        await request(server)
          .post('/stores')
          .set('Authorization', `Bearer ${token}`)
          .send({ name: `OrdHigh1A-${U}` })
      ).body;
      crossB = (
        await request(server)
          .post('/stores')
          .set('Authorization', `Bearer ${token}`)
          .send({ name: `OrdHigh1B-${U}` })
      ).body;

      const userA = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: `ordhigh1a${U}`,
          password: 'Admin1234!',
          role: 'store_admin',
          storeId: crossA.id,
        });
      crossAdminAId = userA.body.id;
      const userB = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: `ordhigh1b${U}`,
          password: 'Admin1234!',
          role: 'store_admin',
          storeId: crossB.id,
        });
      crossAdminBId = userB.body.id;

      crossAdminAToken = await login(server, `ordhigh1a${U}`, 'Admin1234!');
      crossAdminBToken = await login(server, `ordhigh1b${U}`, 'Admin1234!');

      // Each store needs at least one SKU so its admin can place an
      // order. Distinct prices so any cross-tenant leak shows up
      // immediately in the order total.
      const cat = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `OrdHigh1Cat-${U}` });
      const brand = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `OrdHigh1Brand-${U}` });

      const prodA = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${crossAdminAToken}`)
        .send({
          name: `OrdHigh1ProdA-${U}`,
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sA = await request(server)
        .post(`/products/${prodA.body.id}/skus`)
        .set('Authorization', `Bearer ${crossAdminAToken}`)
        .send({ skuCode: `H1-A-${U}`, priceCents: 5_555 });
      crossSkuA = sA.body.id;

      const prodB = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${crossAdminBToken}`)
        .send({
          name: `OrdHigh1ProdB-${U}`,
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sB = await request(server)
        .post(`/products/${prodB.body.id}/skus`)
        .set('Authorization', `Bearer ${crossAdminBToken}`)
        .send({ skuCode: `H1-B-${U}`, priceCents: 9_999 });
      crossSkuB = sB.body.id;
    }, 60_000);

    it('schema: orders.idempotency_key has NO global UNIQUE / UNIQUE INDEX', async () => {
      // Postgres metadata check: there must be ZERO unique constraints
      // or unique indexes covering only `idempotency_key` on `orders`.
      // The InitialSchema migration would have failed this with
      // `UQ_orders_idempotency_key`; the new
      // 1711900000004-DropOrdersIdempotencyKeyUnique migration drops it.
      const uniqueRows = await dataSource.query(
        `
        SELECT i.relname AS index_name, ix.indisunique AS is_unique
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE t.relname = 'orders'
          AND a.attname = 'idempotency_key'
          AND ix.indisunique = true
          AND array_length(ix.indkey, 1) = 1
        `,
      );
      expect(uniqueRows).toHaveLength(0);
    });

    it('schema: two orders with the SAME idempotency_key are insertable', async () => {
      // Direct DB insert of two `orders` rows that share the same
      // `idempotency_key` but live in different stores. Under the
      // legacy global UNIQUE this would raise SQLSTATE 23505. Under
      // the scoped design this MUST succeed.
      const sharedKey = `schema-shared-${U}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      await dataSource.query(
        `
        INSERT INTO "orders"
          ("store_id", "user_id", "status", "idempotency_key", "total_cents")
        VALUES
          ($1, $2, 'pending', $5, 100),
          ($3, $4, 'pending', $5, 100)
        `,
        [crossA.id, crossAdminAId, crossB.id, crossAdminBId, sharedKey],
      );

      const rows = await dataSource.query(
        `SELECT id, store_id FROM "orders" WHERE "idempotency_key" = $1`,
        [sharedKey],
      );
      expect(rows).toHaveLength(2);
      const storeIds = rows.map((r: any) => r.store_id).sort();
      expect(storeIds).toEqual([crossA.id, crossB.id].sort());

      // Cleanup so other tests are isolated.
      await dataSource.query(
        `DELETE FROM "orders" WHERE "idempotency_key" = $1`,
        [sharedKey],
      );
    });

    it('service: same key in two stores → two distinct orders, same scope still dedupes', async () => {
      const sharedKey = `service-shared-${U}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      // (1) store A creates an order with the key.
      const aRes = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${crossAdminAToken}`)
        .send({
          idempotencyKey: sharedKey,
          items: [{ skuId: crossSkuA, quantity: 1 }],
        });
      expect(aRes.status).toBe(201);
      expect(aRes.body.store_id).toBe(crossA.id);
      expect(aRes.body.total_cents).toBe(5_555);
      const orderAId = aRes.body.id;

      // (2) store B reuses the EXACT same key → must NOT collide on
      //     the legacy UQ_orders_idempotency_key, must NOT serve
      //     store A's order through the scoped lookup.
      const bRes = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${crossAdminBToken}`)
        .send({
          idempotencyKey: sharedKey,
          items: [{ skuId: crossSkuB, quantity: 1 }],
        });
      expect(bRes.status).toBe(201);
      expect(bRes.body.store_id).toBe(crossB.id);
      expect(bRes.body.total_cents).toBe(9_999);
      expect(bRes.body.id).not.toBe(orderAId);

      // (3) same-scope replay still dedupes (regression guard for the
      //     happy path that was already covered by the line-57 test).
      const aReplay = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${crossAdminAToken}`)
        .send({
          idempotencyKey: sharedKey,
          items: [{ skuId: crossSkuA, quantity: 1 }],
        });
      // Same-scope replay → strictly 200 (controller pins
      // HttpStatus.OK on the dedup branch).
      expect(aReplay.status).toBe(200);
      expect(aReplay.body.id).toBe(orderAId);
      expect(aReplay.body.store_id).toBe(crossA.id);
      expect(aReplay.body.total_cents).toBe(5_555);
    });
  });
});
