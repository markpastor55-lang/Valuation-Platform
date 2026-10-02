import type { Role } from '../auth/roles.js';

/**
 * Who is performing an action. Only `human` actors may make professional decisions
 * (certify, approve, accept AI suggestions, issue). `system` covers scheduled jobs and
 * integrations; `ai` covers model-generated suggestions.
 */
export interface Actor {
  readonly kind: 'human' | 'system' | 'ai';
  readonly userId: string;
  readonly orgId: string;
  readonly roles: readonly Role[];
  /** True when the session completed multi-factor authentication. */
  readonly mfaVerified?: boolean;
  readonly displayName?: string;
}

export const isHuman = (actor: Actor): boolean => actor.kind === 'human';
