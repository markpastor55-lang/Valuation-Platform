import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';

export type FindingSeverity = 'critical' | 'major' | 'minor' | 'observation';
export type FindingStatus = 'open' | 'responded' | 'resolved' | 'accepted' | 'withdrawn';

export interface QaChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly response: 'yes' | 'no' | 'na' | null;
  readonly note?: string;
}

export interface QaFinding {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly category: string;
  readonly description: string;
  /** Field, section or record the finding relates to, e.g. `field:land.area@asset:a1`. */
  readonly ref?: string;
  readonly raisedBy: string;
  readonly raisedAt: Instant;
  readonly status: FindingStatus;
  readonly valuerResponse?: string;
  readonly respondedBy?: string;
  readonly respondedAt?: Instant;
  readonly closedBy?: string;
  readonly closedAt?: Instant;
  readonly closureNote?: string;
}

export interface SelfApprovalException {
  readonly authorisedBy: string;
  readonly reason: string;
  readonly at: Instant;
}

export interface QaReview {
  readonly id: string;
  readonly jobId: string;
  readonly reviewerId: string;
  readonly startedAt: Instant;
  /** Snapshot of the submitted content under review. */
  readonly reviewedSnapshotHash: string;
  readonly checklist: readonly QaChecklistItem[];
  readonly findings: readonly QaFinding[];
  readonly outcome?: 'approved' | 'returned';
  readonly completedAt?: Instant;
  readonly selfApprovalException?: SelfApprovalException;
}

/** Default reviewer checklist; firms configure their own through template administration. */
export const DEFAULT_QA_CHECKLIST: readonly Pick<QaChecklistItem, 'id' | 'label'>[] = [
  {
    id: 'QA-01',
    label:
      'Instructions, intended use and intended users are recorded and consistent with the report',
  },
  {
    id: 'QA-02',
    label: 'Basis of value, interest valued and key dates are appropriate for the purpose',
  },
  { id: 'QA-03', label: 'Inspection scope and its limitations are disclosed' },
  { id: 'QA-04', label: 'Property data has provenance and material facts are verified' },
  { id: 'QA-05', label: 'Evidence is adequate, verified and relevant at the valuation date' },
  {
    id: 'QA-06',
    label: 'Adjustments are reasoned and calculations trace to inputs and formula versions',
  },
  { id: 'QA-07', label: 'Overrides are justified' },
  { id: 'QA-08', label: 'Reconciliation supports the adopted conclusion' },
  {
    id: 'QA-09',
    label: 'Assumptions, special assumptions and limitations are appropriate and disclosed',
  },
  { id: 'QA-10', label: 'Areas are measured on the stated basis and approved' },
  { id: 'QA-11', label: 'Photographs are appropriate and privacy-redacted' },
  { id: 'QA-12', label: 'Certification is complete and consistent with the report' },
  { id: 'QA-13', label: 'Independence and conflicts are addressed' },
];

const BLOCKING_SEVERITIES: ReadonlySet<FindingSeverity> = new Set(['critical', 'major']);

export function startQaReview(params: {
  id: string;
  jobId: string;
  reviewerId: string;
  snapshotHash: string;
  at: Instant;
  checklist?: readonly Pick<QaChecklistItem, 'id' | 'label'>[];
  selfApprovalException?: SelfApprovalException;
}): QaReview {
  return {
    id: params.id,
    jobId: params.jobId,
    reviewerId: params.reviewerId,
    startedAt: params.at,
    reviewedSnapshotHash: params.snapshotHash,
    checklist: (params.checklist ?? DEFAULT_QA_CHECKLIST).map((c) => ({ ...c, response: null })),
    findings: [],
    ...(params.selfApprovalException
      ? { selfApprovalException: params.selfApprovalException }
      : {}),
  };
}

function assertOpen(review: QaReview): void {
  if (review.outcome)
    throw new DomainError('IMMUTABLE_RECORD', `QA review is already ${review.outcome}`);
}

export function answerChecklistItem(
  review: QaReview,
  itemId: string,
  response: 'yes' | 'no' | 'na',
  note?: string,
): QaReview {
  assertOpen(review);
  if (!review.checklist.some((c) => c.id === itemId))
    throw new DomainError('NOT_FOUND', `checklist item ${itemId}`);
  if (response === 'no' && !note?.trim()) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'a "no" response requires a note (and usually a finding)',
    );
  }
  return {
    ...review,
    checklist: review.checklist.map((c) =>
      c.id === itemId ? { ...c, response, ...(note ? { note } : {}) } : c,
    ),
  };
}

