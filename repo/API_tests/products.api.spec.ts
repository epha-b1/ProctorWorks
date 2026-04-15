/**
 * ProctorWorks Products, Categories, Brands, and SKUs API Integration Tests
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
    console.log(`  ← ${status}`);
  } else {
    console.log(`  → ${method} ${path}`);
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

describe('Products, Categories, Brands & SKUs API', () => {
  let app: INestApplication;
  let server: any;
  let adminToken: string;

  // Shared IDs populated during test execution
  let categoryId: string;
  let brandId: string;
  let productId: string;
  let skuId: string;

  const categoryName = `TestCategory_${UNIQUE}`;
  const brandName = `TestBrand_${UNIQUE}`;
  const productName = `TestProduct_${UNIQUE}`;
  const updatedProductName = `UpdatedProduct_${UNIQUE}`;
  const skuCode = `SKU-${UNIQUE}`;

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

    // Obtain an admin JWT (platform_admin) for use in all tests
    adminToken = await login(server, 'admin', 'Admin1234!');
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // 1. POST /categories → 201
  // -----------------------------------------------------------------------
  describe('POST /categories', () => {
    it('should return 201 and create a category', async () => {
      logStep('POST', '/categories');
      const res = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: categoryName });
      logStep('POST', '/categories', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', categoryName);
      categoryId = res.body.id;
    });
  });

  // -----------------------------------------------------------------------
  // 2. GET /categories → 200, list includes created category
  // -----------------------------------------------------------------------
  describe('GET /categories', () => {
    it('should return 200 with a list that includes the created category', async () => {
      logStep('GET', '/categories');
      const res = await request(server)
        .get('/categories')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/categories', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const found = res.body.find((c: any) => c.id === categoryId);
      expect(found).toBeDefined();
      expect(found.name).toBe(categoryName);
    });
  });

  // -----------------------------------------------------------------------
  // 3. POST /brands → 201
  // -----------------------------------------------------------------------
  describe('POST /brands', () => {
    it('should return 201 and create a brand', async () => {
      logStep('POST', '/brands');
      const res = await request(server)
        .post('/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: brandName });
      logStep('POST', '/brands', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', brandName);
      brandId = res.body.id;
    });
  });

  // -----------------------------------------------------------------------
  // 4. GET /brands → 200
  // -----------------------------------------------------------------------
  describe('GET /brands', () => {
    it('should return 200 with a list that includes the created brand', async () => {
      logStep('GET', '/brands');
      const res = await request(server)
        .get('/brands')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/brands', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const found = res.body.find((b: any) => b.id === brandId);
      expect(found).toBeDefined();
      expect(found.name).toBe(brandName);
    });
  });

  // -----------------------------------------------------------------------
  // 5. POST /products → 201, creates product with category + brand
  // -----------------------------------------------------------------------
  describe('POST /products', () => {
    it('should return 201 and create a product with category and brand', async () => {
      logStep('POST', '/products');
      const res = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: productName,
          categoryId,
          brandId,
        });
      logStep('POST', '/products', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', productName);
      expect(res.body).toHaveProperty('category_id', categoryId);
      expect(res.body).toHaveProperty('brand_id', brandId);
      productId = res.body.id;
    });
  });

  // -----------------------------------------------------------------------
  // 6. GET /products → 200, list with relations
  // -----------------------------------------------------------------------
  describe('GET /products', () => {
    it('should return 200 with a list of products including relations', async () => {
      logStep('GET', '/products');
      const res = await request(server)
        .get('/products')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/products', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const found = res.body.find((p: any) => p.id === productId);
      expect(found).toBeDefined();
      expect(found.name).toBe(productName);
      expect(found).toHaveProperty('category');
      expect(found).toHaveProperty('brand');
      expect(found).toHaveProperty('skus');
    });
  });

  // -----------------------------------------------------------------------
  // 7. GET /products/:id → 200
  // -----------------------------------------------------------------------
  describe('GET /products/:id', () => {
    it('should return 200 with product details and relations', async () => {
      logStep('GET', `/products/${productId}`);
      const res = await request(server)
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/products/${productId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', productId);
      expect(res.body).toHaveProperty('name', productName);
      expect(res.body).toHaveProperty('category');
      expect(res.body.category).toHaveProperty('id', categoryId);
      expect(res.body).toHaveProperty('brand');
      expect(res.body.brand).toHaveProperty('id', brandId);
      expect(res.body).toHaveProperty('skus');
    });
  });

  // -----------------------------------------------------------------------
  // 8. PATCH /products/:id → 200, update name
  // -----------------------------------------------------------------------
  describe('PATCH /products/:id', () => {
    it('should return 200 and update the product name', async () => {
      logStep('PATCH', `/products/${productId}`);
      const res = await request(server)
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: updatedProductName });
      logStep('PATCH', `/products/${productId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', productId);
      expect(res.body).toHaveProperty('name', updatedProductName);
    });
  });

  // -----------------------------------------------------------------------
  // 9. POST /products/:id/skus → 201, create SKU
  // -----------------------------------------------------------------------
  describe('POST /products/:id/skus', () => {
    it('should return 201 and create a SKU for the product', async () => {
      logStep('POST', `/products/${productId}/skus`);
      const res = await request(server)
        .post(`/products/${productId}/skus`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          skuCode,
          priceCents: 1999,
          memberPriceCents: 1499,
          attributes: { color: 'black', size: 'L' },
          priceTiers: [
            { tierName: 'wholesale', priceCents: 1599 },
            { tierName: 'vip', priceCents: 1299 },
          ],
        });
      logStep('POST', `/products/${productId}/skus`, res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('sku_code', skuCode);
      expect(res.body).toHaveProperty('price_cents', 1999);
      expect(res.body).toHaveProperty('member_price_cents', 1499);
      expect(res.body).toHaveProperty('priceTiers');
      expect(Array.isArray(res.body.priceTiers)).toBe(true);
      expect(res.body.priceTiers).toHaveLength(2);
      skuId = res.body.id;
    });
  });

  // -----------------------------------------------------------------------
  // 10. GET /products/:id/skus → 200
  // -----------------------------------------------------------------------
  describe('GET /products/:id/skus', () => {
    it('should return 200 with a list of SKUs for the product', async () => {
      logStep('GET', `/products/${productId}/skus`);
      const res = await request(server)
        .get(`/products/${productId}/skus`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/products/${productId}/skus`, res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const found = res.body.find((s: any) => s.id === skuId);
      expect(found).toBeDefined();
      expect(found.sku_code).toBe(skuCode);
      expect(found).toHaveProperty('priceTiers');
    });
  });

  // -----------------------------------------------------------------------
  // 11. POST /products/:id/publish → 200, status moves to PENDING_REVIEW.
  //     audit_report-1 §5.5 — direct platform_admin → published bypass is
  //     closed. Every publish request now goes through pending_review
  //     and must be explicitly approved by a reviewer.
  // -----------------------------------------------------------------------
  describe('POST /products/:id/publish', () => {
    it('should return 201 and set status to pending_review for platform_admin (no bypass)', async () => {
      logStep('POST', `/products/${productId}/publish`);
      const res = await request(server)
        .post(`/products/${productId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('POST', `/products/${productId}/publish`, res.status);

      // @Post with no @HttpCode → NestJS default 201.
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id', productId);
      // Critical: even platform_admin lands on pending_review here.
      expect(res.body).toHaveProperty('status', 'pending_review');
    });

    it('POST /products/:id/approve → 201, status published (explicit reviewer approval)', async () => {
      logStep('POST', `/products/${productId}/approve`);
      const res = await request(server)
        .post(`/products/${productId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('POST', `/products/${productId}/approve`, res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id', productId);
      expect(res.body).toHaveProperty('status', 'published');
    });
  });

  // -----------------------------------------------------------------------
  // 12. POST /products/:id/unpublish → 200
  // -----------------------------------------------------------------------
  describe('POST /products/:id/unpublish', () => {
    it('should return 201 and set status to unpublished', async () => {
      logStep('POST', `/products/${productId}/unpublish`);
      const res = await request(server)
        .post(`/products/${productId}/unpublish`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('POST', `/products/${productId}/unpublish`, res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id', productId);
      expect(res.body).toHaveProperty('status', 'unpublished');
    });
  });

  // -----------------------------------------------------------------------
  // 13. PATCH /skus/:id → 200, update SKU
  // -----------------------------------------------------------------------
  describe('PATCH /skus/:id', () => {
    it('should return 200 and update the SKU price and attributes', async () => {
      logStep('PATCH', `/skus/${skuId}`);
      const res = await request(server)
        .patch(`/skus/${skuId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          priceCents: 2499,
          attributes: { color: 'white', size: 'XL' },
          priceTiers: [
            { tierName: 'wholesale', priceCents: 1999 },
          ],
        });
      logStep('PATCH', `/skus/${skuId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', skuId);
      expect(res.body).toHaveProperty('price_cents', 2499);
      expect(res.body.attributes).toEqual({ color: 'white', size: 'XL' });
      expect(res.body.priceTiers).toHaveLength(1);
      expect(res.body.priceTiers[0].tier_name).toBe('wholesale');
    });
  });

  // -----------------------------------------------------------------------
  // 14. DELETE /products/:id → 200
  // -----------------------------------------------------------------------
  describe('DELETE /products/:id', () => {
    it('should return 200 and delete the product', async () => {
      logStep('DELETE', `/products/${productId}`);
      const res = await request(server)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('DELETE', `/products/${productId}`, res.status);

      // @Delete with no @HttpCode → NestJS default 200.
      expect(res.status).toBe(200);
    });

    it('should return 404 when fetching the deleted product', async () => {
      logStep('GET', `/products/${productId}`);
      const res = await request(server)
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/products/${productId}`, res.status);

      expect(res.status).toBe(404);
    });
  });
});
