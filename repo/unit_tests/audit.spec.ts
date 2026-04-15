/// <reference types="jest" />
import 'reflect-metadata';
import { AuditService } from '../src/audit/audit.service';

function makeQb(rows: any[] = []) {
  const qb: any = {};
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.skip = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getMany = jest.fn().mockResolvedValue(rows);
  qb.getManyAndCount = jest.fn().mockResolvedValue([rows, rows.length]);
  return qb;
}

function makeRepo(rows: any[] = []) {
  const qb = makeQb(rows);
  return {
    create: jest.fn((plain: any) => ({ ...plain })),
    save: jest.fn(async (e: any) => ({ id: 'log-id', created_at: new Date(), ...e })),
    createQueryBuilder: jest.fn(() => qb),
    qb,
  };
}

describe('AuditService.log', () => {
  it('persists with all explicit fields', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo as any);
    await svc.log('actor-1', 'create_order', 'order', 'o-1', { x: 1 }, 'trace-1');
    expect(repo.create).toHaveBeenCalledWith({
      actor_id: 'actor-1',
      action: 'create_order',
      resource_type: 'order',
      resource_id: 'o-1',
      detail: { x: 1 },
      trace_id: 'trace-1',
    });
  });

  it('coerces missing optional fields to null (no undefined leakage)', async () => {
    const repo = makeRepo();
    const svc = new AuditService(repo as any);
    await svc.log(null, 'login');
    expect(repo.create).toHaveBeenCalledWith({
      actor_id: null,
      action: 'login',
      resource_type: null,
      resource_id: null,
      detail: null,
      trace_id: null,
    });
  });
});

