import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from './entities/user.entity';
import { SessionsService } from '../sessions/sessions.service';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  storeId: string | null;
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly sessionsService: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  /**
   * On every protected request:
   * 1. Verify the user still exists and is ACTIVE.
   * 2. Verify the JWT's `jti` matches an active, non-expired session.
   *
   * Either failure surfaces as 401 to the client. This is the
   * server-side enforcement that makes logout / suspension actually
   * stop in-flight tokens (F-03).
   */
  async validate(payload: JwtPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      select: ['id', 'username', 'role', 'store_id', 'status'],
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }

    // jti is required for tokens minted after F-03 lands. Tokens minted
    // before this change won't have a jti and are rejected — operators
    // must re-login. This is the safest cutover path.
    if (!payload.jti) {
      throw new UnauthorizedException('Token missing session id');
    }

    await this.sessionsService.assertActive(payload.sub, payload.jti);

    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      storeId: payload.storeId,
      jti: payload.jti,
    };
  }
}
