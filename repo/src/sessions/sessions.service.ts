import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Session } from './entities/session.entity';

/**
 * SessionsService — server-side session/JTI store backing JWT lifecycle.
 *
 * Each issued JWT carries a `jti` claim. We persist the matching Session
 * row at login (active=true) and flip `is_active=false` on logout. The
 * JWT strategy looks the row up on every request: if it's missing,
 * inactive, or expired, the token is rejected with 401.
 *
 * Tokens are not stored verbatim — only a SHA-256 hash of the jti is
 * persisted as `token_hash`, so DB exfiltration alone never yields a
 * usable token.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
  ) {}

  /**
   * Hashes a jti (or any token-shaped string) so we never store the
   * original value at rest. SHA-256 is appropriate here because the
   * input is already high-entropy random.
   */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createForJti(
    userId: string,
    jti: string,
    expiresAt: Date,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Session> {
    const session = this.sessionRepo.create({
      user_id: userId,
      token_hash: SessionsService.hashToken(jti),
      ip_address: ipAddress ?? null,
      user_agent: userAgent ?? null,
      expires_at: expiresAt,
      is_active: true,
    });
    return this.sessionRepo.save(session);
  }

  /**
   * Returns the matching active, unexpired session or null. Used by
   * the JWT strategy on every protected request.
   */
  async findActiveByJti(userId: string, jti: string): Promise<Session | null> {
    const tokenHash = SessionsService.hashToken(jti);
    const session = await this.sessionRepo.findOne({
      where: { user_id: userId, token_hash: tokenHash, is_active: true },
    });
    if (!session) return null;
    if (session.expires_at && session.expires_at <= new Date()) {
      // Expired but never explicitly invalidated — treat as inactive.
      return null;
    }
    return session;
  }

  /**
   * Asserts a session is currently usable. Throws UnauthorizedException
   * with the same shape AuthService.login uses, so the global filter
   * maps it to a 401 with a stable error code.
   */
  async assertActive(userId: string, jti: string): Promise<void> {
    const session = await this.findActiveByJti(userId, jti);
    if (!session) {
      throw new UnauthorizedException('Session is not active');
    }
  }

  /**
   * Invalidates the session matching the given jti (current logout flow).
   */
  async invalidateByJti(userId: string, jti: string): Promise<void> {
    const tokenHash = SessionsService.hashToken(jti);
    await this.sessionRepo.update(
      { user_id: userId, token_hash: tokenHash },
      { is_active: false },
    );
  }

  /**
   * Invalidates every active session for a user. Used when an account
   * is suspended/locked or for forced-logout flows.
   */
  async invalidateAllForUser(userId: string): Promise<void> {
    await this.sessionRepo.update(
      { user_id: userId, is_active: true },
      { is_active: false },
    );
  }

  /**
   * Housekeeping: physical delete of long-expired rows. Called from a
   * lightweight cron in the auth module if needed; safe to call ad-hoc.
   */
  async purgeExpired(olderThan: Date = new Date()): Promise<number> {
    const result = await this.sessionRepo.delete({
      expires_at: LessThan(olderThan),
    });
    return result.affected ?? 0;
  }
}
