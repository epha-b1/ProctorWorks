/// <reference types="jest" />
import 'reflect-metadata';
import { of } from 'rxjs';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';

function makeExecutionContext(opts: {
  requiredRoles?: string[] | undefined;
  user?: any;
  method?: string;
  url?: string;
  traceId?: string | undefined;
  statusCode?: number;
}): any {
  const request: any = {
    user: opts.user,
    method: opts.method ?? 'GET',
    url: opts.url ?? '/x',
  };
  if (opts.traceId !== undefined) {
    request.traceId = opts.traceId;
  }
  const response = { statusCode: opts.statusCode ?? 200 };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => () => {},
    getClass: () => class Dummy {},
  };
}

describe('RolesGuard', () => {
  const makeGuard = (roles: string[] | undefined) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) };
    return new RolesGuard(reflector as any);
  };

  it('no @Roles metadata → allow', () => {
    const guard = makeGuard(undefined);
    expect(
      guard.canActivate(
        makeExecutionContext({ user: { role: 'auditor' } }),
      ),
    ).toBe(true);
  });

  it('empty required list → allow (explicit open endpoint)', () => {
    const guard = makeGuard([]);
    expect(
      guard.canActivate(
        makeExecutionContext({ user: { role: 'auditor' } }),
      ),
    ).toBe(true);
  });

  it('no user on request → deny', () => {
    const guard = makeGuard(['platform_admin']);
    expect(
      guard.canActivate(makeExecutionContext({ user: undefined })),
    ).toBe(false);
  });

  it('role not in required list → deny', () => {
    const guard = makeGuard(['platform_admin']);
    expect(
      guard.canActivate(makeExecutionContext({ user: { role: 'auditor' } })),
    ).toBe(false);
  });

  it('role in required list → allow', () => {
    const guard = makeGuard(['platform_admin', 'store_admin']);
    expect(
      guard.canActivate(makeExecutionContext({ user: { role: 'store_admin' } })),
    ).toBe(true);
  });
});

describe('LoggingInterceptor', () => {
  it('logs method/url/status with traceId=unknown when no trace header present', async () => {
    const interceptor = new LoggingInterceptor();
    const logSpy = jest
      .spyOn((interceptor as any).logger, 'log')
      .mockImplementation(() => {});
    const ctx = makeExecutionContext({
      method: 'POST',
      url: '/foo',
      statusCode: 201,
    });
    const handler = { handle: () => of('ok') } as any;
    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, handler).subscribe({ complete: () => resolve() });
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(String(line));
    expect(parsed.method).toBe('POST');
    expect(parsed.url).toBe('/foo');
    expect(parsed.statusCode).toBe(201);
    expect(parsed.traceId).toBe('unknown');
    expect(parsed.duration).toMatch(/^\d+ms$/);
  });

  it('logs the trace id when one is attached to the request', async () => {
    const interceptor = new LoggingInterceptor();
    const logSpy = jest
      .spyOn((interceptor as any).logger, 'log')
      .mockImplementation(() => {});
    const ctx = makeExecutionContext({ traceId: 'abc-123' });
    const handler = { handle: () => of('ok') } as any;
    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, handler).subscribe({ complete: () => resolve() });
    });
    const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
    expect(parsed.traceId).toBe('abc-123');
  });
});
