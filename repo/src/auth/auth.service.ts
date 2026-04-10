import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EncryptionService } from '../common/encryption.service';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class AuthService {
  private readonly bcryptRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    private readonly sessionsService: SessionsService,
  ) {
    this.bcryptRounds = this.configService.get<number>('bcrypt.rounds', 12);
  }

  /**
   * Resolves the JWT lifetime (matching JwtModule.signOptions.expiresIn)
   * into an absolute expiry Date so we can persist it on the session row.
   * Supports the same suffixes JwtModule accepts: "8h", "30m", "1d", "60s",
   * or a bare number-of-seconds.
   */
  private resolveJwtExpiry(): Date {
    const raw = this.configService.get<string>('jwt.expiry', '8h');
    const m = /^(\d+)([smhd]?)$/i.exec(String(raw).trim());
    let seconds = 8 * 60 * 60;
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = (m[2] || 's').toLowerCase();
      const multipliers: Record<string, number> = {
        s: 1,
        m: 60,
        h: 60 * 60,
        d: 60 * 60 * 24,
      };
      seconds = n * (multipliers[unit] ?? 1);
    }
    return new Date(Date.now() + seconds * 1000);
  }

  async login(
    username: string,
    password: string,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ accessToken: string; user: { id: string; username: string; role: string } }> {
    const user = await this.userRepository.findOne({ where: { username } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is suspended');
    }

    // Check lockout
    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException(
        'Account is temporarily locked. Please try again later.',
      );
    }

    // If lock has expired, reset it
    if (user.locked_until && user.locked_until <= new Date()) {
      user.locked_until = null;
      user.failed_login_count = 0;
      user.status = UserStatus.ACTIVE;
      await this.userRepository.save(user);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      user.failed_login_count += 1;

      if (user.failed_login_count >= 5) {
        user.locked_until = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        user.status = UserStatus.LOCKED;
      }

      await this.userRepository.save(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login count on success
    if (user.failed_login_count > 0) {
      user.failed_login_count = 0;
      user.locked_until = null;
      user.status = UserStatus.ACTIVE;
      await this.userRepository.save(user);
    }

    // Issue a server-side session that backs this JWT. The jti claim
    // links the token to its persisted Session row so logout/admin
    // suspension can revoke it on the next request (F-03).
    const jti = randomUUID();
    const expiresAt = this.resolveJwtExpiry();
    await this.sessionsService.createForJti(
      user.id,
      jti,
      expiresAt,
      context?.ipAddress,
      context?.userAgent,
    );

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      storeId: user.store_id,
      jti,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  /**
   * Logs a user out by invalidating the session row backing the
   * presented JWT. Subsequent requests carrying the same token will
   * fail in JwtStrategy.validate() with 401.
   */
  async logout(userId: string, jti: string | undefined): Promise<void> {
    if (!jti) {
      // Defensive: a token without jti predates this change. We still
      // honor logout intent by invalidating *all* active sessions for
      // the user, which is the safer policy.
      await this.sessionsService.invalidateAllForUser(userId);
      return;
    }
    await this.sessionsService.invalidateByJti(userId, jti);
  }

  async validateUser(payload: { sub: string }): Promise<User | null> {
    return this.userRepository.findOne({ where: { id: payload.sub } });
  }

  /**
   * Enforces the role/store invariant at the user-management boundary.
   *
   * audit_report-2 P0-5: previously a user with role=store_admin could
   * be created or updated WITHOUT a storeId, leaving the cluster in a
   * state where every store-scoped service had to defensively reject
   * the unassigned admin at request time. Worse, a store_admin could
   * be downgraded to a non-scoped role (e.g. content_reviewer) while
   * keeping a stale `store_id`, which would mislead audit-trail
   * lookups about who was scoped to which store.
   *
   * Policy chosen and applied uniformly:
   *   - role=store_admin REQUIRES storeId. Missing storeId at create
   *     OR update fails fast with 400.
   *   - Any non-store_admin role MUST have store_id = null. We strip
   *     it on the way through. This mirrors the database-level
   *     intent (the column is nullable) and removes the stale
   *     assignment ambiguity.
   *
   * Throws BadRequestException for the missing-storeId case so the
   * caller sees a clean validation error in the standard envelope
   * (with traceId), not an opaque 500 from a downstream guard.
   */
  private assertRoleStoreInvariant(
    role: UserRole | string | undefined,
    storeId: string | null | undefined,
  ): string | null {
    if (role === UserRole.STORE_ADMIN) {
      if (!storeId) {
        throw new BadRequestException(
          'storeId is required for role=store_admin',
        );
      }
      return storeId;
    }
    // Non-store_admin: never carry a store assignment, regardless of
    // whatever the caller passed. Returning null here is the silent
    // sanitisation step that removes the stale-assignment ambiguity.
    return null;
  }

  async createUser(dto: CreateUserDto): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('Username already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);

    // P0-5 invariant: store_admin must have storeId; everyone else
    // must NOT have one. Throws BadRequestException on violation.
    const resolvedStoreId = this.assertRoleStoreInvariant(
      dto.role,
      dto.storeId,
    );

    const user = this.userRepository.create({
      username: dto.username,
      password_hash: passwordHash,
      role: dto.role,
      store_id: resolvedStoreId,
    });

    const saved = await this.userRepository.save(user);

    // Remove password_hash from response
    delete (saved as any).password_hash;
    return saved;
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const previousStatus = user.status;

    if (dto.status !== undefined) {
      user.status = dto.status;
    }
    if (dto.role !== undefined) {
      user.role = dto.role;
    }
    if (dto.storeId !== undefined) {
      user.store_id = dto.storeId;
    }
    if (dto.notes !== undefined) {
      user.notes = dto.notes ? this.encryptionService.encrypt(dto.notes) : null;
    }

    // P0-5 invariant: re-validate AFTER all field updates have been
    // applied so we catch every transition into a bad state — e.g.
    //  * promoting to store_admin without supplying a storeId
    //  * downgrading away from store_admin and leaving a stale storeId
    // The helper throws on missing-storeId for store_admin and
    // returns null for any non-store_admin role, which we then
    // assign back so the saved row never carries a stale store.
    user.store_id = this.assertRoleStoreInvariant(user.role, user.store_id);

    const saved = await this.userRepository.save(user);

    // If the user is being suspended or locked, invalidate every
    // active session so any in-flight tokens stop working immediately.
    if (
      dto.status !== undefined &&
      previousStatus !== dto.status &&
      (dto.status === UserStatus.SUSPENDED || dto.status === UserStatus.LOCKED)
    ) {
      await this.sessionsService.invalidateAllForUser(id);
    }

    delete (saved as any).password_hash;
    return saved;
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.userRepository.remove(user);
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
      select: [
        'id',
        'username',
        'role',
        'store_id',
        'status',
        'failed_login_count',
        'locked_until',
        'created_at',
        'updated_at',
      ],
    });

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      select: [
        'id',
        'username',
        'role',
        'store_id',
        'status',
        'failed_login_count',
        'locked_until',
        'notes',
        'created_at',
        'updated_at',
      ],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // Decrypt notes if encrypted
    if (user.notes && this.encryptionService.isEncrypted(user.notes)) {
      user.notes = this.encryptionService.decrypt(user.notes);
    }
    return user;
  }

  async updateNotes(id: string, notes: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    user.notes = this.encryptionService.encrypt(notes);
    return this.userRepository.save(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isCurrentValid = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );
    if (!isCurrentValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.password_hash = await bcrypt.hash(newPassword, this.bcryptRounds);
    await this.userRepository.save(user);
  }
}