export function raiseFinding(
  review: QaReview,
  finding: Omit<QaFinding, 'status' | 'raisedBy'> & { raisedBy?: string },
): QaReview {
  assertOpen(review);
  if (!finding.description.trim())
    throw new DomainError('INVALID_ARGUMENT', 'a finding needs a description');
  if (review.findings.some((f) => f.id === finding.id))
    throw new DomainError('CONFLICT', `duplicate finding ${finding.id}`);
  return {
    ...review,
    findings: [
      ...review.findings,
      { ...finding, raisedBy: finding.raisedBy ?? review.reviewerId, status: 'open' },
    ],
  };
}

/** The valuer responds to a finding (after the job is returned). */
export function respondToFinding(
  review: QaReview,
  findingId: string,
  response: string,
  by: string,
  at: Instant,
): QaReview {
  if (!response.trim()) throw new DomainError('INVALID_ARGUMENT', 'a response is required');
  return {
    ...review,
    findings: review.findings.map((f) => {
      if (f.id !== findingId) return f;
      if (f.status !== 'open')
        throw new DomainError('GUARD_FAILED', `finding ${findingId} is ${f.status}`);
      return {
        ...f,
        status: 'responded',
        valuerResponse: response,
        respondedBy: by,
        respondedAt: at,
      };
    }),
  };
}

/** The reviewer records the disposition. Critical findings must be resolved, never accepted. */
export function closeFinding(
  review: QaReview,
  findingId: string,
  disposition: {
    status: 'resolved' | 'accepted' | 'withdrawn';
    note: string;
    by: string;
    at: Instant;
  },
): QaReview {
  if (disposition.by !== review.reviewerId) {
    throw new DomainError('SEPARATION_OF_DUTIES', 'only the reviewer can close a finding');
  }
  return {
    ...review,
    findings: review.findings.map((f) => {
      if (f.id !== findingId) return f;
      if (f.status === 'resolved' || f.status === 'accepted' || f.status === 'withdrawn') {
        throw new DomainError('GUARD_FAILED', `finding ${findingId} is already ${f.status}`);
      }
      if (disposition.status === 'accepted' && f.severity === 'critical') {
        throw new DomainError('GUARD_FAILED', 'critical findings must be resolved, not accepted');
      }
      if (disposition.status !== 'resolved' && !disposition.note.trim()) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `a note is required to mark a finding ${disposition.status}`,
        );
      }
      return {
        ...f,
        status: disposition.status,
        closedBy: disposition.by,
        closedAt: disposition.at,
        closureNote: disposition.note,
      };
    }),
  };
}

/** Reasons a review cannot be approved yet (empty = approvable). */
export function qaApprovalBlockers(review: QaReview): string[] {
  const blockers: string[] = [];
  const unanswered = review.checklist.filter((c) => c.response === null);
  if (unanswered.length) blockers.push(`${unanswered.length} checklist item(s) unanswered`);
  const no = review.checklist.filter((c) => c.response === 'no');
  if (no.length)
    blockers.push(`checklist item(s) answered "no": ${no.map((c) => c.id).join(', ')}`);
  const open = review.findings.filter((f) => f.status === 'open' || f.status === 'responded');
  if (open.length) blockers.push(`${open.length} finding(s) not closed`);
  return blockers;
}

/** Whether the review supports returning the job (an unresolved major/critical finding). */
export const hasReturnableFindings = (review: QaReview): boolean =>
  review.findings.some(
    (f) => BLOCKING_SEVERITIES.has(f.severity) && (f.status === 'open' || f.status === 'responded'),
  );

export function completeQaReview(
  review: QaReview,
  outcome: 'approved' | 'returned',
  at: Instant,
): QaReview {
  assertOpen(review);
  if (outcome === 'approved') {
    const blockers = qaApprovalBlockers(review);
    if (blockers.length)
      throw new DomainError('GUARD_FAILED', 'QA review cannot be approved', { blockers });
  }
  return { ...review, outcome, completedAt: at };
}
