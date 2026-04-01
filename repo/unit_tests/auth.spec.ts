import {
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/auth/auth.service';
import { UserRole, UserStatus } from '../src/auth/entities/user.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'testuser',
    password_hash: '$2b$12$hashedpassword',
    role: UserRole.STORE_ADMIN,
    store_id: 'store-uuid-1',
    status: UserStatus.ACTIVE,
    failed_login_count: 0,
    locked_until: null,
    notes: null,
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockRepository() {
  return {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn((dto: any) => ({ ...dto })),
    save: jest.fn((entity: any) => Promise.resolve({ ...entity })),
    remove: jest.fn(),
  };
}

function createMockJwtService() {
  return {
    sign: jest.fn(() => 'signed-jwt-token'),
    verify: jest.fn(() => ({ sub: 'user-uuid-1', username: 'testuser', role: 'store_admin' })),
  };
}

function createMockConfigService() {
  return {
    get: jest.fn((key: string, defaultVal?: any) => {
      if (key === 'bcrypt.rounds') return 10;
      return defaultVal;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof createMockRepository>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let configService: ReturnType<typeof createMockConfigService>;

  beforeEach(() => {
    userRepo = createMockRepository();
    jwtService = createMockJwtService();
    configService = createMockConfigService();

    service = new AuthService(
      userRepo as any,
      jwtService as any,
      configService as any,
    );
  });

  // -----------------------------------------------------------------------
  // 1. Password hashing: bcrypt hash and verify
  // -----------------------------------------------------------------------
  describe('password hashing (bcrypt)', () => {
    it('should hash a password and verify it correctly', async () => {
      const plain = 'MySecretP@ss1';
      const hash = await bcrypt.hash(plain, 10);

      expect(hash).not.toBe(plain);
      expect(await bcrypt.compare(plain, hash)).toBe(true);
      expect(await bcrypt.compare('wrongpassword', hash)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 2. JWT sign and verify
  // -----------------------------------------------------------------------
  describe('JWT sign and verify', () => {
    it('sign returns a token string', () => {
      const token = jwtService.sign({ sub: 'id', username: 'u', role: 'store_admin' });
      expect(token).toBe('signed-jwt-token');
      expect(jwtService.sign).toHaveBeenCalled();
    });

    it('verify decodes the payload', () => {
      const payload = jwtService.verify('signed-jwt-token');
      expect(payload).toEqual(expect.objectContaining({ sub: 'user-uuid-1' }));
      expect(jwtService.verify).toHaveBeenCalledWith('signed-jwt-token');
    });
  });

  // -----------------------------------------------------------------------
  // 3. Login success returns accessToken + user object
  // -----------------------------------------------------------------------
  describe('login', () => {
    it('should return accessToken and user on valid credentials', async () => {
      const plainPassword = 'correctPassword';
      const hashed = await bcrypt.hash(plainPassword, 10);
      const user = makeUser({ password_hash: hashed });

      userRepo.findOne.mockResolvedValue(user);

      const result = await service.login('testuser', plainPassword);

      expect(result).toEqual({
        accessToken: 'signed-jwt-token',
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: user.id,
          username: user.username,
          role: user.role,
          storeId: user.store_id,
        }),
      );
    });

    // ---------------------------------------------------------------------
    // 4. Login: wrong password -> UnauthorizedException
    // ---------------------------------------------------------------------
    it('should throw UnauthorizedException for wrong password', async () => {
      const hashed = await bcrypt.hash('correctPassword', 10);
      const user = makeUser({ password_hash: hashed });

      userRepo.findOne.mockResolvedValue(user);

      await expect(service.login('testuser', 'wrongPassword')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.login('nobody', 'any')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    // ---------------------------------------------------------------------
    // 5. Login: account locked (locked_until in future) -> UnauthorizedException
    // ---------------------------------------------------------------------
    it('should throw UnauthorizedException when account is locked', async () => {
      const user = makeUser({
        locked_until: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in future
        status: UserStatus.LOCKED,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.login('testuser', 'any')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login('testuser', 'any')).rejects.toThrow(
        /temporarily locked/,
      );
    });

    // ---------------------------------------------------------------------
    // 6. Login: 5 failed attempts -> account gets locked
    // ---------------------------------------------------------------------
    it('should lock the account after 5 failed login attempts', async () => {
      const hashed = await bcrypt.hash('correctPassword', 10);
      const user = makeUser({ password_hash: hashed, failed_login_count: 4 });

      userRepo.findOne.mockResolvedValue(user);

      await expect(service.login('testuser', 'wrongPassword')).rejects.toThrow(
        UnauthorizedException,
      );

      // After the 5th failure the save should have set locked_until and LOCKED status
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failed_login_count: 5,
          status: UserStatus.LOCKED,
        }),
      );
      // locked_until should be roughly 15 min from now
      const savedArg = userRepo.save.mock.calls[0][0];
      expect(savedArg.locked_until).toBeInstanceOf(Date);
      const diff = savedArg.locked_until.getTime() - Date.now();
      expect(diff).toBeGreaterThan(14 * 60 * 1000);
      expect(diff).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    });

    // ---------------------------------------------------------------------
    // 7. Login: lock expired -> resets on next attempt
    // ---------------------------------------------------------------------
    it('should reset lock and allow login when lock has expired', async () => {
      const plainPassword = 'correctPassword';
      const hashed = await bcrypt.hash(plainPassword, 10);
      const user = makeUser({
        password_hash: hashed,
        locked_until: new Date(Date.now() - 1000), // expired
        failed_login_count: 5,
        status: UserStatus.LOCKED,
      });

      userRepo.findOne.mockResolvedValue(user);
      // After the lock-reset save, the user object is mutated in place
      userRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const result = await service.login('testuser', plainPassword);

      expect(result.accessToken).toBe('signed-jwt-token');
      // The first save call should reset the lock fields
      const firstSaveArg = userRepo.save.mock.calls[0][0];
      expect(firstSaveArg.locked_until).toBeNull();
      expect(firstSaveArg.failed_login_count).toBe(0);
      expect(firstSaveArg.status).toBe(UserStatus.ACTIVE);
    });

    // ---------------------------------------------------------------------
    // 8. Login: suspended account -> UnauthorizedException
    // ---------------------------------------------------------------------
    it('should throw UnauthorizedException for suspended account', async () => {
      const user = makeUser({ status: UserStatus.SUSPENDED });
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.login('testuser', 'any')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login('testuser', 'any')).rejects.toThrow(
        /suspended/,
      );
    });

    // Successful login resets failed_login_count
    it('should reset failed_login_count on successful login after previous failures', async () => {
      const plainPassword = 'correctPassword';
      const hashed = await bcrypt.hash(plainPassword, 10);
      const user = makeUser({ password_hash: hashed, failed_login_count: 3 });

      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      await service.login('testuser', plainPassword);

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failed_login_count: 0,
          locked_until: null,
          status: UserStatus.ACTIVE,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 9. Role check logic: platform_admin, store_admin, content_reviewer, auditor
  // -----------------------------------------------------------------------
  describe('role check logic', () => {
    const roles = [
      UserRole.PLATFORM_ADMIN,
      UserRole.STORE_ADMIN,
      UserRole.CONTENT_REVIEWER,
      UserRole.AUDITOR,
    ] as const;

    it.each(roles)(
      'should include correct role "%s" in JWT payload on login',
      async (role) => {
        const plainPassword = 'pass123';
        const hashed = await bcrypt.hash(plainPassword, 10);
        const user = makeUser({ password_hash: hashed, role });

        userRepo.findOne.mockResolvedValue(user);

        await service.login('testuser', plainPassword);

        expect(jwtService.sign).toHaveBeenCalledWith(
          expect.objectContaining({ role }),
        );
      },
    );

    it('should return the role in the user object from login', async () => {
      const plainPassword = 'pass123';
      const hashed = await bcrypt.hash(plainPassword, 10);

      for (const role of roles) {
        const user = makeUser({ password_hash: hashed, role });
        userRepo.findOne.mockResolvedValue(user);
        jwtService.sign.mockClear();

        const result = await service.login('testuser', plainPassword);
        expect(result.user.role).toBe(role);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 10. createUser: hashes password, creates user
  // -----------------------------------------------------------------------
  describe('createUser', () => {
    it('should hash the password and create a user', async () => {
      userRepo.findOne.mockResolvedValue(null); // no duplicate
      userRepo.create.mockImplementation((data: any) => ({ ...data }));
      userRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'new-uuid', ...entity }),
      );

      const dto = {
        username: 'newuser',
        password: 'plaintext123',
        role: UserRole.CONTENT_REVIEWER,
        storeId: 'store-1',
      };

      const result = await service.createUser(dto as any);

      // password_hash should be a bcrypt hash, not the plain text
      const createArg = userRepo.create.mock.calls[0][0];
      expect(createArg.password_hash).toBeDefined();
      expect(createArg.password_hash).not.toBe(dto.password);
      expect(await bcrypt.compare(dto.password, createArg.password_hash)).toBe(true);

      expect(createArg.username).toBe(dto.username);
      expect(createArg.role).toBe(dto.role);
      expect(createArg.store_id).toBe(dto.storeId);

      // password_hash should be stripped from the returned object
      expect((result as any).password_hash).toBeUndefined();
    });

    it('should default store_id to null when storeId is not provided', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockImplementation((data: any) => ({ ...data }));
      userRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: 'new-uuid', ...entity }),
      );

      const dto = {
        username: 'newuser',
        password: 'plaintext123',
        role: UserRole.AUDITOR,
      };

      await service.createUser(dto as any);

      const createArg = userRepo.create.mock.calls[0][0];
      expect(createArg.store_id).toBeNull();
    });

    // -------------------------------------------------------------------
    // 11. createUser: duplicate username -> ConflictException
    // -------------------------------------------------------------------
    it('should throw ConflictException when username already exists', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());

      const dto = {
        username: 'testuser',
        password: 'whatever',
        role: UserRole.STORE_ADMIN,
      };

      await expect(service.createUser(dto as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 12. changePassword: correct current password -> success
  // -----------------------------------------------------------------------
  describe('changePassword', () => {
    it('should change password when current password is correct', async () => {
      const currentPlain = 'currentPass';
      const hashed = await bcrypt.hash(currentPlain, 10);
      const user = makeUser({ password_hash: hashed });

      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      await service.changePassword('user-uuid-1', currentPlain, 'newPass123');

      expect(userRepo.save).toHaveBeenCalled();
      const savedUser = userRepo.save.mock.calls[0][0];
      // The new hash should validate against the new password
      expect(await bcrypt.compare('newPass123', savedUser.password_hash)).toBe(true);
      // And should NOT validate against the old password
      expect(await bcrypt.compare(currentPlain, savedUser.password_hash)).toBe(false);
    });

    // -------------------------------------------------------------------
    // 13. changePassword: wrong current password -> BadRequestException
    // -------------------------------------------------------------------
    it('should throw BadRequestException when current password is wrong', async () => {
      const hashed = await bcrypt.hash('realPassword', 10);
      const user = makeUser({ password_hash: hashed });

      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.changePassword('user-uuid-1', 'wrongCurrent', 'newPass'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword('nonexistent', 'a', 'b'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------------
  // 14. findAll: returns paginated results
  // -----------------------------------------------------------------------
  describe('findAll', () => {
    it('should return paginated results with correct structure', async () => {
      const users = [makeUser(), makeUser({ id: 'user-uuid-2', username: 'user2' })];
      userRepo.findAndCount.mockResolvedValue([users, 25]);

      const result = await service.findAll(2, 10);

      expect(result).toEqual({
        data: users,
        total: 25,
        page: 2,
        limit: 10,
      });
      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10, // (page 2 - 1) * limit 10
          take: 10,
          order: { created_at: 'DESC' },
        }),
      );
    });

    it('should use default page=1 and limit=20', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 15. findById: returns user / throws NotFoundException
  // -----------------------------------------------------------------------
  describe('findById', () => {
    it('should return user when found', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.findById('user-uuid-1');
      expect(result).toEqual(user);
      expect(userRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid-1' },
        }),
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------------
  // validateUser
  // -----------------------------------------------------------------------
  describe('validateUser', () => {
    it('should return user for valid payload', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.validateUser({ sub: 'user-uuid-1' });
      expect(result).toEqual(user);
    });

    it('should return null when user is not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.validateUser({ sub: 'missing' });
      expect(result).toBeNull();
    });
  });
});
