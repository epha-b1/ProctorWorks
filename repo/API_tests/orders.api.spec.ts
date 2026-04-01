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

  it('POST /orders same idempotency key → 200', async () => {
    logStep('POST', '/orders (dup)');
    const res = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-1`, items: [{ skuId, quantity: 3 }] });
    logStep('POST', '/orders', res.status);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orderId);
  });

  it('GET /orders → 200', async () => {
    logStep('GET', '/orders');
    const res = await request(server).get('/orders').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/orders', res.status);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /orders/:id → 200', async () => {
    logStep('GET', `/orders/${orderId}`);
    const res = await request(server).get(`/orders/${orderId}`).set('Authorization', `Bearer ${token}`);
    logStep('GET', `/orders/${orderId}`, res.status);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orderId);
  });

  it('POST /orders/:id/confirm → 200', async () => {
    logStep('POST', `/orders/${orderId}/confirm`);
    const res = await request(server).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'confirm', res.status);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  it('POST /orders/:id/fulfill → 200', async () => {
    logStep('POST', `/orders/${orderId}/fulfill`);
    const res = await request(server).post(`/orders/${orderId}/fulfill`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'fulfill', res.status);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fulfilled');
  });

  it('POST /orders/:id/cancel on fulfilled → 409', async () => {
    logStep('POST', `/orders/${orderId}/cancel`);
    const res = await request(server).post(`/orders/${orderId}/cancel`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'cancel', res.status);
    expect(res.status).toBe(409);
  });

  it('Cancel from pending → 200', async () => {
    const cr = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-2`, items: [{ skuId, quantity: 1 }] });
    logStep('POST', `/orders/${cr.body.id}/cancel`);
    const res = await request(server).post(`/orders/${cr.body.id}/cancel`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'cancel', res.status);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('Cancel from confirmed → 200', async () => {
    const cr = await request(server).post('/orders').set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `ord-${U}-3`, items: [{ skuId, quantity: 1 }] });
    await request(server).post(`/orders/${cr.body.id}/confirm`).set('Authorization', `Bearer ${token}`);
    logStep('POST', `/orders/${cr.body.id}/cancel`);
    const res = await request(server).post(`/orders/${cr.body.id}/cancel`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'cancel', res.status);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
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
});
