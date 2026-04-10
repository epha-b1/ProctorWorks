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

describe('Promotions & Coupons API', () => {
  let app: INestApplication;
  let server: any;
  let token: string;
  let promoId: string;
  let couponId: string;
  const couponCode = `SAVE-${U}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    server = app.getHttpServer();
    token = await login(server, 'admin', 'Admin1234!');
  }, 30000);

  afterAll(async () => { await app.close(); });

  it('POST /promotions → 201', async () => {
    logStep('POST', '/promotions');
    const res = await request(server).post('/promotions').set('Authorization', `Bearer ${token}`)
      .send({ name: `Promo${U}`, type: 'percentage', priority: 500, discountType: 'percentage', discountValue: 15 });
    logStep('POST', '/promotions', res.status);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(`Promo${U}`);
    expect(res.body.priority).toBe(500);
    promoId = res.body.id;
  });

  it('GET /promotions → 200', async () => {
    logStep('GET', '/promotions');
    const res = await request(server).get('/promotions').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/promotions', res.status);
    expect([200, 201]).toContain(res.status);
    expect(res.body.some((p: any) => p.id === promoId)).toBe(true);
  });

  it('POST /coupons → 201', async () => {
    logStep('POST', '/coupons');
    const res = await request(server).post('/coupons').set('Authorization', `Bearer ${token}`)
      .send({ code: couponCode, promotionId: promoId, remainingQuantity: 3 });
    logStep('POST', '/coupons', res.status);
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(couponCode);
    expect(res.body.remaining_quantity).toBe(3);
    couponId = res.body.id;
  });

  it('GET /coupons → 200', async () => {
    logStep('GET', '/coupons');
    const res = await request(server).get('/coupons').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/coupons', res.status);
    expect([200, 201]).toContain(res.status);
    expect(res.body.some((c: any) => c.id === couponId)).toBe(true);
  });

  it('POST /coupons/:code/claim → 200, decrements quantity', async () => {
    logStep('POST', `/coupons/${couponCode}/claim`);
    const res = await request(server).post(`/coupons/${couponCode}/claim`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'claim', res.status);
    expect([200, 201]).toContain(res.status);
    expect(res.body.coupon_id).toBe(couponId);
    // Check remaining
    const c = await request(server).get('/coupons').set('Authorization', `Bearer ${token}`);
    const coupon = c.body.find((x: any) => x.id === couponId);
    expect(coupon.remaining_quantity).toBe(2);
  });

  it('POST /coupons/:code/claim again → 200', async () => {
    logStep('POST', `/coupons/${couponCode}/claim`);
    const res = await request(server).post(`/coupons/${couponCode}/claim`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'claim', res.status);
    expect([200, 201]).toContain(res.status);
  });

  it('POST /coupons/:id/expire → 200', async () => {
    logStep('POST', `/coupons/${couponId}/expire`);
    const res = await request(server).post(`/coupons/${couponId}/expire`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'expire', res.status);
    expect([200, 201]).toContain(res.status);
  });

  it('POST /coupons/:code/claim on expired → error', async () => {
    logStep('POST', `/coupons/${couponCode}/claim (expired)`);
    const res = await request(server).post(`/coupons/${couponCode}/claim`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'claim expired', res.status);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('Coupon exhaustion: claim until remaining=0', async () => {
    // Create a new coupon with qty 1
    const code2 = `EX-${U}`;
    const c = await request(server).post('/coupons').set('Authorization', `Bearer ${token}`)
      .send({ code: code2, promotionId: promoId, remainingQuantity: 1 });
    expect(c.status).toBe(201);

    logStep('POST', `/coupons/${code2}/claim (last)`);
    const res = await request(server).post(`/coupons/${code2}/claim`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'claim', res.status);
    expect([200, 201]).toContain(res.status);

    // Verify exhausted
    const list = await request(server).get('/coupons').set('Authorization', `Bearer ${token}`);
    const exhausted = list.body.find((x: any) => x.code === code2);
    expect(exhausted.status).toBe('exhausted');
    expect(exhausted.remaining_quantity).toBe(0);
  });

  it('Claim exhausted coupon → error', async () => {
    const code2 = `EX-${U}`;
    logStep('POST', `/coupons/${code2}/claim (exhausted)`);
    const res = await request(server).post(`/coupons/${code2}/claim`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'claim', res.status);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('Create promotion with high priority', async () => {
    logStep('POST', '/promotions (high prio)');
    const res = await request(server).post('/promotions').set('Authorization', `Bearer ${token}`)
      .send({ name: `HiPrio${U}`, type: 'threshold', priority: 900, discountType: 'fixed_cents', discountValue: 500, minOrderCents: 100 });
    logStep('POST', '/promotions', res.status);
    expect(res.status).toBe(201);
    expect(res.body.priority).toBe(900);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Coverage gap C: Distribute / Redeem edge behaviour
  //
  // audit_report-2 §8.2 — the coverage table flags weak API-level tests
  // for distribute-insufficient-quantity and cap-reached-redeem. These
  // tests close that gap with end-to-end assertions.
  // ──────────────────────────────────────────────────────────────────────
  describe('Distribute / Redeem edge cases', () => {
    let edgePromoId: string;
    let edgeCouponId: string;
    const edgeCouponCode = `EDGE-${U}`;

    beforeAll(async () => {
      // Promotion with a redemption_cap = 1 (for cap-reached test).
      const promo = await request(server)
        .post('/promotions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `EdgePromo-${U}`,
          type: 'percentage',
          priority: 50,
          discountType: 'percentage',
          discountValue: 10,
          redemptionCap: 1,
        });
      expect(promo.status).toBe(201);
      edgePromoId = promo.body.id;

      // Coupon with remaining_quantity = 2 (for distribute-insufficient test).
      const coupon = await request(server)
        .post('/coupons')
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: edgeCouponCode,
          promotionId: edgePromoId,
          remainingQuantity: 2,
        });
      expect(coupon.status).toBe(201);
      edgeCouponId = coupon.body.id;
    }, 30_000);

    // Helper: provision N real users via /users so distribute() gets
    // valid UUIDv4 ids that pass the @IsUUID('4', { each: true }) DTO
    // guard. Real users also keep coupon_claims FK semantics happy.
    const provisionUsers = async (count: number): Promise<string[]> => {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const r = await request(server)
          .post('/users')
          .set('Authorization', `Bearer ${token}`)
          .send({
            username: `edgedist${U}-${i}-${Math.random().toString(36).slice(2, 8)}`,
            password: 'Admin1234!',
            role: 'content_reviewer',
          });
        expect(r.status).toBe(201);
        ids.push(r.body.id);
      }
      return ids;
    };

    it('Distribute to more users than remaining quantity → 400', async () => {
      // Coupon has 2 remaining but we try to distribute to 5 users.
      const recipients = await provisionUsers(5);
      const res = await request(server)
        .post(`/coupons/${edgeCouponId}/distribute`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userIds: recipients });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/remaining/i);
    });

    it('Distribute within capacity → 201 and remaining is decremented', async () => {
      // Coupon has 2 remaining — distributing to 2 should succeed.
      const recipients = await provisionUsers(2);
      const res = await request(server)
        .post(`/coupons/${edgeCouponId}/distribute`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userIds: recipients });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);

      // Verify the coupon is now exhausted (remaining should be 0).
      const list = await request(server)
        .get('/coupons')
        .set('Authorization', `Bearer ${token}`);
      const coupon = list.body.find((c: any) => c.id === edgeCouponId);
      expect(coupon.remaining_quantity).toBe(0);
      expect(coupon.status).toBe('exhausted');
    });

    it('Distribute on exhausted coupon → 400', async () => {
      const recipients = await provisionUsers(1);
      const res = await request(server)
        .post(`/coupons/${edgeCouponId}/distribute`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userIds: recipients });

      expect(res.status).toBe(400);
    });

    it('Redeem after cap reached → 400', async () => {
      // First, create a fresh coupon + claim so the redeem path can fire.
      const capCode = `CAP-${U}`;
      const capCoupon = await request(server)
        .post('/coupons')
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: capCode,
          promotionId: edgePromoId,
          remainingQuantity: 10,
        });
      expect(capCoupon.status).toBe(201);

      // Claim it for user who will attempt redeem.
      const claimRes = await request(server)
        .post(`/coupons/${capCode}/claim`)
        .set('Authorization', `Bearer ${token}`);
      expect([200, 201]).toContain(claimRes.status);

      // Redeem #1 — should succeed (cap=1, count starts at 0).
      // Need a valid orderId — create a fake one via the orders API.
      // We need at least one SKU. Let me seed one.
      const cat = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `CapCat-${U}` });
      const brand = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `CapBrand-${U}` });
      const prod = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `CapProd-${U}`,
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sku = await request(server)
        .post(`/products/${prod.body.id}/skus`)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuCode: `CAP-SKU-${U}`, priceCents: 5000 });
      const order = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          idempotencyKey: `cap-order-${U}`,
          items: [{ skuId: sku.body.id, quantity: 1 }],
        });
      expect(order.status).toBe(201);

      // Use the admin user id from the login JWT (from /auth/me).
      const me = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      const adminUserId = me.body.id;

      // First redeem — cap=1, should work.
      const redeem1 = await request(server)
        .post(`/coupons/${capCode}/redeem`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: adminUserId, orderId: order.body.id });
      expect([200, 201]).toContain(redeem1.status);

      // Second: claim again and try to redeem.
      const claimRes2 = await request(server)
        .post(`/coupons/${capCode}/claim`)
        .set('Authorization', `Bearer ${token}`);
      expect([200, 201]).toContain(claimRes2.status);

      const order2 = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          idempotencyKey: `cap-order2-${U}`,
          items: [{ skuId: sku.body.id, quantity: 1 }],
        });
      expect(order2.status).toBe(201);

      // Second redeem — cap is REACHED (count=1 == cap=1). Must fail.
      const redeem2 = await request(server)
        .post(`/coupons/${capCode}/redeem`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: adminUserId, orderId: order2.body.id });
      expect(redeem2.status).toBe(400);
      expect(redeem2.body.message).toMatch(/cap/i);
    });
  });
});
