import type { Actor } from '../core/actor.js';
import type { Instant, LocalDate } from '../core/dates.js';
import { isLocalDate } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import { sha256Hex } from '../core/hash.js';
import type { InspectionScope } from '../config/codes.js';

export interface ValuerIdentity {
  readonly userId: string;
  readonly fullName: string;
  /** Professional memberships and designations as held, e.g. "AAPI", "CPV". */
  readonly credentials: readonly string[];
  /** Statutory registration where the jurisdiction requires it. [REVIEW: API_STANDARDS] */
  readonly registration?: { readonly jurisdiction: string; readonly number: string };
}

/** Template-driven certification content (brief §7). Clause wording comes from approved clause versions. */
export interface CertificationContent {
  readonly jobId: string;
  readonly valuer: ValuerIdentity;
  readonly role: 'responsible_valuer' | 'co_signatory';
  readonly inspectionScope: InspectionScope;
  readonly inspectionScopeStatement: string;
  readonly valuationDate: LocalDate;
  readonly basisOfValue: string;
  readonly amount: {
    readonly value: number;
    readonly currency: 'AUD';
    readonly kind: 'value' | 'market_rent' | 'sum_insured';
  };
  readonly independenceStatement: string;
  readonly conflictsStatement: string;
  readonly assumptions: readonly string[];
  readonly specialAssumptions: readonly string[];
  readonly limitations: readonly string[];
  readonly standardsReliedOn: readonly string[];
  readonly clauseVersionIds: readonly string[];
}

export interface Certification extends CertificationContent {
  readonly id: string;
  readonly signedAt: Instant;
  /** Hash of the job snapshot that was certified: later edits invalidate the certification. */
  readonly snapshotHash: string;
  readonly signature: {
    readonly method: 'typed_attestation' | 'e_signature';
    readonly attestationText: string;
    readonly attestationHash: string;
    readonly providerRef?: string;
  };
}

export function certificationContentIssues(c: CertificationContent): string[] {
  const issues: string[] = [];
  const req = (ok: boolean, msg: string) => {
    if (!ok) issues.push(msg);
  };
  req(c.valuer.fullName.trim().length > 0, 'valuer name is required');
  req(c.valuer.credentials.length > 0, 'valuer credentials are required');
  req(c.inspectionScopeStatement.trim().length > 0, 'inspection scope statement is required');
  req(isLocalDate(c.valuationDate), 'valuation date must be a calendar date');
  req(c.basisOfValue.trim().length > 0, 'basis of value is required');
  req(Number.isFinite(c.amount.value) && c.amount.value > 0, 'certified amount must be positive');
  req(c.independenceStatement.trim().length > 0, 'independence statement is required');
  req(c.conflictsStatement.trim().length > 0, 'conflicts statement is required');
  req(c.limitations.length > 0, 'limitations must be stated');
  req(c.standardsReliedOn.length > 0, 'standards relied on must be stated');
  req(
    c.clauseVersionIds.length > 0,
    'certification clauses must come from approved clause versions',
  );
  return issues;
}

/**
 * Records the responsible valuer's signature. Software and AI can never sign: the actor must be
 * a human, MFA-verified, and the job's responsible valuer.
 */
export function signCertification(
  content: CertificationContent,
  params: {
    id: string;
    actor: Actor;
    responsibleValuerId: string;
    snapshotHash: string;
    at: Instant;
    attestationText: string;
    method?: 'typed_attestation' | 'e_signature';
    providerRef?: string;
  },
): Certification {
  const { actor } = params;
  if (actor.kind !== 'human')
    throw new DomainError('HUMAN_ACTOR_REQUIRED', 'only a person can sign a certification');
  if (actor.mfaVerified !== true)
    throw new DomainError('MFA_REQUIRED', 'signing requires multi-factor authentication');
  if (actor.userId !== params.responsibleValuerId || content.valuer.userId !== actor.userId) {
    throw new DomainError(
      'SEPARATION_OF_DUTIES',
      'only the responsible valuer can sign their certification',
    );
  }
  const issues = certificationContentIssues(content);
  if (issues.length)
    throw new DomainError('GUARD_FAILED', 'certification is incomplete', { issues });
  if (params.attestationText.trim().length < 20) {
    throw new DomainError('INVALID_ARGUMENT', 'an attestation statement is required');
  }
  return {
    ...content,
    id: params.id,
    signedAt: params.at,
    snapshotHash: params.snapshotHash,
    signature: {
      method: params.method ?? 'typed_attestation',
      attestationText: params.attestationText,
      attestationHash: sha256Hex(
        `${actor.userId}\n${params.snapshotHash}\n${params.attestationText}`,
      ),
      ...(params.providerRef ? { providerRef: params.providerRef } : {}),
    },
  };
}
