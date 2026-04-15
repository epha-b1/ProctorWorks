/// <reference types="jest" />
import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { UserStatus } from '../src/auth/entities/user.entity';

function makeStrategy(overrides: {
  user?: any;
  assertActive?: jest.Mock;
} = {}) {
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(overrides.user ?? null),
  };
  const sessionsService = {
    assertActive: overrides.assertActive ?? jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn((k: string) =>
      k === 'jwt.secret' ? 'dev-jwt-secret-min-32-chars-long-x' : undefined,
    ),
  };
  const strategy = new JwtStrategy(
    config as any,
    userRepository as any,
    sessionsService as any,
  );
  return { strategy, userRepository, sessionsService };
}

describe('JwtStrategy.validate', () => {
  it('rejects when payload has no sub', async () => {
    const { strategy } = makeStrategy();
    await expect(strategy.validate({} as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when user no longer exists in DB', async () => {
    const { strategy } = makeStrategy({ user: null });
    await expect(
      strategy.validate({
        sub: 'u-1',
        username: 'u',
        role: 'platform_admin',
        storeId: null,
        jti: 'jti-1',
      }),
    ).rejects.toThrow(/no longer exists/i);
  });

  it('rejects when user is SUSPENDED (status ≠ ACTIVE)', async () => {
    const { strategy } = makeStrategy({
      user: {
        id: 'u-1',
        username: 'u',
        role: 'platform_admin',
        store_id: null,
        status: UserStatus.SUSPENDED,
      },
    });
    await expect(
      strategy.validate({
        sub: 'u-1',
        username: 'u',
        role: 'platform_admin',
        storeId: null,
        jti: 'jti-1',
      }),
    ).rejects.toThrow(/suspended/i);
  });

  it('rejects when token is missing jti (pre-F-03 token)', async () => {
    const { strategy } = makeStrategy({
      user: {
        id: 'u-1',
        username: 'u',
        role: 'platform_admin',
        store_id: null,
        status: UserStatus.ACTIVE,
      },
    });
    await expect(
      strategy.validate({
        sub: 'u-1',
        username: 'u',
        role: 'platform_admin',
        storeId: null,
      } as any),
    ).rejects.toThrow(/session id/i);
  });

  it('rejects when sessionsService.assertActive throws', async () => {
    const assertActive = jest.fn().mockRejectedValue(
      new UnauthorizedException('Session is inactive'),
    );
    const { strategy } = makeStrategy({
      user: {
        id: 'u-1',
        username: 'u',
        role: 'platform_admin',
        store_id: null,
        status: UserStatus.ACTIVE,
      },
      assertActive,
    });
    await expect(
      strategy.validate({
        sub: 'u-1',
        username: 'u',
        role: 'platform_admin',
        storeId: null,
        jti: 'jti-1',
      }),
    ).rejects.toThrow(/inactive/i);
    expect(assertActive).toHaveBeenCalledWith('u-1', 'jti-1');
  });

  it('returns normalised user context when every check passes', async () => {
    const { strategy, sessionsService } = makeStrategy({
      user: {
        id: 'u-1',
        username: 'alice',
        role: 'store_admin',
        store_id: 'store-7',
        status: UserStatus.ACTIVE,
      },
    });
    const result = await strategy.validate({
      sub: 'u-1',
      username: 'alice',
      role: 'store_admin',
      storeId: 'store-7',
      jti: 'jti-active',
    });
    expect(result).toEqual({
      id: 'u-1',
      username: 'alice',
      role: 'store_admin',
      storeId: 'store-7',
      jti: 'jti-active',
    });
    expect(sessionsService.assertActive).toHaveBeenCalledWith('u-1', 'jti-active');
  });
});
