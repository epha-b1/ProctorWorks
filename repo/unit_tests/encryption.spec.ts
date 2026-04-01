import { EncryptionService } from '../src/common/encryption.service';

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
