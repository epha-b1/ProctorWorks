/**
 * Black-box lifecycle flows over real HTTP.
 *
 * These tests complement the existing E2E suite by exercising
 * cross-module write surfaces that previously only had in-process
 * API-test coverage. Each test hits the running container via
 * `supertest(E2E_BASE_URL)` so the full middleware/interceptor/
 * filter chain is on the wire exactly as production traffic would
 * be. No `AppModule` import, no in-process bootstrap.
 *
 * The three flows pinned here:
 *
 *   1. Product publish/approve lifecycle — state machine over the
 *      HTTP boundary, including the fail-closed status transitions
 *      on the approve-without-publish path.
 *   2. Inventory stock adjustment with idempotency — 200 replay on
 *      duplicate key, 201 on first create, quantity math verified
 *      via the lot listing.
 *   3. Promotion + coupon end-to-end — create promo, create coupon,
 *      claim, verify remaining_quantity decremented.
 *
 * All three use per-run unique identifiers; no cross-run fixture
 * coupling.
 */
import {
  http,
  bearer,
  uniq,
  login,
  waitForHealth,
} from './helpers';

jest.setTimeout(90_000);

describe('E2E: cross-module lifecycle over HTTP', () => {
  let adminToken: string;

  beforeAll(async () => {
    await waitForHealth();
    adminToken = await login('admin', 'Admin1234!');
  });

  describe('Product publish → approve state machine', () => {
    it('pending_review → published via approve', async () => {
      const cat = await http()
        .post('/categories')
        .set(bearer(adminToken))
        .send({ name: uniq('lifeca') });
      const brand = await http()
        .post('/brands')
        .set(bearer(adminToken))
        .send({ name: uniq('lifebr') });

      const prod = await http()
        .post('/products')
        .set(bearer(adminToken))
        .send({
          name: uniq('lifepr'),
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      expect(prod.status).toBe(201);
      expect(prod.body.status).toBe('draft');

      // Publish lands on pending_review even for platform_admin —
      // no reviewer-bypass fast-path (audit_report §5.5).
      const pub = await http()
        .post(`/products/${prod.body.id}/publish`)
        .set(bearer(adminToken));
      expect(pub.status).toBe(201);
      expect(pub.body.status).toBe('pending_review');

      // Approve transitions to published.
      const appr = await http()
        .post(`/products/${prod.body.id}/approve`)
        .set(bearer(adminToken));
      expect(appr.status).toBe(201);
      expect(appr.body.status).toBe('published');

      // Read-back confirms the persisted status.
      const read = await http()
        .get(`/products/${prod.body.id}`)
        .set(bearer(adminToken));
      expect(read.status).toBe(200);
      expect(read.body.status).toBe('published');
    });

    it('approve on a draft (never published) → 409 state-transition conflict', async () => {
      const cat = await http()
        .post('/categories')
        .set(bearer(adminToken))
        .send({ name: uniq('draftcat') });
      const brand = await http()
        .post('/brands')
        .set(bearer(adminToken))
        .send({ name: uniq('draftbr') });
      const prod = await http()
        .post('/products')
        .set(bearer(adminToken))
        .send({
          name: uniq('draftprod'),
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      expect(prod.status).toBe(201);
      expect(prod.body.status).toBe('draft');

      // approve must only work from pending_review.
      const appr = await http()
        .post(`/products/${prod.body.id}/approve`)
        .set(bearer(adminToken));
      expect(appr.status).toBe(409);
    });

    it('unpublish sends a published product back to unpublished', async () => {
      const cat = await http()
        .post('/categories')
        .set(bearer(adminToken))
        .send({ name: uniq('upubcat') });
      const brand = await http()
        .post('/brands')
        .set(bearer(adminToken))
        .send({ name: uniq('upubbr') });
      const prod = await http()
        .post('/products')
        .set(bearer(adminToken))
        .send({
          name: uniq('upubprod'),
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      await http()
        .post(`/products/${prod.body.id}/publish`)
        .set(bearer(adminToken));
      await http()
        .post(`/products/${prod.body.id}/approve`)
        .set(bearer(adminToken));

      const unpub = await http()
        .post(`/products/${prod.body.id}/unpublish`)
        .set(bearer(adminToken));
      expect(unpub.status).toBe(201);
      expect(unpub.body.status).toBe('unpublished');
    });
  });

  describe('Inventory stock adjustment idempotency', () => {
    async function seedLot() {
      const cat = await http()
        .post('/categories')
        .set(bearer(adminToken))
        .send({ name: uniq('invcat') });
      const brand = await http()
        .post('/brands')
        .set(bearer(adminToken))
        .send({ name: uniq('invbr') });
      const prod = await http()
        .post('/products')
        .set(bearer(adminToken))
        .send({
          name: uniq('invpr'),
          categoryId: cat.body.id,
          brandId: brand.body.id,
        });
      const sku = await http()
        .post(`/products/${prod.body.id}/skus`)
        .set(bearer(adminToken))
        .send({ skuCode: uniq('INV-SKU'), priceCents: 100 });
      const lot = await http()
        .post('/inventory/lots')
        .set(bearer(adminToken))
        .send({
          skuId: sku.body.id,
          batchCode: uniq('BATCH'),
          quantity: 10,
        });
      expect(lot.status).toBe(201);
      return lot.body;
    }

    it('first adjust → 201, same idempotencyKey replay → 200 same adjustment, quantity applied once', async () => {
      const lot = await seedLot();
      const key = uniq('adj-key');

      const first = await http()
        .post('/inventory/adjust')
        .set(bearer(adminToken))
        .send({
          lotId: lot.id,
          delta: 5,
          reasonCode: 'restock',
          idempotencyKey: key,
        });
      // Controller pins CREATED on fresh path, OK on replay.
      expect(first.status).toBe(201);
      const adjustmentId = first.body.id;

      const replay = await http()
        .post('/inventory/adjust')
        .set(bearer(adminToken))
        .send({
          lotId: lot.id,
          delta: 5,
          reasonCode: 'restock',
          idempotencyKey: key,
        });
      expect(replay.status).toBe(200);
      expect(replay.body.id).toBe(adjustmentId);

      // Quantity applied exactly once: starting 10 + delta 5 = 15.
      const lots = await http()
        .get(`/inventory/lots?skuId=${lot.sku_id}`)
        .set(bearer(adminToken));
      expect(lots.status).toBe(200);
      const persisted = lots.body.find((l: any) => l.id === lot.id);
      expect(persisted).toBeDefined();
      expect(Number(persisted.quantity)).toBe(15);
    });

    it('negative delta is applied exactly once per unique idempotencyKey', async () => {
      // The lot quantity ledger is an unsigned-math surface — the
      // service applies the delta verbatim and the stock-check guard
      // lives at the order-side (see orders.service sku → lot lookup
      // and `products.service.findSkusWithStock`). This test pins the
      // ledger contract: one negative delta applied exactly once per
      // unique idempotency key, resulting in the expected quantity
      // subtraction without duplication.
      const lot = await seedLot();
      const idem = uniq('neg-key');
      const first = await http()
        .post('/inventory/adjust')
        .set(bearer(adminToken))
        .send({
          lotId: lot.id,
          delta: -3,
          reasonCode: 'shrink',
          idempotencyKey: idem,
        });
      expect(first.status).toBe(201);

      const replay = await http()
        .post('/inventory/adjust')
        .set(bearer(adminToken))
        .send({
          lotId: lot.id,
          delta: -3,
          reasonCode: 'shrink',
          idempotencyKey: idem,
        });
      expect(replay.status).toBe(200);
      expect(replay.body.id).toBe(first.body.id);

      // Starting 10 − 3 = 7; never -6 (no double application).
      const lots = await http()
        .get(`/inventory/lots?skuId=${lot.sku_id}`)
        .set(bearer(adminToken));
      const persisted = lots.body.find((l: any) => l.id === lot.id);
      expect(Number(persisted.quantity)).toBe(7);
    });
  });

  describe('Promotion + coupon lifecycle', () => {
    it('create promo → create coupon → claim → remaining_quantity decrements', async () => {
      const promo = await http()
        .post('/promotions')
        .set(bearer(adminToken))
        .send({
          name: uniq('lifepromo'),
          type: 'percentage',
          priority: 30,
          discountType: 'percentage',
          discountValue: 15,
        });
      expect(promo.status).toBe(201);

      const code = uniq('LIFECODE').toUpperCase();
      const coupon = await http()
        .post('/coupons')
        .set(bearer(adminToken))
        .send({
          code,
          promotionId: promo.body.id,
          remainingQuantity: 3,
        });
      expect(coupon.status).toBe(201);
      expect(coupon.body.remaining_quantity).toBe(3);

      const claim = await http()
        .post(`/coupons/${code}/claim`)
        .set(bearer(adminToken));
      expect(claim.status).toBe(201);
      expect(claim.body.coupon_id).toBe(coupon.body.id);

      const list = await http()
        .get('/coupons')
        .set(bearer(adminToken));
      const persisted = list.body.find((c: any) => c.id === coupon.body.id);
      expect(persisted.remaining_quantity).toBe(2);
      expect(persisted.status).toBe('active');
    });
  });
});
