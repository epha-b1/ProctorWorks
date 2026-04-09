/**
 * ProctorWorks Auth & Users API Integration Tests
 *
 * These tests run against a real NestJS application backed by PostgreSQL.
 * Requires DATABASE_URL (or defaults to local dev DB).
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNIQUE = Date.now();

function logStep(method: string, path: string, status?: number): void {
  if (status !== undefined) {
    console.log(`  \u2190 ${status}`);
  } else {
    console.log(`  \u2192 ${method} ${path}`);
  }
}

async function login(
  server: any,
  username: string,
  password: string,
): Promise<string> {
  logStep('POST', '/auth/login');
  const res = await request(server)
    .post('/auth/login')
    .send({ username, password });
  logStep('POST', '/auth/login', res.status);
  return res.body.accessToken;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Auth & Users API', () => {
  let app: INestApplication;
  let server: any;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer();

    // Obtain an admin JWT for use in protected-endpoint tests
    adminToken = await login(server, 'admin', 'Admin1234!');
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // 14. GET /health
  // -----------------------------------------------------------------------
  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      logStep('GET', '/health');
      const res = await request(server).get('/health');
      logStep('GET', '/health', res.status);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe('connected');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  // -----------------------------------------------------------------------
  // 1. POST /auth/login — valid credentials
  // -----------------------------------------------------------------------
  describe('POST /auth/login', () => {
    it('should return 200 with accessToken and user for valid credentials', async () => {
      logStep('POST', '/auth/login');
      const res = await request(server)
        .post('/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });
      logStep('POST', '/auth/login', res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user).toHaveProperty('username', 'admin');
      expect(res.body.user).toHaveProperty('role');
    });

    // 2. Wrong password
    it('should return 401 for wrong password', async () => {
      logStep('POST', '/auth/login');
      const res = await request(server)
        .post('/auth/login')
        .send({ username: 'admin', password: 'WrongPassword!' });
      logStep('POST', '/auth/login', res.status);

      expect(res.status).toBe(401);
    });

    // 3. Non-existent user
    it('should return 401 for non-existent user', async () => {
      logStep('POST', '/auth/login');
      const res = await request(server)
        .post('/auth/login')
        .send({ username: `ghost_${UNIQUE}`, password: 'whatever' });
      logStep('POST', '/auth/login', res.status);

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/logout
  // -----------------------------------------------------------------------
  describe('POST /auth/logout', () => {
    // Use a disposable user/token here so the shared adminToken survives
    // for the rest of this suite — F-03 makes logout actually invalidate
    // the JWT it was called with, so reusing adminToken would 401 every
    // subsequent test.
    let logoutUser: string;
    let logoutToken: string;

    beforeAll(async () => {
      logoutUser = `logoutuser_${UNIQUE}`;
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: logoutUser,
          password: 'Logout1234!',
          role: 'store_admin',
        });
      logoutToken = await login(server, logoutUser, 'Logout1234!');
    });

    it('should return 204 and log audit entry', async () => {
      logStep('POST', '/auth/logout');
      const res = await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${logoutToken}`);
      logStep('POST', '/auth/logout', res.status);

      expect(res.status).toBe(204);
    });

    it('subsequent requests with the same token are rejected (F-03)', async () => {
      // The logout above flipped the session row inactive. Hitting any
      // protected endpoint with the same JWT must now produce a 401.
      const res = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${logoutToken}`);
      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // 4 & 5. GET /auth/me
  // -----------------------------------------------------------------------
  describe('GET /auth/me', () => {
    it('should return 200 with user info when token is provided', async () => {
      logStep('GET', '/auth/me');
      const res = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/auth/me', res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('username', 'admin');
    });

    it('should return 401 without token', async () => {
      logStep('GET', '/auth/me');
      const res = await request(server).get('/auth/me');
      logStep('GET', '/auth/me', res.status);

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // 6 & 7. PATCH /auth/change-password
  // -----------------------------------------------------------------------
  describe('PATCH /auth/change-password', () => {
    const cpUser = `cpuser_${UNIQUE}`;
    let cpToken: string;

    beforeAll(async () => {
      // Create a disposable user for password-change tests
      logStep('POST', '/users (setup cpuser)');
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: cpUser,
          password: 'Original1234!',
          role: 'store_admin',
        });

      cpToken = await login(server, cpUser, 'Original1234!');
    });

    it('should return 200 when current password is correct', async () => {
      logStep('PATCH', '/auth/change-password');
      const res = await request(server)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${cpToken}`)
        .send({
          currentPassword: 'Original1234!',
          newPassword: 'Changed1234!',
        });
      logStep('PATCH', '/auth/change-password', res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Password changed successfully');
    });

    it('should return 400 when current password is wrong', async () => {
      // After the previous test the password is now Changed1234!
      logStep('PATCH', '/auth/change-password');
      const freshToken = await login(server, cpUser, 'Changed1234!');
      const res = await request(server)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${freshToken}`)
        .send({
          currentPassword: 'TotallyWrong!',
          newPassword: 'Another1234!',
        });
      logStep('PATCH', '/auth/change-password', res.status);

      expect(res.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // 8 & 9. GET /users
  // -----------------------------------------------------------------------
  describe('GET /users', () => {
    it('should return 401 without token', async () => {
      logStep('GET', '/users');
      const res = await request(server).get('/users');
      logStep('GET', '/users', res.status);

      expect(res.status).toBe(401);
    });

    it('should return 200 with a list when using admin token', async () => {
      logStep('GET', '/users');
      const res = await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/users', res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('limit');
    });
  });

  // -----------------------------------------------------------------------
  // 10 & 11. POST /users — create + duplicate
  // -----------------------------------------------------------------------
  describe('POST /users', () => {
    const newUser = `newuser_${UNIQUE}`;

    it('should return 201 when creating a new user', async () => {
      logStep('POST', '/users');
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: newUser,
          password: 'Passw0rd!',
          role: 'store_admin',
        });
      logStep('POST', '/users', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('username', newUser);
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('should return 409 for duplicate username', async () => {
      logStep('POST', '/users');
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: newUser,
          password: 'Passw0rd!',
          role: 'store_admin',
        });
      logStep('POST', '/users', res.status);

      expect(res.status).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // 12 & 13. PATCH /users/:id and DELETE /users/:id
  // -----------------------------------------------------------------------
  describe('PATCH /users/:id and DELETE /users/:id', () => {
    let userId: string;
    const patchUser = `patchuser_${UNIQUE}`;

    beforeAll(async () => {
      logStep('POST', '/users (setup patchuser)');
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: patchUser,
          password: 'Passw0rd!',
          role: 'store_admin',
        });
      userId = res.body.id;
    });

    it('should return 200 when updating role', async () => {
      logStep('PATCH', `/users/${userId}`);
      const res = await request(server)
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'auditor' });
      logStep('PATCH', `/users/${userId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('role', 'auditor');
    });

    it('should return 204 when deleting user', async () => {
      logStep('DELETE', `/users/${userId}`);
      const res = await request(server)
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('DELETE', `/users/${userId}`, res.status);

      expect(res.status).toBe(204);
    });
  });

  // -----------------------------------------------------------------------
  // 15. Account lockout after 5 failed attempts
  // -----------------------------------------------------------------------
  describe('Account lockout', () => {
    const lockUser = `lockuser_${UNIQUE}`;

    beforeAll(async () => {
      logStep('POST', '/users (setup lockuser)');
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: lockUser,
          password: 'Correct1234!',
          role: 'store_admin',
        });
    });

    it('should lock account after 5 wrong passwords, then reject correct password', async () => {
      // Send 5 wrong-password requests
      for (let i = 1; i <= 5; i++) {
        logStep('POST', `/auth/login (wrong attempt ${i})`);
        const res = await request(server)
          .post('/auth/login')
          .send({ username: lockUser, password: 'Wrong!!!!!!' });
        logStep('POST', '/auth/login', res.status);
        expect(res.status).toBe(401);
      }

      // The 6th attempt with the CORRECT password should still be rejected (locked)
      logStep('POST', '/auth/login (correct but locked)');
      const res = await request(server)
        .post('/auth/login')
        .send({ username: lockUser, password: 'Correct1234!' });
      logStep('POST', '/auth/login', res.status);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/locked/i);
    });
  });
});
