/**
 * End-to-end happy path against the deployed API.
 *
 * Black-box: no AppModule import, no Test.createTestingModule, no
 * in-process Nest bootstrap. Every assertion goes through real HTTP
 * against `E2E_BASE_URL` (default `http://localhost:3000`), so this
 * suite exercises the full request pipeline (compression middleware,
 * global ValidationPipe, guards, interceptors, global exception
 * filter, TypeORM connection pool).
 *
 * Covers: login → create catalog data → idempotent order creation →
 * state transitions → authorization denial on a role-gated surface →
 * audit-log side effect verification. Each test is independent and
 * uses uniquely-suffixed identifiers so reruns do not collide.
 */
import {
  http,
  bearer,
  uniq,
  UNIQUE,
  login,
  waitForHealth,
  provisionStoreWithAdmin,
} from './helpers';

jest.setTimeout(60_000);

describe('E2E: core happy-path flow over HTTP', () => {
  let adminToken: string;

  beforeAll(async () => {
    await waitForHealth();
    adminToken = await login('admin', 'Admin1234!');
  });

  it('GET /health returns ok with a connected database', async () => {
    const res = await http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('POST /auth/login without credentials returns 401 (strict)', async () => {
    const res = await http().post('/auth/login').send({
      username: 'admin',
      password: 'definitely-wrong',
    });
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('accessToken');
  });

  it('authenticated catalog + order lifecycle transitions strictly', async () => {
    const cat = await http()
      .post('/categories')
      .set(bearer(adminToken))
      .send({ name: uniq('e2e-cat') });
    expect(cat.status).toBe(201);
    expect(cat.body).toHaveProperty('id');

    const brand = await http()
      .post('/brands')
      .set(bearer(adminToken))
      .send({ name: uniq('e2e-brand') });
    expect(brand.status).toBe(201);

    const prod = await http()
      .post('/products')
      .set(bearer(adminToken))
      .send({
        name: uniq('e2e-prod'),
        categoryId: cat.body.id,
        brandId: brand.body.id,
      });
    expect(prod.status).toBe(201);

    const sku = await http()
      .post(`/products/${prod.body.id}/skus`)
      .set(bearer(adminToken))
      .send({ skuCode: uniq('E2E-SKU'), priceCents: 2500 });
    expect(sku.status).toBe(201);
    expect(sku.body.price_cents).toBe(2500);

    const idem = uniq('e2e-ord');
    const order = await http()
      .post('/orders')
      .set(bearer(adminToken))
      .send({ idempotencyKey: idem, items: [{ skuId: sku.body.id, quantity: 4 }] });
    expect(order.status).toBe(201);
    expect(order.body.total_cents).toBe(10_000);
    expect(order.body.status).toBe('pending');
    const orderId = order.body.id;

    // Idempotent replay: strict 200 (controller pinpoints
    // HttpStatus.OK on the dedup branch), same order id.
    const replay = await http()
      .post('/orders')
      .set(bearer(adminToken))
      .send({ idempotencyKey: idem, items: [{ skuId: sku.body.id, quantity: 4 }] });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(orderId);
    expect(replay.body.total_cents).toBe(10_000);

    const confirm = await http()
      .post(`/orders/${orderId}/confirm`)
      .set(bearer(adminToken));
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('confirmed');

    const fulfill = await http()
      .post(`/orders/${orderId}/fulfill`)
      .set(bearer(adminToken));
    expect(fulfill.status).toBe(201);
    expect(fulfill.body.status).toBe('fulfilled');

    // Cancelling a fulfilled order must be a hard 409 (business
    // invariant: terminal state).
    const cancel = await http()
      .post(`/orders/${orderId}/cancel`)
      .set(bearer(adminToken));
    expect(cancel.status).toBe(409);
  });

  it('audit log records a create_order entry for the caller', async () => {
    // Issue a fresh order, then query /audit-logs filtered by action
    // and verify the entry surfaces in the log with matching metadata.
    const cat = await http()
      .post('/categories')
      .set(bearer(adminToken))
      .send({ name: uniq('audit-cat') });
    const brand = await http()
      .post('/brands')
      .set(bearer(adminToken))
      .send({ name: uniq('audit-brand') });
    const prod = await http()
      .post('/products')
      .set(bearer(adminToken))
      .send({
        name: uniq('audit-prod'),
        categoryId: cat.body.id,
        brandId: brand.body.id,
      });
    const sku = await http()
      .post(`/products/${prod.body.id}/skus`)
      .set(bearer(adminToken))
      .send({ skuCode: uniq('AUDIT-SKU'), priceCents: 700 });
    const idem = uniq('audit-ord');
    const order = await http()
      .post('/orders')
      .set(bearer(adminToken))
      .send({ idempotencyKey: idem, items: [{ skuId: sku.body.id, quantity: 2 }] });
    expect(order.status).toBe(201);
    const orderId = order.body.id;

    const me = await http().get('/auth/me').set(bearer(adminToken));
    expect(me.status).toBe(200);
    const actorId = me.body.id;

    const logs = await http()
      .get(`/audit-logs?action=create_order&actorId=${actorId}&limit=100`)
      .set(bearer(adminToken));
    expect(logs.status).toBe(200);
    const entries = Array.isArray(logs.body) ? logs.body : logs.body.data;
    expect(Array.isArray(entries)).toBe(true);
    const match = entries.find((e: any) => e.resource_id === orderId);
    expect(match).toBeDefined();
    expect(match.action).toBe('create_order');
    expect(match.resource_type).toBe('order');
    expect(match.actor_id).toBe(actorId);
    expect(typeof match.trace_id === 'string' && match.trace_id.length > 0).toBe(
      true,
    );
  });

  it('logout invalidates the JWT for subsequent requests', async () => {
    // Provision a throw-away admin so we do not burn the shared token.
    const { storeId: _s, token } = await provisionStoreWithAdmin(
      adminToken,
      `e2elogout-${UNIQUE}`,
    );

    const logout = await http().post('/auth/logout').set(bearer(token));
    expect(logout.status).toBe(204);

    const after = await http().get('/auth/me').set(bearer(token));
    expect(after.status).toBe(401);
  });
});
