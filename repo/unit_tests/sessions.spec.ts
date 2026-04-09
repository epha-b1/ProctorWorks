/**
 * SessionsService Unit Tests
 *
 * Validates the F-03 (logout / token lifecycle) remediation: a JWT
 * carries a `jti`, the matching session row backs that token, and
 * logout / suspend flips the row to is_active=false so JwtStrategy
 * rejects subsequent requests.
 */
import { UnauthorizedException } from '@nestjs/common';
import { SessionsService } from '../src/sessions/sessions.service';

function makeRepo() {
  return {
    create: jest.fn((d: any) => ({ ...d })),
    save: jest.fn((d: any) => Promise.resolve({ id: 'sess-1', ...d })),
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  };
}

describe('SessionsService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: SessionsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new SessionsService(repo as any);
  });

  describe('hashToken', () => {
    it('produces a stable, deterministic hash', () => {
      const a = SessionsService.hashToken('jti-abc');
      const b = SessionsService.hashToken('jti-abc');
      expect(a).toEqual(b);
      expect(a).not.toEqual('jti-abc'); // never stores plain
      expect(a).toHaveLength(64); // sha256 hex
    });

    it('produces different hashes for different inputs', () => {
      expect(SessionsService.hashToken('a')).not.toEqual(
        SessionsService.hashToken('b'),
      );
    });
  });

  describe('createForJti', () => {
    it('persists an active session for the given jti', async () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      await service.createForJti('user-1', 'jti-xyz', expiresAt, '1.2.3.4', 'curl/8');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          token_hash: SessionsService.hashToken('jti-xyz'),
          ip_address: '1.2.3.4',
          user_agent: 'curl/8',
          expires_at: expiresAt,
          is_active: true,
        }),
      );
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('findActiveByJti', () => {
    it('returns the row when it exists, is active, and not expired', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      repo.findOne.mockResolvedValue({
        id: 'sess-1',
        user_id: 'user-1',
        is_active: true,
        expires_at: future,
        token_hash: SessionsService.hashToken('jti-xyz'),
      });

      const row = await service.findActiveByJti('user-1', 'jti-xyz');
      expect(row).not.toBeNull();
      expect(repo.findOne).toHaveBeenCalledWith({
        where: {
          user_id: 'user-1',
          token_hash: SessionsService.hashToken('jti-xyz'),
          is_active: true,
        },
      });
    });

    it('returns null when no matching row exists (revoked or never existed)', async () => {
      repo.findOne.mockResolvedValue(null);
      const row = await service.findActiveByJti('user-1', 'jti-xyz');
      expect(row).toBeNull();
    });

    it('returns null when the row exists but has already expired', async () => {
      repo.findOne.mockResolvedValue({
        id: 'sess-1',
        user_id: 'user-1',
        is_active: true,
        expires_at: new Date(Date.now() - 1000),
        token_hash: SessionsService.hashToken('jti-xyz'),
      });
      const row = await service.findActiveByJti('user-1', 'jti-xyz');
      expect(row).toBeNull();
    });
  });

  describe('assertActive', () => {
    it('throws UnauthorizedException when no active session is found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.assertActive('user-1', 'jti-xyz')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns silently when an active session exists', async () => {
      repo.findOne.mockResolvedValue({
        id: 'sess-1',
        user_id: 'user-1',
        is_active: true,
        expires_at: new Date(Date.now() + 3600 * 1000),
        token_hash: SessionsService.hashToken('jti-xyz'),
      });
      await expect(
        service.assertActive('user-1', 'jti-xyz'),
      ).resolves.toBeUndefined();
    });
  });

  describe('invalidateByJti', () => {
    it('flips is_active=false on the matching session', async () => {
      await service.invalidateByJti('user-1', 'jti-xyz');
      expect(repo.update).toHaveBeenCalledWith(
        { user_id: 'user-1', token_hash: SessionsService.hashToken('jti-xyz') },
        { is_active: false },
      );
    });
  });

  describe('invalidateAllForUser', () => {
    it('flips is_active=false for every active session of the user', async () => {
      await service.invalidateAllForUser('user-1');
      expect(repo.update).toHaveBeenCalledWith(
        { user_id: 'user-1', is_active: true },
        { is_active: false },
      );
    });
  });

  describe('purgeExpired', () => {
    it('deletes rows whose expires_at is before the cutoff', async () => {
      repo.delete.mockResolvedValue({ affected: 3 });
      const cutoff = new Date('2026-01-01');
      const removed = await service.purgeExpired(cutoff);
      expect(removed).toBe(3);
      expect(repo.delete).toHaveBeenCalled();
    });
  });
});
