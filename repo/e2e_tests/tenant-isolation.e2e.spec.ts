/**
 * Tenant-isolation and cross-store idempotency over the live HTTP API.
 *
 * Two high-risk invariants are nailed down here:
 *
 *   1. A `store_admin` scoped to store A must NEVER see or mutate store
 *      B's promotions/coupons. The RolesGuard + promotions controller
 *      resolveStoreScope() is the only thing standing between a
 *      compromised store credential and a cross-tenant data leak.
 *
 *   2. The same opaque `idempotencyKey` reused by two different
 *      (store, actor) tuples produces two distinct orders. The legacy
 *      schema had a global UNIQUE on `orders.idempotency_key` which
 *      would have failed this with SQLSTATE 23505.
 */
import {
  http,
  bearer,
  uniq,
  login,
  waitForHealth,
  provisionStoreWithAdmin,
} from './helpers';

jest.setTimeout(90_000);

describe('E2E: tenant isolation and cross-store idempotency', () => {
  let platformAdminToken: string;
  let storeA: Awaited<ReturnType<typeof provisionStoreWithAdmin>>;
  let storeB: Awaited<ReturnType<typeof provisionStoreWithAdmin>>;

  beforeAll(async () => {
    await waitForHealth();
    platformAdminToken = await login('admin', 'Admin1234!');
    storeA = await provisionStoreWithAdmin(platformAdminToken, 'tenantA');
    storeB = await provisionStoreWithAdmin(platformAdminToken, 'tenantB');
  });

  it('store_admin A cannot see store B promotions', async () => {
    const promoAName = uniq('promoA');
    const promoBName = uniq('promoB');

    const pa = await http()
      .post('/promotions')
      .set(bearer(storeA.token))
      .send({
        name: promoAName,
        type: 'percentage',
        priority: 10,
        discountType: 'percentage',
        discountValue: 10,
      });
    expect(pa.status).toBe(201);
    expect(pa.body.store_id).toBe(storeA.storeId);

    const pb = await http()
      .post('/promotions')
      .set(bearer(storeB.token))
      .send({
        name: promoBName,
        type: 'percentage',
        priority: 10,
        discountType: 'percentage',
        discountValue: 20,
      });
    expect(pb.status).toBe(201);
    expect(pb.body.store_id).toBe(storeB.storeId);

    const listA = await http().get('/promotions').set(bearer(storeA.token));
    expect(listA.status).toBe(200);
    expect(Array.isArray(listA.body)).toBe(true);
    const names = listA.body.map((p: any) => p.name);
    expect(names).toContain(promoAName);
    expect(names).not.toContain(promoBName);
    for (const p of listA.body) {
      expect(p.store_id).toBe(storeA.storeId);
    }
  });

  it('store_admin A cannot delete store B promotion (404 / 403, never 204)', async () => {
    const pb = await http()
      .post('/promotions')
      .set(bearer(storeB.token))
      .send({
        name: uniq('promoB-delete-target'),
        type: 'percentage',
        priority: 5,
        discountType: 'percentage',
        discountValue: 5,
      });
    expect(pb.status).toBe(201);

    const del = await http()
      .delete(`/promotions/${pb.body.id}`)
      .set(bearer(storeA.token));
    // Must NOT be 204 (successful delete across tenants).
    // Service signals cross-tenant miss as a NotFound to avoid leaking
    // existence; 403 is an acceptable alternative. Nothing else is ok.
    expect([403, 404]).toContain(del.status);
    expect(del.status).not.toBe(204);

    // Promotion is still present for store B.
    const listB = await http().get('/promotions').set(bearer(storeB.token));
    expect(listB.status).toBe(200);
    expect(listB.body.some((p: any) => p.id === pb.body.id)).toBe(true);
  });

  it('same idempotencyKey in two stores → two distinct orders, both scoped', async () => {
    // Fresh tenants so earlier-test promotions on storeA do not
    // quietly apply a discount and make the total_cents assertion
    // fragile. This test owns its own storeA/storeB pair.
    const isoA = await provisionStoreWithAdmin(platformAdminToken, 'isoA');
    const isoB = await provisionStoreWithAdmin(platformAdminToken, 'isoB');

    // Each store needs a SKU so its admin can actually place an order.
    const cat = await http()
      .post('/categories')
      .set(bearer(platformAdminToken))
      .send({ name: uniq('isocat') });
    const brand = await http()
      .post('/brands')
      .set(bearer(platformAdminToken))
      .send({ name: uniq('isobrand') });

    const prodA = await http()
      .post('/products')
      .set(bearer(isoA.token))
      .send({
        name: uniq('isoprodA'),
        categoryId: cat.body.id,
        brandId: brand.body.id,
      });
    const skuA = await http()
      .post(`/products/${prodA.body.id}/skus`)
      .set(bearer(isoA.token))
      .send({ skuCode: uniq('ISO-A'), priceCents: 1_111 });
    expect(skuA.status).toBe(201);

    const prodB = await http()
      .post('/products')
      .set(bearer(isoB.token))
      .send({
        name: uniq('isoprodB'),
        categoryId: cat.body.id,
        brandId: brand.body.id,
      });
    const skuB = await http()
      .post(`/products/${prodB.body.id}/skus`)
      .set(bearer(isoB.token))
      .send({ skuCode: uniq('ISO-B'), priceCents: 2_222 });
    expect(skuB.status).toBe(201);

    const sharedKey = uniq('iso-key');

    const oa = await http()
      .post('/orders')
      .set(bearer(isoA.token))
      .send({ idempotencyKey: sharedKey, items: [{ skuId: skuA.body.id, quantity: 1 }] });
    expect(oa.status).toBe(201);
    expect(oa.body.store_id).toBe(isoA.storeId);
    expect(oa.body.total_cents).toBe(1_111);

    const ob = await http()
      .post('/orders')
      .set(bearer(isoB.token))
      .send({ idempotencyKey: sharedKey, items: [{ skuId: skuB.body.id, quantity: 1 }] });
    expect(ob.status).toBe(201);
    expect(ob.body.store_id).toBe(isoB.storeId);
    expect(ob.body.total_cents).toBe(2_222);
    expect(ob.body.id).not.toBe(oa.body.id);

    // Same-scope replay still dedupes to 200 with the original id.
    const replayA = await http()
      .post('/orders')
      .set(bearer(isoA.token))
      .send({ idempotencyKey: sharedKey, items: [{ skuId: skuA.body.id, quantity: 1 }] });
    expect(replayA.status).toBe(200);
    expect(replayA.body.id).toBe(oa.body.id);
  });
});
