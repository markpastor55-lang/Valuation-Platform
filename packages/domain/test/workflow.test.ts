import { describe, expect, it } from 'vitest';
import {
  answerChecklistItem,
  checkTransition,
  closeFinding,
  completeQaReview,
  isEditable,
  qaApprovalBlockers,
  raiseFinding,
  respondToFinding,
  signCertification,
  startQaReview,
  transitionJob,
  assertEditable,
  type Actor,
  type CertificationContent,
  type QaReview,
  type WorkflowContext,
} from '../src/index.js';

const at = '2026-10-02T00:00:00Z';
const valuer: Actor = {
  kind: 'human',
  userId: 'valuer1',
  orgId: 'org1',
  roles: ['VALUER'],
  mfaVerified: true,
};
const reviewer: Actor = {
  kind: 'human',
  userId: 'reviewer1',
  orgId: 'org1',
  roles: ['QA_REVIEWER'],
  mfaVerified: true,
};

const content: CertificationContent = {
  jobId: 'j1',
  valuer: { userId: 'valuer1', fullName: 'Alex Valuer', credentials: ['AAPI', 'CPV'] },
  role: 'responsible_valuer',
  inspectionScope: 'FULL',
  inspectionScopeStatement: 'Full internal and external inspection on 1 October 2026.',
  valuationDate: '2026-10-01',
  basisOfValue: 'Market value',
  amount: { value: 1_250_000, currency: 'AUD', kind: 'value' },
  independenceStatement: 'I have no pecuniary interest that could conflict with this valuation.',
  conflictsStatement: 'No conflict identified.',
  assumptions: ['Title is free of unregistered encumbrances.'],
  specialAssumptions: [],
  limitations: ['No structural survey was undertaken.'],
  standardsReliedOn: [
    'Firm valuation methodology v1 (mapped to applicable professional standards by the standards owner)',
  ],
  clauseVersionIds: ['cert-core@1'],
};
const attestation = 'I certify this valuation is my independent professional opinion.';

const sign = (snapshotHash = 'h1', actor: Actor = valuer) =>
  signCertification(content, {
    id: 'cert1',
    actor,
    responsibleValuerId: 'valuer1',
    snapshotHash,
    at,
    attestationText: attestation,
  });

function approvedReview(snapshot = 'h1'): QaReview {
  let r = startQaReview({
    id: 'qa1',
    jobId: 'j1',
    reviewerId: 'reviewer1',
    snapshotHash: snapshot,
    at,
  });
  for (const item of r.checklist) r = answerChecklistItem(r, item.id, 'yes');
  return completeQaReview(r, 'approved', at);
}

const ctx = (over: Partial<WorkflowContext> = {}): WorkflowContext => ({
  job: {
    id: 'j1',
    status: 'draft',
    responsibleValuerId: 'valuer1',
    conflictCheck: 'no_conflict',
    engagementDocumentCount: 1,
  },
  actor: valuer,
  currentSnapshotHash: 'h1',
  validation: { blockingCount: 0, unacknowledgedWarningCount: 0 },
  ...over,
});
const status = (s: WorkflowContext['job']['status'], over: Partial<WorkflowContext> = {}) =>
  ctx({ ...over, job: { ...ctx().job, status: s } });

