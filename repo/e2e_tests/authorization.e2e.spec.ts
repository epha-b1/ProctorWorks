/**
 * Role/authorization denials over the live HTTP boundary.
 *
 * The RolesGuard is guarded by decorator metadata; a regression that
 * forgets `@Roles(...)` or swaps in the wrong role set is exactly the
 * kind of bug unit tests miss. This suite asserts the negative space:
 *
 *   - unauthenticated requests get 401 on protected surfaces
 *   - auditors (read-only role) cannot mutate commerce/content state
 *   - content_reviewers cannot claim/redeem coupons (closeout policy)
 *   - store_admins cannot hit platform_admin-only surfaces
 */
import {
  http,
  bearer,
  uniq,
  login,
  waitForHealth,
  provisionStoreWithAdmin,
} from './helpers';

jest.setTimeout(60_000);

describe('E2E: role & authorization guardrails', () => {
  let platformAdminToken: string;
  let auditorToken: string;
  let reviewerToken: string;
  let storeAdmin: Awaited<ReturnType<typeof provisionStoreWithAdmin>>;

  beforeAll(async () => {
    await waitForHealth();
    platformAdminToken = await login('admin', 'Admin1234!');

    // Seeded auditor/reviewer users from the initial migration.
    auditorToken = await login('auditor', 'Admin1234!');
    reviewerToken = await login('reviewer', 'Admin1234!');

    storeAdmin = await provisionStoreWithAdmin(
      platformAdminToken,
      'authzadmin',
    );
  });

  it('401 on protected surface with no token', async () => {
    const res = await http().get('/users');
    expect(res.status).toBe(401);
  });

  it('401 on protected surface with a malformed bearer', async () => {
    const res = await http()
      .get('/users')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('store_admin cannot list /users (platform_admin only)', async () => {
    const res = await http().get('/users').set(bearer(storeAdmin.token));
    expect(res.status).toBe(403);
  });

  it('store_admin cannot create /stores (platform_admin only)', async () => {
    const res = await http()
      .post('/stores')
      .set(bearer(storeAdmin.token))
      .send({ name: uniq('illegal-store') });
    expect(res.status).toBe(403);
  });

  it('auditor cannot create a product', async () => {
    const cat = await http()
      .post('/categories')
      .set(bearer(platformAdminToken))
      .send({ name: uniq('auditor-neg-cat') });
    const brand = await http()
      .post('/brands')
      .set(bearer(platformAdminToken))
      .send({ name: uniq('auditor-neg-brand') });
    const res = await http()
      .post('/products')
      .set(bearer(auditorToken))
      .send({
        name: uniq('auditor-neg-prod'),
        categoryId: cat.body.id,
        brandId: brand.body.id,
      });
    expect(res.status).toBe(403);
  });

  it('auditor cannot claim a coupon (write surface closeout)', async () => {
    // Seed a real coupon the auditor could *try* to claim.
    const promo = await http()
      .post('/promotions')
      .set(bearer(platformAdminToken))
      .send({
        name: uniq('authz-promo'),
        type: 'percentage',
        priority: 10,
        discountType: 'percentage',
        discountValue: 10,
      });
    expect(promo.status).toBe(201);

    const code = uniq('AUTHZ-CPN').toUpperCase();
    const coupon = await http()
      .post('/coupons')
      .set(bearer(platformAdminToken))
      .send({ code, promotionId: promo.body.id, remainingQuantity: 5 });
    expect(coupon.status).toBe(201);

    const claim = await http()
      .post(`/coupons/${code}/claim`)
      .set(bearer(auditorToken));
    expect(claim.status).toBe(403);

    // content_reviewer is also denied (closeout policy).
    const claim2 = await http()
      .post(`/coupons/${code}/claim`)
      .set(bearer(reviewerToken));
    expect(claim2.status).toBe(403);

    // Remaining quantity is untouched after the denials.
    const list = await http()
      .get('/coupons')
      .set(bearer(platformAdminToken));
    expect(list.status).toBe(200);
    const found = list.body.find((c: any) => c.code === code);
    expect(found).toBeDefined();
    expect(found.remaining_quantity).toBe(5);
  });

  it('auditor CAN read audit logs (role granted explicitly)', async () => {
    const res = await http()
      .get('/audit-logs?limit=1')
      .set(bearer(auditorToken));
    expect(res.status).toBe(200);
  });

  it('store_admin cannot read audit logs', async () => {
    const res = await http()
      .get('/audit-logs?limit=1')
      .set(bearer(storeAdmin.token));
    expect(res.status).toBe(403);
  });
});
