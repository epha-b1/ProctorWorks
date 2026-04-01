/**
 * ProctorWorks Inventory API Integration Tests
 *
 * These tests run against a real NestJS application backed by PostgreSQL.
 * Requires DATABASE_URL (or defaults to local dev DB).
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNIQUE = Date.now();

function logStep(method: string, path: string, status?: number): void {
  if (status !== undefined) {
    console.log(`  \u2190 ${status}`);
  } else {
    console.log(`  \u2192 ${method} ${path}`);
  }
}

async function login(
  server: any,
  username: string,
  password: string,
): Promise<string> {
  logStep('POST', '/auth/login');
  const res = await request(server)
    .post('/auth/login')
    .send({ username, password });
  logStep('POST', '/auth/login', res.status);
  return res.body.accessToken;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Inventory API', () => {
  let app: INestApplication;
  let server: any;
  let adminToken: string;

  // Shared IDs created in beforeAll
  let categoryId: string;
  let brandId: string;
  let productId: string;
  let skuId: string;
  let lotId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer();

    // Login as admin
    adminToken = await login(server, 'admin', 'Admin1234!');
    expect(adminToken).toBeDefined();

    // Create a category
    logStep('POST', '/categories');
    const catRes = await request(server)
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `InvTestCategory-${UNIQUE}` });
    logStep('POST', '/categories', catRes.status);
    expect(catRes.status).toBe(201);
    categoryId = catRes.body.id;

    // Create a brand
    logStep('POST', '/brands');
    const brandRes = await request(server)
      .post('/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `InvTestBrand-${UNIQUE}` });
    logStep('POST', '/brands', brandRes.status);
    expect(brandRes.status).toBe(201);
    brandId = brandRes.body.id;

    // Create a product
    logStep('POST', '/products');
    const prodRes = await request(server)
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `InvTestProduct-${UNIQUE}`,
        categoryId,
        brandId,
      });
    logStep('POST', '/products', prodRes.status);
    expect(prodRes.status).toBe(201);
    productId = prodRes.body.id;

    // Create a SKU
    logStep('POST', `/products/${productId}/skus`);
    const skuRes = await request(server)
      .post(`/products/${productId}/skus`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        skuCode: `INV-SKU-${UNIQUE}`,
        priceCents: 1500,
      });
    logStep('POST', `/products/${productId}/skus`, skuRes.status);
    expect(skuRes.status).toBe(201);
    skuId = skuRes.body.id;
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. POST /inventory/lots -> 201, creates lot
  // -------------------------------------------------------------------------
  describe('POST /inventory/lots', () => {
    it('should create a lot with batchCode, quantity, and expirationDate', async () => {
      logStep('POST', '/inventory/lots');
      const res = await request(server)
        .post('/inventory/lots')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          skuId,
          batchCode: `BATCH-${UNIQUE}`,
          quantity: 50,
          expirationDate: '2027-06-30',
        });
      logStep('POST', '/inventory/lots', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.batch_code).toBe(`BATCH-${UNIQUE}`);
      expect(res.body.quantity).toBe(50);
      expect(res.body.expiration_date).toBe('2027-06-30');
      expect(res.body.sku_id).toBe(skuId);

      lotId = res.body.id;
    });
  });

  // -------------------------------------------------------------------------
  // 2. GET /inventory/lots -> 200, returns lots
  // -------------------------------------------------------------------------
  describe('GET /inventory/lots', () => {
    it('should return a list of lots', async () => {
      logStep('GET', '/inventory/lots');
      const res = await request(server)
        .get('/inventory/lots')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/inventory/lots', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const ourLot = res.body.find((l: any) => l.id === lotId);
      expect(ourLot).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. GET /inventory/lots?skuId=... -> 200, filtered by SKU
  // -------------------------------------------------------------------------
  describe('GET /inventory/lots?skuId=...', () => {
    it('should return only lots belonging to the specified SKU', async () => {
      logStep('GET', `/inventory/lots?skuId=${skuId}`);
      const res = await request(server)
        .get(`/inventory/lots`)
        .query({ skuId })
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/inventory/lots?skuId=${skuId}`, res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      for (const lot of res.body) {
        expect(lot.sku_id).toBe(skuId);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. PATCH /inventory/lots/:id -> 200, update quantity
  // -------------------------------------------------------------------------
  describe('PATCH /inventory/lots/:id', () => {
    it('should update the lot quantity', async () => {
      logStep('PATCH', `/inventory/lots/${lotId}`);
      const res = await request(server)
        .patch(`/inventory/lots/${lotId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 75 });
      logStep('PATCH', `/inventory/lots/${lotId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(lotId);
      expect(res.body.quantity).toBe(75);
    });
  });

  // -------------------------------------------------------------------------
  // 5. POST /inventory/adjust -> 201, adjusts stock (+10)
  // -------------------------------------------------------------------------
  describe('POST /inventory/adjust', () => {
    const adjustKey1 = `adj-plus-${UNIQUE}`;

    it('should adjust stock positively and return 201', async () => {
      logStep('POST', '/inventory/adjust');
      const res = await request(server)
        .post('/inventory/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lotId,
          delta: 10,
          reasonCode: 'restock',
          idempotencyKey: adjustKey1,
        });
      logStep('POST', '/inventory/adjust', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.delta).toBe(10);
      expect(res.body.reason_code).toBe('restock');
      expect(res.body.idempotency_key).toBe(adjustKey1);
    });

    // -----------------------------------------------------------------------
    // 6. POST /inventory/adjust with same idempotencyKey -> 200
    // -----------------------------------------------------------------------
    it('should return 200 with original adjustment when using duplicate idempotencyKey', async () => {
      logStep('POST', '/inventory/adjust (duplicate key)');
      const res = await request(server)
        .post('/inventory/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lotId,
          delta: 10,
          reasonCode: 'restock',
          idempotencyKey: adjustKey1,
        });
      logStep('POST', '/inventory/adjust (duplicate key)', res.status);

      expect(res.status).toBe(200);
      expect(res.body.idempotency_key).toBe(adjustKey1);
      expect(res.body.delta).toBe(10);
    });

    // -----------------------------------------------------------------------
    // 7. POST /inventory/adjust -> 201, negative delta reduces quantity
    // -----------------------------------------------------------------------
    it('should adjust stock negatively and return 201', async () => {
      const negativeKey = `adj-minus-${UNIQUE}`;

      logStep('POST', '/inventory/adjust (negative)');
      const res = await request(server)
        .post('/inventory/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lotId,
          delta: -5,
          reasonCode: 'damaged',
          idempotencyKey: negativeKey,
        });
      logStep('POST', '/inventory/adjust (negative)', res.status);

      expect(res.status).toBe(201);
      expect(res.body.delta).toBe(-5);
      expect(res.body.reason_code).toBe('damaged');
    });

    // -----------------------------------------------------------------------
    // 8. POST /inventory/adjust without reasonCode -> 400
    // -----------------------------------------------------------------------
    it('should return 400 when reasonCode is missing', async () => {
      logStep('POST', '/inventory/adjust (no reasonCode)');
      const res = await request(server)
        .post('/inventory/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lotId,
          delta: 1,
          idempotencyKey: `adj-no-reason-${UNIQUE}`,
        });
      logStep('POST', '/inventory/adjust (no reasonCode)', res.status);

      expect(res.status).toBe(400);
    });

    // -----------------------------------------------------------------------
    // 9. POST /inventory/adjust without idempotencyKey -> 400
    // -----------------------------------------------------------------------
    it('should return 400 when idempotencyKey is missing', async () => {
      logStep('POST', '/inventory/adjust (no idempotencyKey)');
      const res = await request(server)
        .post('/inventory/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lotId,
          delta: 1,
          reasonCode: 'test',
        });
      logStep('POST', '/inventory/adjust (no idempotencyKey)', res.status);

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Verify lot quantity after adjustments is correct
  // -------------------------------------------------------------------------
  describe('Verify lot quantity after adjustments', () => {
    it('should reflect all adjustments in the lot quantity', async () => {
      // After setup: lot created with quantity 50
      // PATCH updated it to 75
      // Adjustment +10 -> 85
      // Idempotent duplicate +10 -> still 85 (no double adjustment)
      // Adjustment -5 -> 80
      const expectedQuantity = 80;

      logStep('GET', `/inventory/lots?skuId=${skuId}`);
      const res = await request(server)
        .get('/inventory/lots')
        .query({ skuId })
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/inventory/lots?skuId=${skuId}`, res.status);

      expect(res.status).toBe(200);
      const lot = res.body.find((l: any) => l.id === lotId);
      expect(lot).toBeDefined();
      expect(lot.quantity).toBe(expectedQuantity);
    });
  });
});
