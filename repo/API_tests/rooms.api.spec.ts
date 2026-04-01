/**
 * ProctorWorks Rooms, Zones, Seats & Seat-Map Versioning API Integration Tests
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

describe('Rooms, Zones, Seats & Versioning API', () => {
  let app: INestApplication;
  let server: any;
  let adminToken: string;

  // IDs captured across tests
  let roomId: string;
  let zoneId: string;
  let seatId: string;

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
  // 1. POST /rooms -> 201, creates room
  // -----------------------------------------------------------------------
  describe('POST /rooms', () => {
    it('should return 201 and create a study room', async () => {
      const roomName = `Test Room ${UNIQUE}`;

      logStep('POST', '/rooms');
      const res = await request(server)
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: roomName });
      logStep('POST', '/rooms', res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', roomName);

      roomId = res.body.id;
    });
  });

  // -----------------------------------------------------------------------
  // 2. GET /rooms -> 200, returns list with created room
  // -----------------------------------------------------------------------
  describe('GET /rooms', () => {
    it('should return 200 with a list containing the created room', async () => {
      logStep('GET', '/rooms');
      const res = await request(server)
        .get('/rooms')
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', '/rooms', res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const found = res.body.find((r: any) => r.id === roomId);
      expect(found).toBeDefined();
      expect(found.name).toBe(`Test Room ${UNIQUE}`);
    });
  });

  // -----------------------------------------------------------------------
  // 3. GET /rooms/:id -> 200, returns single room
  // -----------------------------------------------------------------------
  describe('GET /rooms/:id', () => {
    it('should return 200 with the room details', async () => {
      logStep('GET', `/rooms/${roomId}`);
      const res = await request(server)
        .get(`/rooms/${roomId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/rooms/${roomId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', roomId);
      expect(res.body).toHaveProperty('name', `Test Room ${UNIQUE}`);
      expect(res.body).toHaveProperty('zones');
      expect(Array.isArray(res.body.zones)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. PATCH /rooms/:id -> 200, updates room name
  // -----------------------------------------------------------------------
  describe('PATCH /rooms/:id', () => {
    it('should return 200 and update the room name', async () => {
      const updatedName = `Updated Room ${UNIQUE}`;

      logStep('PATCH', `/rooms/${roomId}`);
      const res = await request(server)
        .patch(`/rooms/${roomId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: updatedName });
      logStep('PATCH', `/rooms/${roomId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', roomId);
      expect(res.body).toHaveProperty('name', updatedName);
    });
  });

  // -----------------------------------------------------------------------
  // 5. POST /rooms/:id/zones -> 201, creates zone in room
  // -----------------------------------------------------------------------
  describe('POST /rooms/:id/zones', () => {
    it('should return 201 and create a zone in the room', async () => {
      const zoneName = `Zone Alpha ${UNIQUE}`;

      logStep('POST', `/rooms/${roomId}/zones`);
      const res = await request(server)
        .post(`/rooms/${roomId}/zones`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: zoneName });
      logStep('POST', `/rooms/${roomId}/zones`, res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', zoneName);
      expect(res.body).toHaveProperty('room_id', roomId);

      zoneId = res.body.id;
    });
  });

  // -----------------------------------------------------------------------
  // 6. GET /rooms/:id/zones -> 200, lists zones
  // -----------------------------------------------------------------------
  describe('GET /rooms/:id/zones', () => {
    it('should return 200 with zones for the room', async () => {
      logStep('GET', `/rooms/${roomId}/zones`);
      const res = await request(server)
        .get(`/rooms/${roomId}/zones`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/rooms/${roomId}/zones`, res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const found = res.body.find((z: any) => z.id === zoneId);
      expect(found).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 7. POST /zones/:id/seats -> 201, creates seat with attributes
  // -----------------------------------------------------------------------
  describe('POST /zones/:id/seats', () => {
    it('should return 201 and create a seat with powerOutlet, quietZone, adaAccessible', async () => {
      logStep('POST', `/zones/${zoneId}/seats`);
      const res = await request(server)
        .post(`/zones/${zoneId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: `Seat-A1-${UNIQUE}`,
          powerOutlet: true,
          quietZone: true,
          adaAccessible: true,
        });
      logStep('POST', `/zones/${zoneId}/seats`, res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('label', `Seat-A1-${UNIQUE}`);
      expect(res.body).toHaveProperty('power_outlet', true);
      expect(res.body).toHaveProperty('quiet_zone', true);
      expect(res.body).toHaveProperty('ada_accessible', true);
      expect(res.body).toHaveProperty('status', 'available');

      seatId = res.body.id;
    });
  });

  // -----------------------------------------------------------------------
  // 8. GET /zones/:id/seats -> 200, lists seats
  // -----------------------------------------------------------------------
  describe('GET /zones/:id/seats', () => {
    it('should return 200 with seats for the zone', async () => {
      logStep('GET', `/zones/${zoneId}/seats`);
      const res = await request(server)
        .get(`/zones/${zoneId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/zones/${zoneId}/seats`, res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const found = res.body.find((s: any) => s.id === seatId);
      expect(found).toBeDefined();
      expect(found.label).toBe(`Seat-A1-${UNIQUE}`);
    });
  });

  // -----------------------------------------------------------------------
  // 9. PATCH /seats/:id -> 200, updates seat status to maintenance
  // -----------------------------------------------------------------------
  describe('PATCH /seats/:id', () => {
    it('should return 200 and update the seat status to maintenance', async () => {
      logStep('PATCH', `/seats/${seatId}`);
      const res = await request(server)
        .patch(`/seats/${seatId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'maintenance' });
      logStep('PATCH', `/seats/${seatId}`, res.status);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', seatId);
      expect(res.body).toHaveProperty('status', 'maintenance');
    });
  });

  // -----------------------------------------------------------------------
  // 10. POST /rooms/:id/publish with changeNote < 20 chars -> 400
  // -----------------------------------------------------------------------
  describe('POST /rooms/:id/publish — validation', () => {
    it('should return 400 when changeNote is shorter than 20 characters', async () => {
      logStep('POST', `/rooms/${roomId}/publish`);
      const res = await request(server)
        .post(`/rooms/${roomId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ changeNote: 'Too short' });
      logStep('POST', `/rooms/${roomId}/publish`, res.status);

      expect(res.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // 11. POST /rooms/:id/publish with changeNote 20-500 chars -> 201
  // -----------------------------------------------------------------------
  describe('POST /rooms/:id/publish — valid', () => {
    it('should return 201 and create an immutable version snapshot', async () => {
      const changeNote = 'Initial seat-map publish for integration test run';

      logStep('POST', `/rooms/${roomId}/publish`);
      const res = await request(server)
        .post(`/rooms/${roomId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ changeNote });
      logStep('POST', `/rooms/${roomId}/publish`, res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('room_id', roomId);
      expect(res.body).toHaveProperty('version_number', 1);
      expect(res.body).toHaveProperty('change_note', changeNote);
      expect(res.body).toHaveProperty('snapshot');
      expect(res.body.snapshot).toHaveProperty('room');
      expect(res.body.snapshot).toHaveProperty('zones');
    });
  });

  // -----------------------------------------------------------------------
  // 12. POST /rooms/:id/publish again -> 201, version_number increments
  // -----------------------------------------------------------------------
  describe('POST /rooms/:id/publish — version increment', () => {
    it('should return 201 with version_number incremented to 2', async () => {
      const changeNote = 'Second publish to verify version auto-increment works';

      logStep('POST', `/rooms/${roomId}/publish`);
      const res = await request(server)
        .post(`/rooms/${roomId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ changeNote });
      logStep('POST', `/rooms/${roomId}/publish`, res.status);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('version_number', 2);
    });
  });

  // -----------------------------------------------------------------------
  // 13. GET /rooms/:id/versions -> 200, version history ordered desc
  // -----------------------------------------------------------------------
  describe('GET /rooms/:id/versions', () => {
    it('should return 200 with version history ordered by version_number desc', async () => {
      logStep('GET', `/rooms/${roomId}/versions`);
      const res = await request(server)
        .get(`/rooms/${roomId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/rooms/${roomId}/versions`, res.status);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      // Verify descending order by version_number
      const versions = res.body.map((v: any) => v.version_number);
      for (let i = 0; i < versions.length - 1; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i + 1]);
      }

      // Most recent version should be version 2
      expect(res.body[0]).toHaveProperty('version_number', 2);
      expect(res.body[1]).toHaveProperty('version_number', 1);
    });
  });

  // -----------------------------------------------------------------------
  // 14. DELETE /seats/:id -> 200
  // -----------------------------------------------------------------------
  describe('DELETE /seats/:id', () => {
    it('should return 200 and delete the seat', async () => {
      logStep('DELETE', `/seats/${seatId}`);
      const res = await request(server)
        .delete(`/seats/${seatId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('DELETE', `/seats/${seatId}`, res.status);

      expect(res.status).toBe(200);

      // Confirm the seat is gone
      logStep('GET', `/zones/${zoneId}/seats`);
      const listRes = await request(server)
        .get(`/zones/${zoneId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/zones/${zoneId}/seats`, listRes.status);

      const found = listRes.body.find((s: any) => s.id === seatId);
      expect(found).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 15. DELETE /rooms/:id -> 200
  // -----------------------------------------------------------------------
  describe('DELETE /rooms/:id', () => {
    it('should return 200 and delete the room', async () => {
      logStep('DELETE', `/rooms/${roomId}`);
      const res = await request(server)
        .delete(`/rooms/${roomId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('DELETE', `/rooms/${roomId}`, res.status);

      expect(res.status).toBe(200);

      // Confirm the room is gone
      logStep('GET', `/rooms/${roomId}`);
      const getRes = await request(server)
        .get(`/rooms/${roomId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      logStep('GET', `/rooms/${roomId}`, getRes.status);

      expect(getRes.status).toBe(404);
    });
  });
});
