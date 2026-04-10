import { randomBytes } from 'crypto';

/**
 * AES-256 requires exactly 256 bits (= 32 bytes = 64 hex chars) of key
 * material. Anything else is either a configuration bug (truncated copy /
 * paste) or an attacker-influenced value, and must fail the app at
 * startup rather than silently degrade cryptographic strength.
 */
const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * Resolves `ENCRYPTION_KEY` for data-at-rest encryption
 * (`common/encryption.service.ts`).
 *
 * audit_report-2 MED: the prior code used a hard-coded static fallback
 * (`0123456789ab...`) whenever the env var was missing. If production was
 * ever deployed with that env unset (or inherited from a shared dev
 * template) the ciphertext would be decryptable by anyone with access to
 * the published fallback — effectively no encryption at all.
 *
 * Contract enforced here:
 *
 *   - Normal runtime (`NODE_ENV` != 'test'): `ENCRYPTION_KEY` is REQUIRED
 *     and must be exactly 64 hex characters. Missing or malformed values
 *     throw at config-load time, so the app refuses to start rather than
 *     booting with weak or absent key material.
 *
 *   - Test mode (`NODE_ENV` === 'test'): if `ENCRYPTION_KEY` is provided,
 *     it must still be 64 hex chars. If it is NOT provided, a clearly
 *     labelled ephemeral key is generated via `randomBytes(32)` so test
 *     suites don't need to plumb a real secret. This path is explicitly
 *     documented and isolated — it is never reachable in production, and
 *     the generated key lives only for the current process lifetime.
 */
function resolveEncryptionKey(): string {
  const raw = process.env.ENCRYPTION_KEY;
  const isTest = process.env.NODE_ENV === 'test';

  if (raw && raw.length > 0) {
    if (!HEX_64.test(raw)) {
      throw new Error(
        'ENCRYPTION_KEY must be exactly 64 hex characters (256-bit AES key). ' +
          'Generate one with: `openssl rand -hex 32`.',
      );
    }
    return raw.toLowerCase();
  }

  if (isTest) {
    // Ephemeral, per-process test key — never written anywhere, never
    // logged, never persisted. This branch is the ONLY allowed fallback
    // and is gated on NODE_ENV=test explicitly.
    return randomBytes(32).toString('hex');
  }

  throw new Error(
    'ENCRYPTION_KEY environment variable is required. ' +
      'It must be exactly 64 hex characters (256-bit AES key). ' +
      'Generate one with: `openssl rand -hex 32`.',
  );
}

/**
 * Resolves `JWT_SECRET` with similar fail-fast semantics:
 *   - production: required, must be present
 *   - dev / test: an ephemeral per-process value is used if the env var
 *     is missing, so contributors aren't blocked by local setup.
 */
function resolveJwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  if (raw && raw.length > 0) {
    return raw;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return `dev-only-${randomBytes(32).toString('hex')}`;
}

export default () => {
  return {
    database: {
      url:
        process.env.DATABASE_URL ||
        'postgres://proctorworks:proctorworks@localhost:5432/proctorworks',
    },
    jwt: {
      secret: resolveJwtSecret(),
      expiry: process.env.JWT_EXPIRY || '8h',
    },
    bcrypt: {
      rounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
    },
    encryption: {
      key: resolveEncryptionKey(),
    },
    lowStockThreshold: parseInt(process.env.LOW_STOCK_THRESHOLD, 10) || 10,
    stalenessThresholdHours:
      parseInt(process.env.STALENESS_THRESHOLD_HOURS, 10) || 24,
    port: parseInt(process.env.PORT, 10) || 3000,
  };
};
