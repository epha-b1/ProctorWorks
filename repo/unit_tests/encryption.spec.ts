import { EncryptionService } from '../src/common/encryption.service';
import configuration from '../src/config/configuration';

// ---------------------------------------------------------------------------
// audit_report-2 MED: ENCRYPTION_KEY fail-fast validation
//
// The configuration loader must:
//   - reject missing / malformed ENCRYPTION_KEY in NON-test runtime modes
//   - only synthesise an ephemeral fallback when NODE_ENV === 'test'
//   - enforce strict 64-hex format (AES-256 256-bit key material)
// ---------------------------------------------------------------------------
describe('Config: ENCRYPTION_KEY validation', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function withEnv(env: Record<string, string | undefined>): void {
    process.env = { ...ORIGINAL_ENV, ...env };
  }

  it('test-mode with no ENCRYPTION_KEY: synthesises an ephemeral 64-hex key', () => {
    withEnv({ NODE_ENV: 'test', ENCRYPTION_KEY: undefined });
    const cfg = configuration();
    expect(cfg.encryption.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('test-mode with a valid ENCRYPTION_KEY: uses the provided value (lowercased)', () => {
    const provided =
      'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899';
    withEnv({ NODE_ENV: 'test', ENCRYPTION_KEY: provided });
    const cfg = configuration();
    expect(cfg.encryption.key).toBe(provided.toLowerCase());
  });

  it('test-mode with a malformed ENCRYPTION_KEY: fails fast', () => {
    withEnv({ NODE_ENV: 'test', ENCRYPTION_KEY: 'not-hex' });
    expect(() => configuration()).toThrow(/64 hex characters/i);
  });

  it('test-mode with a short ENCRYPTION_KEY: fails fast', () => {
    withEnv({ NODE_ENV: 'test', ENCRYPTION_KEY: 'abcd1234' });
    expect(() => configuration()).toThrow(/64 hex characters/i);
  });

  it('production mode with NO ENCRYPTION_KEY: fails fast at config load', () => {
    withEnv({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: undefined,
      JWT_SECRET: 'x'.repeat(40), // keep JWT happy so we isolate the ENCRYPTION_KEY failure
    });
    expect(() => configuration()).toThrow(/ENCRYPTION_KEY.*required/i);
  });

  it('production mode with malformed ENCRYPTION_KEY: fails fast at config load', () => {
    withEnv({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'bogus-value',
      JWT_SECRET: 'x'.repeat(40),
    });
    expect(() => configuration()).toThrow(/64 hex characters/i);
  });

  it('development mode with NO ENCRYPTION_KEY: fails fast (no static fallback)', () => {
    // Regression guard for the exact defect the audit flagged: if you
    // forget to set ENCRYPTION_KEY in dev, you do NOT silently get a
    // known static key — you get an error.
    withEnv({ NODE_ENV: 'development', ENCRYPTION_KEY: undefined });
    expect(() => configuration()).toThrow(/ENCRYPTION_KEY.*required/i);
  });

  it('production mode with valid ENCRYPTION_KEY: loads successfully', () => {
    withEnv({
      NODE_ENV: 'production',
      ENCRYPTION_KEY:
        '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      JWT_SECRET: 'x'.repeat(40),
    });
    const cfg = configuration();
    expect(cfg.encryption.key).toHaveLength(64);
    expect(cfg.encryption.key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeAll(() => {
    const configService = {
      get: (key: string) => {
        if (key === 'encryption.key') {
          return '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
        }
        return undefined;
      },
    };
    service = new EncryptionService(configService as any);
  });

  it('encrypts and decrypts a string round-trip', () => {
    const plaintext = 'Sensitive user note: SSN 123-45-6789';
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(':'); // iv:tag:data format

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'Same input';
    const a = service.encrypt(plaintext);
    const b = service.encrypt(plaintext);
    expect(a).not.toBe(b); // different IVs
    expect(service.decrypt(a)).toBe(plaintext);
    expect(service.decrypt(b)).toBe(plaintext);
  });

  it('isEncrypted returns true for encrypted format', () => {
    const encrypted = service.encrypt('test');
    expect(service.isEncrypted(encrypted)).toBe(true);
  });

  it('isEncrypted returns false for plain text', () => {
    expect(service.isEncrypted('just a plain note')).toBe(false);
    expect(service.isEncrypted('')).toBe(false);
    expect(service.isEncrypted(null as any)).toBe(false);
  });

  it('decrypt throws on tampered ciphertext', () => {
    const encrypted = service.encrypt('secret');
    const parts = encrypted.split(':');
    parts[2] = 'AAAA' + parts[2].slice(4); // tamper data
    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });

  it('handles unicode and special characters', () => {
    const plaintext = '日本語テスト 🔐 <script>alert(1)</script>';
    const encrypted = service.encrypt(plaintext);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('handles long strings', () => {
    const plaintext = 'A'.repeat(10000);
    const encrypted = service.encrypt(plaintext);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });
});
