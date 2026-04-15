/**
 * Shared helpers for the black-box E2E suite.
 *
 * These tests deliberately do NOT bootstrap an in-process NestJS app.
 * They hit the running API at `E2E_BASE_URL` (default
 * `http://localhost:3000`) over real HTTP so the container boundary,
 * middleware chain, validation pipe, and global filters are exercised
 * end-to-end. In the Docker test path the suite runs inside the `api`
 * container, so `localhost:3000` is the container's own listener; from
 * a host, it falls through the published docker port.
 *
 * Nothing in this file is a Jest test — the shared testRegex only
 * matches `*.spec.ts`, so this module is import-only.
 */

const request = require('supertest');

export const BASE_URL =
  process.env.E2E_BASE_URL || 'http://localhost:3000';

/**
 * Returns a supertest agent bound to the live API. Each call creates a
 * fresh agent so cookie/state does not leak across tests.
 */
export function http() {
  return request(BASE_URL);
}

export const UNIQUE = `${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

export function uniq(prefix: string): string {
  return `${prefix}-${UNIQUE}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function login(
  username: string,
  password: string,
): Promise<string> {
  const res = await http()
    .post('/auth/login')
    .send({ username, password });
  if (res.status !== 200 || !res.body.accessToken) {
    throw new Error(
      `E2E login failed for ${username}: status=${res.status} body=${JSON.stringify(
        res.body,
      )}`,
    );
  }
  return res.body.accessToken;
}

/**
 * Wait for the API to answer /health. Useful as a defensive check at the
 * start of every suite so a flaky container start does not produce
 * confusing "ECONNREFUSED" stack traces inside a test case.
 */
export async function waitForHealth(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await http().get('/health');
      if (res.status === 200 && res.body?.status === 'ok') return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `E2E: API at ${BASE_URL} did not become healthy within ${timeoutMs}ms` +
      (lastErr ? ` (last error: ${String(lastErr)})` : ''),
  );
}

/**
 * Standard headers for an authenticated request.
 */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Provision a fresh store + store_admin user scoped to that store.
 * Returns {storeId, userId, username, token}. Requires a platform_admin
 * token to create the store and user.
 */
export async function provisionStoreWithAdmin(
  adminToken: string,
  label: string,
): Promise<{
  storeId: string;
  userId: string;
  username: string;
  password: string;
  token: string;
}> {
  const storeRes = await http()
    .post('/stores')
    .set(bearer(adminToken))
    .send({ name: uniq(`${label}-store`) });
  if (storeRes.status !== 201) {
    throw new Error(
      `provisionStoreWithAdmin: /stores failed status=${storeRes.status} body=${JSON.stringify(
        storeRes.body,
      )}`,
    );
  }
  const storeId = storeRes.body.id;

  const username = uniq(`${label}-admin`).toLowerCase().replace(/[^a-z0-9]/g, '');
  const password = 'Admin1234!';
  const userRes = await http()
    .post('/users')
    .set(bearer(adminToken))
    .send({ username, password, role: 'store_admin', storeId });
  if (userRes.status !== 201) {
    throw new Error(
      `provisionStoreWithAdmin: /users failed status=${userRes.status} body=${JSON.stringify(
        userRes.body,
      )}`,
    );
  }
  const userId = userRes.body.id;
  const token = await login(username, password);
  return { storeId, userId, username, password, token };
}
