process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks';

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';

const U = Date.now();

function logStep(m: string, p: string, s?: number) {
  console.log(s !== undefined ? `  ← ${s}` : `  → ${m} ${p}`);
}

async function login(srv: any, u: string, p: string) {
  const r = await request(srv).post('/auth/login').send({ username: u, password: p });
  return r.body.accessToken;
}

describe('Questions API', () => {
  let app: INestApplication;
  let server: any;
  let token: string;
  let objQuestionId: string;
  let subjQuestionId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    server = app.getHttpServer();
    token = await login(server, 'admin', 'Admin1234!');
  }, 30000);

  afterAll(async () => { await app.close(); });

  it('POST /questions → 201 objective', async () => {
    logStep('POST', '/questions (objective)');
    const res = await request(server).post('/questions').set('Authorization', `Bearer ${token}`)
      .send({
        type: 'objective',
        body: `What is 5+5? ${U}`,
        options: [
          { body: '8', isCorrect: false },
          { body: '10', isCorrect: true },
          { body: '12', isCorrect: false },
        ],
      });
    logStep('POST', '/questions', res.status);
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('objective');
    expect(res.body.options).toHaveLength(3);
    objQuestionId = res.body.id;
  });

  it('POST /questions → 201 subjective', async () => {
    logStep('POST', '/questions (subjective)');
    const res = await request(server).post('/questions').set('Authorization', `Bearer ${token}`)
      .send({ type: 'subjective', body: `Explain gravity ${U}` });
    logStep('POST', '/questions', res.status);
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('subjective');
    subjQuestionId = res.body.id;
  });

  it('GET /questions → 200 returns the created questions', async () => {
    logStep('GET', '/questions');
    const res = await request(server).get('/questions').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/questions', res.status);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map((q: any) => q.id);
    expect(ids).toEqual(expect.arrayContaining([objQuestionId, subjQuestionId]));
  });

  it('GET /questions?type=objective → 200 filtered', async () => {
    logStep('GET', '/questions?type=objective');
    const res = await request(server).get('/questions?type=objective').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/questions', res.status);
    expect(res.status).toBe(200);
    expect(res.body.every((q: any) => q.type === 'objective')).toBe(true);
  });

  it('GET /questions/:id → 200', async () => {
    logStep('GET', `/questions/${objQuestionId}`);
    const res = await request(server).get(`/questions/${objQuestionId}`).set('Authorization', `Bearer ${token}`);
    logStep('GET', 'question', res.status);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(objQuestionId);
    expect(res.body.type).toBe('objective');
  });

  it('PATCH /questions/:id → 200 with updated body', async () => {
    logStep('PATCH', `/questions/${subjQuestionId}`);
    const res = await request(server).patch(`/questions/${subjQuestionId}`).set('Authorization', `Bearer ${token}`)
      .send({ body: `Updated: Explain gravity ${U}` });
    logStep('PATCH', 'question', res.status);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(subjQuestionId);
    expect(res.body.body).toBe(`Updated: Explain gravity ${U}`);
  });

  it('POST /questions/:id/approve → 201, status=approved', async () => {
    logStep('POST', `/questions/${objQuestionId}/approve`);
    const res = await request(server).post(`/questions/${objQuestionId}/approve`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'approve', res.status);
    // @Post with no @HttpCode → NestJS default 201.
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(objQuestionId);
    expect(res.body.status).toBe('approved');
  });

  it('POST /questions/:id/reject → 201, status=rejected', async () => {
    logStep('POST', `/questions/${subjQuestionId}/reject`);
    const res = await request(server).post(`/questions/${subjQuestionId}/reject`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'reject', res.status);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(subjQuestionId);
    expect(res.body.status).toBe('rejected');
  });

  it('POST /questions/:id/explanations → 201 v1', async () => {
    logStep('POST', `/questions/${objQuestionId}/explanations`);
    const res = await request(server).post(`/questions/${objQuestionId}/explanations`).set('Authorization', `Bearer ${token}`)
      .send({ body: 'Because 5+5=10 by arithmetic.' });
    logStep('POST', 'explanation', res.status);
    expect(res.status).toBe(201);
    expect(res.body.version_number).toBe(1);
  });

  it('POST /questions/:id/explanations → 201 v2', async () => {
    logStep('POST', `/questions/${objQuestionId}/explanations`);
    const res = await request(server).post(`/questions/${objQuestionId}/explanations`).set('Authorization', `Bearer ${token}`)
      .send({ body: 'Updated explanation: 5+5=10.' });
    logStep('POST', 'explanation', res.status);
    expect(res.status).toBe(201);
    expect(res.body.version_number).toBe(2);
  });

  it('GET /questions/:id/explanations → 200', async () => {
    logStep('GET', `/questions/${objQuestionId}/explanations`);
    const res = await request(server).get(`/questions/${objQuestionId}/explanations`).set('Authorization', `Bearer ${token}`);
    logStep('GET', 'explanations', res.status);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const versions = res.body.map((e: any) => e.version_number).sort();
    expect(versions).toEqual(expect.arrayContaining([1, 2]));
  });

  it('POST /questions/import → 201, count matches input', async () => {
    logStep('POST', '/questions/import');
    const res = await request(server).post('/questions/import').set('Authorization', `Bearer ${token}`)
      .send({
        questions: [
          { type: 'objective', body: `Import Q1 ${U}`, options: [{ body: 'A', isCorrect: true }, { body: 'B', isCorrect: false }] },
          { type: 'subjective', body: `Import Q2 ${U}` },
        ],
      });
    logStep('POST', '/questions/import', res.status);
    // @Post with no @HttpCode → NestJS default 201.
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
  });

  it('GET /questions/export → 200 CSV', async () => {
    logStep('GET', '/questions/export');
    const res = await request(server).get('/questions/export').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/questions/export', res.status);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('id,');
  });

  it('GET /questions/:id/wrong-answer-stats → 200', async () => {
    logStep('GET', `/questions/${objQuestionId}/wrong-answer-stats`);
    const res = await request(server).get(`/questions/${objQuestionId}/wrong-answer-stats`).set('Authorization', `Bearer ${token}`);
    logStep('GET', 'wrong-answer-stats', res.status);
    expect(res.status).toBe(200);
  });

  it('DELETE /questions/:id → 200', async () => {
    logStep('DELETE', `/questions/${subjQuestionId}`);
    const res = await request(server).delete(`/questions/${subjQuestionId}`).set('Authorization', `Bearer ${token}`);
    logStep('DELETE', 'question', res.status);
    // @Delete with no @HttpCode → NestJS default 200.
    expect(res.status).toBe(200);
  });
});
