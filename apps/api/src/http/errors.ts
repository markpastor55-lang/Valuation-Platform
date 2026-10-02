import { DomainError, type DomainErrorCode } from '@vp/domain';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A 403 whose denial is recorded in the security audit stream once the request's transaction has ended. */
export class AuthorizationDenied extends HttpError {
  constructor(
    readonly denial: {
      readonly userId: string;
      readonly orgId: string;
      readonly kind: 'human' | 'system' | 'ai';
      readonly roles: readonly string[];
      readonly permission: string;
      readonly entityType: string;
      readonly entityId: string;
    },
    code: string,
    message: string,
  ) {
    super(403, code, message);
    this.name = 'AuthorizationDenied';
  }
}

export const notFound = (what: string): HttpError =>
  new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (code: string, message: string): HttpError =>
  new HttpError(403, code, message);
export const unauthenticated = (message = 'authentication required'): HttpError =>
  new HttpError(401, 'UNAUTHENTICATED', message);

const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  INVALID_ARGUMENT: 422,
  INVALID_DATE: 422,
  INVALID_UNIT: 422,
  UNKNOWN_FORMULA: 422,
  OVERRIDE_REASON_REQUIRED: 422,
  CALIBRATION_INVALID: 422,
  GEOMETRY_INVALID: 422,
  AI_INFERENCE_PROHIBITED: 422,
  FORBIDDEN: 403,
  SEPARATION_OF_DUTIES: 403,
  HUMAN_ACTOR_REQUIRED: 403,
  MFA_REQUIRED: 403,
  INVALID_TRANSITION: 409,
  GUARD_FAILED: 409,
  RECORD_LOCKED: 409,
  IMMUTABLE_RECORD: 409,
  TEMPLATE_NOT_APPROVED: 409,
  CONFLICT: 409,
  NOT_FOUND: 404,
};

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

/** Maps any thrown error to an HTTP status and a stable error body (no stack traces or SQL). */
export function toHttpError(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof HttpError) {
    return {
      status: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
    };
  }
  if (err instanceof DomainError) {
    return {
      status: DOMAIN_STATUS[err.code],
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
    };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'BAD_REQUEST',
          message: 'request validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
    };
  }
  const pgCode = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
  if (pgCode === 'P0001') {
    return {
      status: 409,
      body: { error: { code: 'IMMUTABLE_RECORD', message: (err as Error).message } },
    };
  }
  if (pgCode === '23505')
    return { status: 409, body: { error: { code: 'CONFLICT', message: 'duplicate record' } } };
  if (pgCode === '23503')
    return {
      status: 422,
      body: { error: { code: 'INVALID_REFERENCE', message: 'referenced record does not exist' } },
    };
  const fastifyStatus =
    typeof err === 'object' && err !== null && 'statusCode' in err ? err.statusCode : undefined;
  if (typeof fastifyStatus === 'number' && fastifyStatus >= 400 && fastifyStatus < 500) {
    return {
      status: fastifyStatus,
      body: { error: { code: 'BAD_REQUEST', message: (err as Error).message } },
    };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'internal error' } } };
}
