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

describe('Assessments API', () => {
  let app: INestApplication;
  let server: any;
  let token: string;
  let q1Id: string;
  let q2Id: string;
  let q1CorrectOptId: string;
  let q1WrongOptId: string;
  let q2CorrectOptId: string;
  let paperId: string;
  let attemptId: string;
  let redoId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    server = app.getHttpServer();
    token = await login(server, 'admin', 'Admin1234!');

    // Create 2 objective questions and approve them
    const r1 = await request(server).post('/questions').set('Authorization', `Bearer ${token}`)
      .send({ type: 'objective', body: `Assess Q1 ${U}`, options: [{ body: 'Wrong', isCorrect: false }, { body: 'Right', isCorrect: true }] });
    q1Id = r1.body.id;
    q1CorrectOptId = r1.body.options.find((o: any) => o.is_correct).id;
    q1WrongOptId = r1.body.options.find((o: any) => !o.is_correct).id;
    await request(server).post(`/questions/${q1Id}/approve`).set('Authorization', `Bearer ${token}`);

    const r2 = await request(server).post('/questions').set('Authorization', `Bearer ${token}`)
      .send({ type: 'objective', body: `Assess Q2 ${U}`, options: [{ body: 'No', isCorrect: false }, { body: 'Yes', isCorrect: true }] });
    q2Id = r2.body.id;
    q2CorrectOptId = r2.body.options.find((o: any) => o.is_correct).id;
    await request(server).post(`/questions/${q2Id}/approve`).set('Authorization', `Bearer ${token}`);
  }, 30000);

  afterAll(async () => { await app.close(); });

  it('POST /papers → 201', async () => {
    logStep('POST', '/papers');
    const res = await request(server).post('/papers').set('Authorization', `Bearer ${token}`)
      .send({ name: `Test Paper ${U}`, generationRule: { type: 'random', count: 2 } });
    logStep('POST', '/papers', res.status);
    expect(res.status).toBe(201);
    expect(res.body.paper_questions).toHaveLength(2);
    paperId = res.body.id;
  });

  it('GET /papers → 200', async () => {
    logStep('GET', '/papers');
    const res = await request(server).get('/papers').set('Authorization', `Bearer ${token}`);
    logStep('GET', '/papers', res.status);
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === paperId)).toBe(true);
  });

  it('GET /papers/:id → 200 with questions', async () => {
    logStep('GET', `/papers/${paperId}`);
    const res = await request(server).get(`/papers/${paperId}`).set('Authorization', `Bearer ${token}`);
    logStep('GET', 'paper', res.status);
    expect(res.status).toBe(200);
    expect(res.body.paper_questions).toHaveLength(2);
    expect(res.body.paper_questions[0].question).toBeDefined();
  });

  it('POST /attempts → 201', async () => {
    logStep('POST', '/attempts');
    const res = await request(server).post('/attempts').set('Authorization', `Bearer ${token}`)
      .send({ paperId });
    logStep('POST', '/attempts', res.status);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('in_progress');
    attemptId = res.body.id;
  });

  it('POST /attempts/:id/submit → graded, score=100', async () => {
    logStep('POST', `/attempts/${attemptId}/submit`);
    const res = await request(server).post(`/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`)
      .send({
        answers: [
          { questionId: q1Id, selectedOptionId: q1CorrectOptId },
          { questionId: q2Id, selectedOptionId: q2CorrectOptId },
        ],
      });
    logStep('POST', 'submit', res.status);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('graded');
    expect(Number(res.body.score)).toBe(100);
  });

  it('POST /attempts/:id/submit on graded → error', async () => {
    logStep('POST', `/attempts/${attemptId}/submit (already graded)`);
    const res = await request(server).post(`/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ questionId: q1Id, selectedOptionId: q1CorrectOptId }] });
    logStep('POST', 'submit', res.status);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /attempts/:id/redo → 201', async () => {
    logStep('POST', `/attempts/${attemptId}/redo`);
    const res = await request(server).post(`/attempts/${attemptId}/redo`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'redo', res.status);
    expect(res.status).toBe(201);
    expect(res.body.parent_attempt_id).toBe(attemptId);
    expect(res.body.status).toBe('in_progress');
    redoId = res.body.id;
  });

  it('GET /attempts/history → both attempts', async () => {
    logStep('GET', '/attempts/history');
    const res = await request(server).get('/attempts/history').set('Authorization', `Bearer ${token}`);
    logStep('GET', 'history', res.status);
    expect(res.status).toBe(200);
    const ids = res.body.map((a: any) => a.id);
    expect(ids).toContain(attemptId);
    expect(ids).toContain(redoId);
  });

  it('Submit redo with 1 wrong → score=50', async () => {
    logStep('POST', `/attempts/${redoId}/submit (1 wrong)`);
    const res = await request(server).post(`/attempts/${redoId}/submit`).set('Authorization', `Bearer ${token}`)
      .send({
        answers: [
          { questionId: q1Id, selectedOptionId: q1WrongOptId },
          { questionId: q2Id, selectedOptionId: q2CorrectOptId },
        ],
      });
    logStep('POST', 'submit', res.status);
    expect(res.status).toBe(201);
    expect(Number(res.body.score)).toBe(50);
  });

  it('Redo on redo → chain preserved', async () => {
    logStep('POST', `/attempts/${redoId}/redo`);
    const res = await request(server).post(`/attempts/${redoId}/redo`).set('Authorization', `Bearer ${token}`);
    logStep('POST', 'redo2', res.status);
    expect(res.status).toBe(201);
    expect(res.body.parent_attempt_id).toBe(redoId);
  });
});
