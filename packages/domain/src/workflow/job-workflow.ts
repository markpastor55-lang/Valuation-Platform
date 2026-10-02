import type { Actor } from '../core/actor.js';
import { DomainError } from '../core/errors.js';
import type { Permission } from '../auth/roles.js';
import type { Certification } from './certification.js';
import type { QaReview } from './qa.js';
import { hasReturnableFindings, qaApprovalBlockers } from './qa.js';

export const JOB_STATUSES = [
  'draft',
  'active',
  'submitted',
  'in_review',
  'returned',
  'approved',
  'issued',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobAction =
  | 'acceptEngagement'
  | 'submitForQa'
  | 'startReview'
  | 'returnToValuer'
  | 'approve'
  | 'issue'
  | 'openAmendment'
  | 'cancel';

export interface TransitionDef {
  readonly from: readonly JobStatus[];
  readonly to: JobStatus;
  readonly permission: Permission;
  readonly auditAction: string;
}

export const TRANSITIONS: Readonly<Record<JobAction, TransitionDef>> = {
  acceptEngagement: {
    from: ['draft'],
    to: 'active',
    permission: 'engagement.accept',
    auditAction: 'job.engagement_accepted',
  },
  submitForQa: {
    from: ['active', 'returned'],
    to: 'submitted',
    permission: 'certification.sign',
    auditAction: 'job.submitted',
  },
  startReview: {
    from: ['submitted'],
    to: 'in_review',
    permission: 'qa.review',
    auditAction: 'qa.started',
  },
  returnToValuer: {
    from: ['in_review'],
    to: 'returned',
    permission: 'qa.review',
    auditAction: 'qa.returned',
  },
  approve: {
    from: ['in_review'],
    to: 'approved',
    permission: 'qa.approve',
    auditAction: 'qa.approved',
  },
  issue: {
    from: ['approved'],
    to: 'issued',
    permission: 'report.issue',
    auditAction: 'report.issued',
  },
  openAmendment: {
    from: ['issued'],
    to: 'active',
    permission: 'job.update',
    auditAction: 'job.amendment_opened',
  },
  cancel: {
    from: ['draft', 'active', 'returned'],
    to: 'cancelled',
    permission: 'job.cancel',
    auditAction: 'job.cancelled',
  },
};

/** Content can be changed only in these states; submission locks the job for QA. */
export const EDITABLE_STATUSES: ReadonlySet<JobStatus> = new Set(['draft', 'active', 'returned']);
export const isEditable = (status: JobStatus): boolean => EDITABLE_STATUSES.has(status);

export function assertEditable(status: JobStatus): void {
  if (!isEditable(status))
    throw new DomainError('RECORD_LOCKED', `job is ${status}; content is locked`);
}

export interface ValidationSummary {
  readonly blockingCount: number;
  readonly unacknowledgedWarningCount: number;
}

export interface WorkflowContext {
  readonly job: {
    readonly id: string;
    readonly status: JobStatus;
    readonly responsibleValuerId: string | null;
    readonly conflictCheck: string | null;
    readonly engagementDocumentCount: number;
  };
  readonly actor: Actor;
  /** Hash of the job content as it stands now. */
  readonly currentSnapshotHash?: string;
  readonly validation?: ValidationSummary;
  readonly certification?: Certification;
  readonly qaReview?: QaReview;
  /** Snapshot hash recorded at QA approval. */
  readonly approvedSnapshotHash?: string;
  readonly reason?: string;
}

const MIN_REASON = 10;

function guardFailures(action: JobAction, ctx: WorkflowContext): string[] {
  const f: string[] = [];
  const { job } = ctx;
  const validationClean = () => {
    if (!ctx.validation) f.push('validation has not been run');
    else {
      if (ctx.validation.blockingCount > 0)
        f.push(`${ctx.validation.blockingCount} blocking validation(s) unresolved`);
      if (ctx.validation.unacknowledgedWarningCount > 0) {
        f.push(`${ctx.validation.unacknowledgedWarningCount} warning(s) not acknowledged`);
      }
    }
  };
  const certificationCurrent = () => {
    if (!ctx.certification) f.push('certification has not been signed');
    else {
      if (ctx.certification.valuer.userId !== job.responsibleValuerId)
        f.push('certification is not by the responsible valuer');
      if (ctx.certification.snapshotHash !== ctx.currentSnapshotHash)
        f.push('content changed after certification; re-certify');
    }
  };

  switch (action) {
    case 'acceptEngagement':
      if (!job.responsibleValuerId) f.push('a responsible valuer must be allocated');
      if (!job.conflictCheck) f.push('conflict-of-interest check has not been recorded');
      if (job.conflictCheck === 'conflict_declined')
        f.push('engagement declined because of a conflict');
      if (job.engagementDocumentCount < 1) f.push('engagement documents must be attached');
      break;
    case 'submitForQa':
      if (ctx.actor.userId !== job.responsibleValuerId)
        f.push('only the responsible valuer can submit for QA');
      validationClean();
      certificationCurrent();
      break;
    case 'startReview':
      if (!ctx.currentSnapshotHash) f.push('submission snapshot missing');
      break;
    case 'returnToValuer':
      if (!ctx.qaReview) f.push('QA review has not been started');
      else if (
        !hasReturnableFindings(ctx.qaReview) &&
        (ctx.reason?.trim().length ?? 0) < MIN_REASON
      ) {
        f.push('returning requires an open major/critical finding or a reason');
      }
      break;
    case 'approve':
      if (!ctx.qaReview) f.push('QA review has not been started');
      else {
        f.push(...qaApprovalBlockers(ctx.qaReview));
        if (ctx.qaReview.reviewerId !== ctx.actor.userId)
          f.push('only the assigned reviewer can approve');
        if (ctx.qaReview.reviewedSnapshotHash !== ctx.currentSnapshotHash)
          f.push('content changed during review');
      }
      validationClean();
      certificationCurrent();
      break;
    case 'issue':
      if (!ctx.approvedSnapshotHash) f.push('QA approval is missing');
      else if (ctx.approvedSnapshotHash !== ctx.currentSnapshotHash)
        f.push('content changed after QA approval');
      if (ctx.qaReview?.outcome !== 'approved') f.push('QA review is not approved');
      validationClean();
      certificationCurrent();
      break;
    case 'openAmendment':
    case 'cancel':
      if ((ctx.reason?.trim().length ?? 0) < MIN_REASON) f.push('a reason is required');
      break;
  }
  return f;
}

export interface TransitionCheck {
  readonly allowed: boolean;
  readonly to: JobStatus;
  readonly failures: readonly string[];
}

/** Evaluates a transition without performing it (drives button state and explanations in the UI). */
export function checkTransition(action: JobAction, ctx: WorkflowContext): TransitionCheck {
  const def = TRANSITIONS[action];
  const failures: string[] = [];
  if (!def.from.includes(ctx.job.status)) failures.push(`cannot ${action} from ${ctx.job.status}`);
  if (ctx.actor.kind !== 'human') failures.push('workflow transitions require a person');
  failures.push(...guardFailures(action, ctx));
  return { allowed: failures.length === 0, to: def.to, failures };
}

/** Performs a transition or throws with every failed guard. Authorisation is checked separately. */
export function transitionJob(
  action: JobAction,
  ctx: WorkflowContext,
): { status: JobStatus; auditAction: string } {
  const check = checkTransition(action, ctx);
  if (!check.allowed) {
    const code = TRANSITIONS[action].from.includes(ctx.job.status)
      ? 'GUARD_FAILED'
      : 'INVALID_TRANSITION';
    throw new DomainError(code, `cannot ${action}: ${check.failures.join('; ')}`, {
      failures: check.failures,
    });
  }
  return { status: check.to, auditAction: TRANSITIONS[action].auditAction };
}
