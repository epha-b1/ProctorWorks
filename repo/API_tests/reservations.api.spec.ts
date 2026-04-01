/**
 * ProctorWorks Reservations API Integration Tests
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
import { DataSource } from 'typeorm';
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

describe('Reservations API', () => {
  let app: INestApplication;
  let server: any;
  let dataSource: DataSource;
  let adminToken: string;

  // Test fixtures created in beforeAll
  let roomId: string;
  let zoneId: string;
  let availableSeatId: string;
  let maintenanceSeatId: string;

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
    dataSource = moduleFixture.get(DataSource);

    // Login as admin
    adminToken = await login(server, 'admin', 'Admin1234!');

    // Create a room
    logStep('POST', '/rooms (setup)');
    const roomRes = await request(server)
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Test Room ${UNIQUE}` });
    logStep('POST', '/rooms', roomRes.status);
    roomId = roomRes.body.id;

    // Create a zone
    logStep('POST', `/rooms/${roomId}/zones (setup)`);
    const zoneRes = await request(server)
      .post(`/rooms/${roomId}/zones`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Test Zone ${UNIQUE}` });
    logStep('POST', `/rooms/${roomId}/zones`, zoneRes.status);
    zoneId = zoneRes.body.id;

    // Create an available seat
    logStep('POST', `/zones/${zoneId}/seats (available seat setup)`);
    const availSeatRes = await request(server)
      .post(`/zones/${zoneId}/seats`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: `Seat-Avail-${UNIQUE}` });
    logStep('POST', `/zones/${zoneId}/seats`, availSeatRes.status);
    availableSeatId = availSeatRes.body.id;

    // Create a maintenance seat
    logStep('POST', `/zones/${zoneId}/seats (maintenance seat setup)`);
    const maintSeatRes = await request(server)
      .post(`/zones/${zoneId}/seats`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: `Seat-Maint-${UNIQUE}` });
    logStep('POST', `/zones/${zoneId}/seats`, maintSeatRes.status);
    maintenanceSeatId = maintSeatRes.body.id;

    // Set the second seat to maintenance
    logStep('PATCH', `/seats/${maintenanceSeatId} (set maintenance)`);
    const patchRes = await request(server)
      .patch(`/seats/${maintenanceSeatId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'maintenance' });
    logStep('PATCH', `/seats/${maintenanceSeatId}`, patchRes.status);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // 1. POST /reservations with available seat -> 201
  // -----------------------------------------------------------------------
  describe('POST /reservations - create hold on available seat', () => {
    it('should return 201 with hold status and holdUntil ~15 min from now', async () => {
      const beforeCreate = Date.now();

      logStep('POST', '/reservations');
      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId: availableSeatId });
      logStep('POST', '/reservations', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('seat_id', availableSeatId);
      expect(res.body).toHaveProperty('status', 'hold');
      expect(res.body).toHaveProperty('hold_until');

      // Verify holdUntil is approximately 15 minutes from now
      const holdUntil = new Date(res.body.hold_until).getTime();
      const expectedMin = beforeCreate + 14 * 60 * 1000; // at least 14 min
      const expectedMax = beforeCreate + 16 * 60 * 1000; // at most 16 min
      expect(holdUntil).toBeGreaterThanOrEqual(expectedMin);
      expect(holdUntil).toBeLessThanOrEqual(expectedMax);
    });
  });

  // -----------------------------------------------------------------------
  // 2. POST /reservations with maintenance seat -> 400
  // -----------------------------------------------------------------------
  describe('POST /reservations - maintenance seat', () => {
    it('should return 400 when seat is under maintenance', async () => {
      logStep('POST', '/reservations (maintenance seat)');
      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId: maintenanceSeatId });
      logStep('POST', '/reservations', res.status);

      expect(res.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // 3. POST /reservations with already-held seat -> 409
  // -----------------------------------------------------------------------
  describe('POST /reservations - already held seat', () => {
    it('should return 409 when an active hold already exists', async () => {
      // The available seat already has a hold from test 1
      logStep('POST', '/reservations (duplicate hold)');
      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId: availableSeatId });
      logStep('POST', '/reservations', res.status);

      expect(res.status).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // 4. POST /reservations/:id/confirm -> 200, status=confirmed
  // -----------------------------------------------------------------------
  describe('POST /reservations/:id/confirm - confirm a hold', () => {
    let holdId: string;

    beforeAll(async () => {
      // Create a fresh seat and hold for this test
      logStep('POST', `/zones/${zoneId}/seats (confirm test seat)`);
      const seatRes = await request(server)
        .post(`/zones/${zoneId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `Seat-Confirm-${UNIQUE}` });
      const seatId = seatRes.body.id;

      logStep('POST', '/reservations (confirm test hold)');
      const holdRes = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId });
      holdId = holdRes.body.id;
    });

    it('should return 200 with status confirmed', async () => {
      logStep('POST', `/reservations/${holdId}/confirm`);
      const res = await request(server)
        .post(`/reservations/${holdId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('POST', `/reservations/${holdId}/confirm`, res.status);

      expect([200, 201]).toContain(res.status);
      expect(res.body).toHaveProperty('status', 'confirmed');
      expect(res.body).toHaveProperty('confirmed_at');
      expect(res.body.confirmed_at).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 5. POST /reservations/:id/cancel -> 200, status=cancelled
  // -----------------------------------------------------------------------
  describe('POST /reservations/:id/cancel - cancel a reservation', () => {
    let holdId: string;

    beforeAll(async () => {
      // Create a fresh seat and hold for this test
      logStep('POST', `/zones/${zoneId}/seats (cancel test seat)`);
      const seatRes = await request(server)
        .post(`/zones/${zoneId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `Seat-Cancel-${UNIQUE}` });
      const seatId = seatRes.body.id;

      logStep('POST', '/reservations (cancel test hold)');
      const holdRes = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId });
      holdId = holdRes.body.id;
    });

    it('should return 200 with status cancelled', async () => {
      logStep('POST', `/reservations/${holdId}/cancel`);
      const res = await request(server)
        .post(`/reservations/${holdId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('POST', `/reservations/${holdId}/cancel`, res.status);

      expect([200, 201]).toContain(res.status);
      expect(res.body).toHaveProperty('status', 'cancelled');
      expect(res.body).toHaveProperty('cancelled_at');
      expect(res.body.cancelled_at).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 6. POST /reservations/:id/confirm on expired hold -> 409
  // -----------------------------------------------------------------------
  describe('POST /reservations/:id/confirm - expired hold', () => {
    let holdId: string;

    beforeAll(async () => {
      // Create a fresh seat and hold
      logStep('POST', `/zones/${zoneId}/seats (expired test seat)`);
      const seatRes = await request(server)
        .post(`/zones/${zoneId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `Seat-Expired-${UNIQUE}` });
      const seatId = seatRes.body.id;

      logStep('POST', '/reservations (expired test hold)');
      const holdRes = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId });
      holdId = holdRes.body.id;

      // Manually set hold_until to the past via direct DB update
      await dataSource.query(
        `UPDATE reservations SET hold_until = NOW() - INTERVAL '1 hour' WHERE id = $1`,
        [holdId],
      );
    });

    it('should return 409 when hold has expired', async () => {
      logStep('POST', `/reservations/${holdId}/confirm (expired)`);
      const res = await request(server)
        .post(`/reservations/${holdId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('POST', `/reservations/${holdId}/confirm`, res.status);

      expect(res.status).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // 7. GET /reservations -> 200, returns list
  // -----------------------------------------------------------------------
  describe('GET /reservations - list all', () => {
    it('should return 200 with an array of reservations', async () => {
      logStep('GET', '/reservations');
      const res = await request(server)
        .get('/reservations')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/reservations', res.status);

      expect([200, 201]).toContain(res.status);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 8. GET /reservations?seatId=... -> 200, filtered
  // -----------------------------------------------------------------------
  describe('GET /reservations?seatId=... - filtered by seat', () => {
    it('should return 200 with reservations filtered by seatId', async () => {
      logStep('GET', `/reservations?seatId=${availableSeatId}`);
      const res = await request(server)
        .get(`/reservations?seatId=${availableSeatId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/reservations?seatId=${availableSeatId}`, res.status);

      expect([200, 201]).toContain(res.status);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      for (const reservation of res.body) {
        expect(reservation.seat_id).toBe(availableSeatId);
      }
    });

    it('should return 200 with empty array for unknown seatId', async () => {
      const fakeSeatId = '00000000-0000-0000-0000-000000000000';
      logStep('GET', `/reservations?seatId=${fakeSeatId}`);
      const res = await request(server)
        .get(`/reservations?seatId=${fakeSeatId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/reservations?seatId=${fakeSeatId}`, res.status);

      expect([200, 201]).toContain(res.status);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 9. POST /reservations/:id/confirm on cancelled reservation -> 409
  // -----------------------------------------------------------------------
  describe('POST /reservations/:id/confirm - cancelled reservation', () => {
    let holdId: string;

    beforeAll(async () => {
      // Create a fresh seat, hold, then cancel it
      logStep('POST', `/zones/${zoneId}/seats (cancelled-confirm test seat)`);
      const seatRes = await request(server)
        .post(`/zones/${zoneId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `Seat-CancelConfirm-${UNIQUE}` });
      const seatId = seatRes.body.id;

      logStep('POST', '/reservations (cancelled-confirm test hold)');
      const holdRes = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seatId });
      holdId = holdRes.body.id;

      // Cancel the reservation
      logStep('POST', `/reservations/${holdId}/cancel (setup)`);
      await request(server)
        .post(`/reservations/${holdId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);
    });

    it('should return 409 when trying to confirm a cancelled reservation', async () => {
      logStep('POST', `/reservations/${holdId}/confirm (after cancel)`);
      const res = await request(server)
        .post(`/reservations/${holdId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('POST', `/reservations/${holdId}/confirm`, res.status);

      expect(res.status).toBe(409);
    });
  });
});