describe('certification', () => {
  it('is signed by the responsible valuer with MFA and binds to the snapshot', () => {
    const c = sign();
    expect(c.snapshotHash).toBe('h1');
    expect(c.signature.attestationHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('can never be signed by software, AI, another user or without MFA', () => {
    expect(() => sign('h1', { ...valuer, kind: 'ai' })).toThrow(/only a person/);
    expect(() => sign('h1', { ...valuer, kind: 'system' })).toThrow(/only a person/);
    expect(() => sign('h1', { ...valuer, mfaVerified: false })).toThrow(/multi-factor/);
    expect(() => sign('h1', { ...valuer, userId: 'valuer2' })).toThrow(/responsible valuer/);
  });

  it('rejects incomplete certification content', () => {
    expect(() =>
      signCertification(
        { ...content, standardsReliedOn: [], limitations: [] },
        {
          id: 'c',
          actor: valuer,
          responsibleValuerId: 'valuer1',
          snapshotHash: 'h',
          at,
          attestationText: attestation,
        },
      ),
    ).toThrow(/incomplete/);
  });
});

describe('job lifecycle', () => {
  it('accepts an engagement only after conflict check, allocation and documents', () => {
    expect(transitionJob('acceptEngagement', ctx())).toEqual({
      status: 'active',
      auditAction: 'job.engagement_accepted',
    });
    const declined = ctx({ job: { ...ctx().job, conflictCheck: 'conflict_declined' } });
    expect(checkTransition('acceptEngagement', declined).failures).toContain(
      'engagement declined because of a conflict',
    );
    const noDocs = ctx({ job: { ...ctx().job, engagementDocumentCount: 0 } });
    expect(checkTransition('acceptEngagement', noDocs).allowed).toBe(false);
  });

  it('cannot submit with blocking validations, unacknowledged warnings or no certification', () => {
    const c = checkTransition(
      'submitForQa',
      status('active', { validation: { blockingCount: 2, unacknowledgedWarningCount: 1 } }),
    );
    expect(c.failures).toEqual(
      expect.arrayContaining([
        '2 blocking validation(s) unresolved',
        '1 warning(s) not acknowledged',
        'certification has not been signed',
      ]),
    );
    expect(transitionJob('submitForQa', status('active', { certification: sign() })).status).toBe(
      'submitted',
    );
  });

  it('requires re-certification when content changes after signing', () => {
    const c = checkTransition(
      'submitForQa',
      status('active', { certification: sign('old'), currentSnapshotHash: 'new' }),
    );
    expect(c.failures).toContain('content changed after certification; re-certify');
  });

  it('locks content once submitted', () => {
    expect(isEditable('active')).toBe(true);
    expect(isEditable('returned')).toBe(true);
    for (const s of ['submitted', 'in_review', 'approved', 'issued', 'cancelled'] as const) {
      expect(() => {
        assertEditable(s);
      }).toThrow(/locked/);
    }
  });

  it('approves only with a complete review of the current snapshot', () => {
    const base = { actor: reviewer, certification: sign() };
    let review = startQaReview({
      id: 'qa1',
      jobId: 'j1',
      reviewerId: 'reviewer1',
      snapshotHash: 'h1',
      at,
    });
    expect(
      checkTransition('approve', status('in_review', { ...base, qaReview: review })).failures,
    ).toContain('13 checklist item(s) unanswered');
    for (const item of review.checklist) review = answerChecklistItem(review, item.id, 'yes');
    expect(
      transitionJob('approve', status('in_review', { ...base, qaReview: review })).status,
    ).toBe('approved');
    expect(
      checkTransition(
        'approve',
        status('in_review', { ...base, qaReview: review, currentSnapshotHash: 'h2' }),
      ).failures,
    ).toContain('content changed during review');
  });

  it('cannot issue without approval, or after content changed post-approval', () => {
    const base = { certification: sign(), qaReview: approvedReview() };
    expect(checkTransition('issue', status('approved', base)).failures).toContain(
      'QA approval is missing',
    );
    expect(
      transitionJob('issue', status('approved', { ...base, approvedSnapshotHash: 'h1' })),
    ).toEqual({
      status: 'issued',
      auditAction: 'report.issued',
    });
    expect(
      checkTransition('issue', status('approved', { ...base, approvedSnapshotHash: 'h0' }))
        .failures,
    ).toContain('content changed after QA approval');
  });

  it('rejects invalid transitions and non-human actors', () => {
    expect(() => transitionJob('issue', status('active'))).toThrow(/cannot issue from active/);
    const sys: Actor = { ...valuer, kind: 'system' };
    expect(checkTransition('acceptEngagement', ctx({ actor: sys })).failures).toContain(
      'workflow transitions require a person',
    );
  });

  it('returning requires a major finding or a reason', () => {
    const review = startQaReview({
      id: 'qa1',
      jobId: 'j1',
      reviewerId: 'reviewer1',
      snapshotHash: 'h1',
      at,
    });
    expect(
      checkTransition('returnToValuer', status('in_review', { actor: reviewer, qaReview: review }))
        .allowed,
    ).toBe(false);
    const withFinding = raiseFinding(review, {
      id: 'f1',
      severity: 'major',
      category: 'evidence',
      description: 'Sale 3 is not comparable',
      raisedAt: at,
    });
    expect(
      transitionJob(
        'returnToValuer',
        status('in_review', { actor: reviewer, qaReview: withFinding }),
      ).status,
    ).toBe('returned');
  });

  it('cancel and amendment require reasons', () => {
    expect(checkTransition('cancel', status('active')).allowed).toBe(false);
    expect(
      checkTransition('cancel', status('active', { reason: 'Client withdrew instruction' }))
        .allowed,
    ).toBe(true);
    expect(
      checkTransition(
        'openAmendment',
        status('issued', { reason: 'Typographical error in address' }),
      ).to,
    ).toBe('active');
  });
});

describe('QA findings', () => {
  const base = () =>
    raiseFinding(
      startQaReview({ id: 'qa1', jobId: 'j1', reviewerId: 'reviewer1', snapshotHash: 'h1', at }),
      {
        id: 'f1',
        severity: 'critical',
        category: 'calculation',
        description: 'Adopted rate outside evidence range without explanation',
        raisedAt: at,
      },
    );

  it('critical findings must be resolved, not accepted', () => {
    expect(() =>
      closeFinding(base(), 'f1', { status: 'accepted', note: 'ok', by: 'reviewer1', at }),
    ).toThrow(/critical/);
  });

  it('only the reviewer closes findings; valuer responds', () => {
    let r = respondToFinding(base(), 'f1', 'Added commentary in reconciliation', 'valuer1', at);
    expect(r.findings[0]!.status).toBe('responded');
    expect(() =>
      closeFinding(r, 'f1', { status: 'resolved', note: '', by: 'valuer1', at }),
    ).toThrow(/only the reviewer/);
    r = closeFinding(r, 'f1', { status: 'resolved', note: '', by: 'reviewer1', at });
    expect(qaApprovalBlockers(r)).toEqual(['13 checklist item(s) unanswered']);
  });

  it('a "no" checklist answer needs a note and blocks approval', () => {
    const r = startQaReview({
      id: 'qa1',
      jobId: 'j1',
      reviewerId: 'reviewer1',
      snapshotHash: 'h1',
      at,
    });
    expect(() => answerChecklistItem(r, 'QA-01', 'no')).toThrow(/note/);
    const answered = answerChecklistItem(r, 'QA-01', 'no', 'Intended users not stated');
    expect(qaApprovalBlockers(answered).join()).toContain('QA-01');
  });

  it('completed reviews are immutable', () => {
    const done = approvedReview();
    expect(() =>
      raiseFinding(done, {
        id: 'f9',
        severity: 'minor',
        category: 'x',
        description: 'late',
        raisedAt: at,
      }),
    ).toThrow(/already approved/);
  });
});
