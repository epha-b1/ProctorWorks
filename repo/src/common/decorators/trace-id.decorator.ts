import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Pulls the current request's trace ID, set by TraceIdInterceptor.
 *
 * Use this as the consistent propagation mechanism for handing the
 * trace ID into AuditService.log(...) calls. Centralizing the lookup
 * in one decorator (instead of letting each handler dig into Req)
 * keeps the wiring uniform across modules and removes the per-call
 * boilerplate that the F-07 audit finding flagged.
 */
export const TraceId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request?.traceId;
  },
);
