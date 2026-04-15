/// <reference types="jest" />
import 'reflect-metadata';
import { HealthController } from '../src/health.controller';

function makeHost(dbBehavior: 'ok' | 'fail') {
  return {
    query: jest.fn(async () => {
      if (dbBehavior === 'ok') return [{ '?column?': 1 }];
      throw new Error('connection refused');
    }),
  } as any;
}

describe('HealthController', () => {
  it('returns status=ok + database=connected when SELECT 1 succeeds', async () => {
    const ctrl = new HealthController(makeHost('ok'));
    const result = await ctrl.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(typeof result.timestamp).toBe('string');
    // ISO-8601 shape.
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns status=degraded + database=disconnected when SELECT 1 throws', async () => {
    const ctrl = new HealthController(makeHost('fail'));
    const result = await ctrl.check();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
    expect(typeof result.timestamp).toBe('string');
  });
});
