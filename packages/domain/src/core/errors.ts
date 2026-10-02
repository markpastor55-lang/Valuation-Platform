/** Machine-readable error codes raised by the domain layer. */
export type DomainErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_DATE'
  | 'INVALID_UNIT'
  | 'UNKNOWN_FORMULA'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'FORBIDDEN'
  | 'SEPARATION_OF_DUTIES'
  | 'HUMAN_ACTOR_REQUIRED'
  | 'MFA_REQUIRED'
  | 'INVALID_TRANSITION'
  | 'GUARD_FAILED'
  | 'RECORD_LOCKED'
  | 'IMMUTABLE_RECORD'
  | 'AI_INFERENCE_PROHIBITED'
  | 'CALIBRATION_INVALID'
  | 'GEOMETRY_INVALID'
  | 'TEMPLATE_NOT_APPROVED'
  | 'NOT_FOUND'
  | 'CONFLICT';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(
  condition: unknown,
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): asserts condition {
  if (!condition) throw new DomainError(code, message, details);
}
