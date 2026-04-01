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
});
