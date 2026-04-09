#!/usr/bin/env node
/**
 * API-test DB preflight.
 *
 * Runs before `npm run test:api`. Verifies the PostgreSQL database at
 * DATABASE_URL (or the default dev URL) is actually reachable and
 * responsive to a real protocol handshake — not just TCP.
 *
 * Rationale: a TCP connection can succeed against a misconfigured
 * docker port-forwarder while the real protocol layer times out (we
 * hit exactly that during the F-03 remediation pass). When that
 * happens, Jest spends minutes retrying and then reports every test
 * as "failed to set up" with a giant stack trace, which obscures the
 * actual problem. A fast protocol-level preflight turns that into a
 * single clear line and exit 1, so operators see what's wrong.
 *
 * Usage:
 *   node scripts/check-test-db.js            # uses DATABASE_URL or default
 *   DATABASE_URL=... node scripts/check-test-db.js
 */

const DEFAULT_URL =
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';
const url = process.env.DATABASE_URL || DEFAULT_URL;
const TIMEOUT_MS = 5000;

function fatal(msg) {
  console.error(''); // spacer so it stands out in jest output
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('API TEST DB PREFLIGHT FAILED');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(msg);
  console.error('');
  console.error('URL tried : ' + url);
  console.error('');
  console.error('Fix options:');
  console.error('  1. docker compose up -d db   (default: 127.0.0.1:5433)');
  console.error('  2. DATABASE_URL=postgres://user:pass@host:port/db \\');
  console.error('       npm run test:api');
  console.error('  3. On hosts where docker port-forwarding is broken,');
  console.error('     start postgres in host-network mode, e.g.:');
  console.error('       docker run --rm -d --name pg-test --network host \\');
  console.error('         -e POSTGRES_USER=proctorworks \\');
  console.error('         -e POSTGRES_PASSWORD=proctorworks \\');
  console.error('         -e POSTGRES_DB=proctorworks \\');
  console.error('         -e PGPORT=25432 postgres:16');
  console.error('     then:');
  console.error('       DATABASE_URL=postgres://proctorworks:proctorworks@127.0.0.1:25432/proctorworks \\');
  console.error('         npm run test:api');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}

let Client;
try {
  ({ Client } = require('pg'));
} catch (_e) {
  fatal(
    'The `pg` module is not installed. Run `npm install` first so jest ' +
      'and its transitive deps are available, then re-run the preflight.',
  );
}

(async () => {
  const client = new Client({ connectionString: url });
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try {
      client.end().catch(() => {});
    } catch (_e) {
      // client may not be connected yet — ignore
    }
    fatal(
      `Timed out after ${TIMEOUT_MS}ms waiting for a Postgres handshake. ` +
        'TCP may be reachable while the protocol layer is not (common ' +
        'symptom of a broken docker port-forwarder or stale docker-proxy ' +
        'on the host).',
    );
  }, TIMEOUT_MS);

  try {
    await client.connect();
    const { rows } = await client.query('SELECT 1 AS ok');
    if (rows[0].ok !== 1) {
      throw new Error('unexpected SELECT 1 result');
    }
    clearTimeout(timer);
    settled = true;
    await client.end();
    console.log('✓ Test DB reachable at ' + url);
    process.exit(0);
  } catch (e) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fatal(
      `Failed to connect to the test database.\n\nError: ${e.message}\n` +
        `Code : ${e.code || 'n/a'}`,
    );
  }
})();