describe('AuditService.findAll filtering / pagination', () => {
  it('default page=1 / limit=25 when omitted', async () => {
    const repo = makeRepo([]);
    const svc = new AuditService(repo as any);
    const result = await svc.findAll({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
    expect(repo.qb.skip).toHaveBeenCalledWith(0);
    expect(repo.qb.take).toHaveBeenCalledWith(25);
    expect(repo.qb.orderBy).toHaveBeenCalledWith('log.created_at', 'DESC');
    // No filter andWhere when no filters supplied.
    expect(repo.qb.andWhere).not.toHaveBeenCalled();
  });

  it('page=3 / limit=10 → skip=20 / take=10', async () => {
    const repo = makeRepo([]);
    const svc = new AuditService(repo as any);
    await svc.findAll({ page: 3, limit: 10 });
    expect(repo.qb.skip).toHaveBeenCalledWith(20);
    expect(repo.qb.take).toHaveBeenCalledWith(10);
  });

  it('actorId filter applied', async () => {
    const repo = makeRepo([]);
    const svc = new AuditService(repo as any);
    await svc.findAll({ actorId: 'a-1' });
    expect(repo.qb.andWhere).toHaveBeenCalledWith(
      'log.actor_id = :actorId',
      { actorId: 'a-1' },
    );
  });

  it('action filter applied', async () => {
    const repo = makeRepo([]);
    const svc = new AuditService(repo as any);
    await svc.findAll({ action: 'create_order' });
    expect(repo.qb.andWhere).toHaveBeenCalledWith(
      'log.action = :action',
      { action: 'create_order' },
    );
  });

  it('from / to date filters both applied', async () => {
    const repo = makeRepo([]);
    const svc = new AuditService(repo as any);
    await svc.findAll({ from: '2026-04-01', to: '2026-04-15' });
    expect(repo.qb.andWhere).toHaveBeenCalledWith(
      'log.created_at >= :from',
      { from: '2026-04-01' },
    );
    expect(repo.qb.andWhere).toHaveBeenCalledWith(
      'log.created_at <= :to',
      { to: '2026-04-15' },
    );
  });

  it('returns total + data shape from getManyAndCount', async () => {
    const rows = [
      { id: 'l1' },
      { id: 'l2' },
    ];
    const repo = makeRepo(rows);
    const svc = new AuditService(repo as any);
    const result = await svc.findAll({ page: 1, limit: 100 });
    expect(result).toEqual({ data: rows, total: 2, page: 1, limit: 100 });
  });
});

describe('AuditService.exportCsv', () => {
  function row(over: any = {}) {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      actor_id: 'a-1',
      action: 'create_order',
      resource_type: 'order',
      resource_id: 'o-1',
      detail: { x: 1 },
      trace_id: 't-1',
      created_at: new Date('2026-04-15T12:00:00Z'),
      ...over,
    };
  }

  it('emits the canonical header row + ordered data rows', async () => {
    const repo = makeRepo([row()]);
    const svc = new AuditService(repo as any);
    const csv = await svc.exportCsv();
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'id,actor_id,action,resource_type,resource_id,detail,trace_id,created_at',
    );
    expect(lines[1]).toContain('a-1');
    expect(lines[1]).toContain('create_order');
    expect(lines[1]).toContain('2026-04-15T12:00:00.000Z');
    expect(repo.qb.orderBy).toHaveBeenCalledWith('log.created_at', 'ASC');
  });

  it('masks sensitive detail fields (top-level + nested) and never emits raw secrets', async () => {
    const sensitive = row({
      detail: {
        username: 'normal',
        password_hash: 'super-secret-hash',
        nested: { token: 'oauth-token-123', plain: 42 },
        list: ['leave-as-is'],
      },
    });
    const repo = makeRepo([sensitive]);
    const svc = new AuditService(repo as any);
    const csv = await svc.exportCsv();
    expect(csv).toContain('[REDACTED]');
    expect(csv).not.toContain('super-secret-hash');
    expect(csv).not.toContain('oauth-token-123');
    // Non-sensitive values preserved. The detail JSON is itself the
    // body of a CSV cell, so the inner double-quotes are doubled per
    // RFC 4180 — assert on the doubled-quote forms.
    expect(csv).toContain('""username"":""normal""');
    expect(csv).toContain('""plain"":42');
    // Array values left intact (mask walks objects, not arrays).
    expect(csv).toContain('leave-as-is');
  });

  it('CSV-escapes embedded commas, quotes, and newlines per RFC 4180', async () => {
    const tricky = row({
      action: 'has,comma',
      detail: { note: 'has "double" and\nnewline' },
    });
    const repo = makeRepo([tricky]);
    const svc = new AuditService(repo as any);
    const csv = await svc.exportCsv();
    // Comma in action surfaces wrapped in quotes.
    expect(csv).toMatch(/"has,comma"/);
    // The JSON body containing a `"` is wrapped as a CSV cell, and
    // the `"` inside is doubled. After JSON.stringify the inner
    // quotes are first \"-escaped, then CSV-doubled to \"\"".
    expect(csv).toMatch(/\\""double\\""/);
    // Newline inside the JSON detail surfaces as the JSON-escaped form
    // (backslash-n) — JSON.stringify converts the embedded \n to \\n
    // before the CSV cell is built. Either way, the substring
    // "newline" must reach the output unmolested.
    expect(csv).toContain('newline');
  });

  it('coerces null detail / actor_id / trace_id / resource_* to empty CSV cells (no "null" string)', async () => {
    const blank = row({
      actor_id: null,
      resource_type: null,
      resource_id: null,
      detail: null,
      trace_id: null,
    });
    const repo = makeRepo([blank]);
    const svc = new AuditService(repo as any);
    const csv = await svc.exportCsv();
    const dataLine = csv.split('\n')[1];
    // Six null-or-blank fields should render as adjacent commas, not "null"
    expect(dataLine).not.toContain('null');
  });

  it('passes from / to date filters through to the query when supplied', async () => {
    const repo = makeRepo([]);
    const svc = new AuditService(repo as any);
    await svc.exportCsv('2026-01-01', '2026-12-31');
    expect(repo.qb.andWhere).toHaveBeenCalledWith(
      'log.created_at >= :from',
      { from: '2026-01-01' },
    );
    expect(repo.qb.andWhere).toHaveBeenCalledWith(
      'log.created_at <= :to',
      { to: '2026-12-31' },
    );
  });
});
