/// <reference types="jest" />
import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

function makeHost(request: any = {}) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  };
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  it('maps HttpException with object response + r.code + r.message verbatim', async () => {
    const { host, status, json } = makeHost({ traceId: 't-1' });
    const exc = new HttpException(
      { code: 'CUSTOM_CODE', message: 'boom' },
      HttpStatus.CONFLICT,
    );
    filter.catch(exc, host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      code: 'CUSTOM_CODE',
      message: 'boom',
      traceId: 't-1',
    });
  });

  it('uses statusToCode fallback when object response omits code', async () => {
    const { host, json } = makeHost({ traceId: 't-2' });
    const exc = new HttpException({ message: 'x' }, HttpStatus.BAD_REQUEST);
    filter.catch(exc, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }),
    );
  });

  it('joins array message into a single string', async () => {
    const { host, json } = makeHost({ traceId: 't-3' });
    const exc = new HttpException(
      { message: ['field a invalid', 'field b invalid'] },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exc, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'field a invalid; field b invalid' }),
    );
  });

  it('handles HttpException with string response (falls through to exception.message)', async () => {
    const { host, json } = makeHost({ traceId: 't-4' });
    // Passing a plain string as the response coerces the non-object branch.
    const exc = new HttpException('raw string response', HttpStatus.FORBIDDEN);
    filter.catch(exc, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'raw string response',
      }),
    );
  });

  it('handles non-HttpException (unknown throw) → 500 / INTERNAL_ERROR', async () => {
    const { host, status, json } = makeHost({ traceId: 't-5' });
    filter.catch(new Error('kaboom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      traceId: 't-5',
    });
  });

  it('defaults traceId to "unknown" when request carries none', async () => {
    const { host, json } = makeHost({}); // no traceId
    filter.catch(new NotFoundException('nope'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'unknown', statusCode: 404, code: 'NOT_FOUND' }),
    );
  });

  it('statusToCode mapping covers 401/403/404/409 and defaults to INTERNAL_ERROR', () => {
    // Reach all branches via the per-status exception constructors so the
    // private switch expression sees each arm.
    const check = (exc: HttpException, expected: string) => {
      const { host, json } = makeHost({ traceId: 't' });
      filter.catch(exc, host);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ code: expected }),
      );
    };
    // String-response variant forces the fallback statusToCode path.
    check(new BadRequestException('bad'), 'VALIDATION_ERROR');
    check(new UnauthorizedException('u'), 'UNAUTHORIZED');
    check(new ForbiddenException('f'), 'FORBIDDEN');
    check(new NotFoundException('nf'), 'NOT_FOUND');
    check(new ConflictException('cf'), 'CONFLICT');
    check(
      new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT),
      'INTERNAL_ERROR',
    );
  });
});
