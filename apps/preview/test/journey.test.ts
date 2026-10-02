import { DEFAULT_QA_CHECKLIST, verifyAuditChain } from '@vp/domain';
import { describe, expect, it } from 'vitest';
import {
  apply,
  derive,
  initialState,
  nextStep,
  type PreviewAction,
  type PreviewState,
} from '../src/model.js';

const NOW = '2026-10-02T00:00:00Z';
const run = (s: PreviewState, ...actions: PreviewAction[]) =>
  actions.reduce((acc, a) => apply(acc, a, NOW), s);
const codes = (s: PreviewState, stage: 'submit' | 'issue') =>
  derive(s, NOW).validation[stage].findings.map((f) => f.code);

const fixIssues = (s: PreviewState): PreviewState => {
  const warning = derive(s, NOW).validation.submit.findings.find((f) => f.code === 'VAL-AREA-003')!;
  return run(
    s,
    { type: 'setRole', role: 'inspector' },
    { type: 'setField', fieldId: 'improvements.condition', assetId: 'a1', value: 'Good' },
    { type: 'setRole', role: 'valuer' },
    {
      type: 'setField',
      fieldId: 'valuation.reconciliation',
      assetId: 'a1',
      value: 'Direct comparison adopted, supported by summation.',
    },
    { type: 'approveAreas' },
    {
      type: 'acknowledge',
      code: warning.code,
      path: warning.path,
      reason: 'Permit plans pre-date the 2021 alfresco enclosure',
    },
  );
};

describe('preview journey (runs the domain engine)', () => {
  it('starts with two missing fields, unapproved areas and one area warning', () => {
    const s = initialState(NOW);
    expect(codes(s, 'submit')).toEqual([
      'VAL-REQ-001',
      'VAL-REQ-001',
      'VAL-AREA-002',
      'VAL-AREA-003',
    ]);
    expect(derive(s, NOW).schedule.totalIncludedM2).toBe(216);
    expect(nextStep(s, derive(s, NOW))?.check.allowed).toBe(false);
  });

  it('keeps valuer judgement fields away from field inspectors', () => {
    const s = run(initialState(NOW), { type: 'setRole', role: 'inspector' });
    expect(() =>
      apply(
        s,
        { type: 'setField', fieldId: 'valuation.reconciliation', assetId: 'a1', value: 'x' },
        NOW,
      ),
    ).toThrow(/Valuer only/);
    expect(() => apply(s, { type: 'approveAreas' }, NOW)).toThrow(/measurement.approve/);
    expect(() => apply(s, { type: 'sign' }, NOW)).toThrow(/certification.sign/);
  });

  it('runs from capture to issue with separation of duties', () => {
    let s = fixIssues(initialState(NOW));
    expect(codes(s, 'submit')).toEqual(['VAL-AREA-003']);
    expect(derive(s, NOW).validation.submit.unacknowledgedWarningCount).toBe(0);

    // Submission needs the certification
    expect(() => apply(s, { type: 'transition', action: 'submitForQa' }, NOW)).toThrow(
      /certification has not been signed/,
    );
    s = run(s, { type: 'sign' }, { type: 'transition', action: 'submitForQa' });
    expect(s.status).toBe('submitted');
    expect(() =>
      apply(s, { type: 'setField', fieldId: 'land.area', assetId: 'a1', value: 700 }, NOW),
    ).toThrow(/locked/);

    // The valuer cannot review their own work
    expect(() => apply(s, { type: 'transition', action: 'startReview' }, NOW)).toThrow(/qa.review/);
    s = run(
      s,
      { type: 'setRole', role: 'reviewer' },
      { type: 'transition', action: 'startReview' },
    );
    expect(s.status).toBe('in_review');
    expect(() => apply(s, { type: 'transition', action: 'approve' }, NOW)).toThrow(/unanswered/);
    s = run(
      s,
      ...DEFAULT_QA_CHECKLIST.map((c): PreviewAction => ({
        type: 'answerChecklist',
        itemId: c.id,
        response: 'yes',
      })),
      { type: 'transition', action: 'approve' },
    );
    expect(s.status).toBe('approved');

    // Reviewers cannot issue; the valuer issues the approved snapshot
    expect(() => apply(s, { type: 'transition', action: 'issue' }, NOW)).toThrow(/report.issue/);
    s = run(s, { type: 'setRole', role: 'valuer' }, { type: 'transition', action: 'issue' });
    expect(s.status).toBe('issued');
    expect(s.sketch.status).toBe('frozen');
    const d = derive(s, NOW);
    expect(d.report.meta.status).toBe('final');
    expect(d.report.problems).toEqual([]);
    expect(d.validation.issue.blockingCount).toBe(0);
    expect(verifyAuditChain(s.audit)).toMatchObject({ valid: true });
  });

  it('invalidates the certification when content changes afterwards', () => {
    let s = run(fixIssues(initialState(NOW)), { type: 'sign' });
    expect(derive(s, NOW).certificationCurrent).toBe(true);
    s = run(s, { type: 'setField', fieldId: 'land.area', assetId: 'a1', value: 700 });
    expect(derive(s, NOW).certificationCurrent).toBe(false);
    expect(() => apply(s, { type: 'transition', action: 'submitForQa' }, NOW)).toThrow(
      /re-certify/,
    );
  });

  it('starts a new sketch version when approved areas are edited', () => {
    let s = fixIssues(initialState(NOW));
    s = run(s, { type: 'setBoundaries', boundaries: s.sketch.boundaries.slice(0, 2) });
    expect(s.sketch.version).toBe(2);
    expect(s.sketchHistory[0]?.status).toBe('approved');
    expect(codes(s, 'submit')).toContain('VAL-AREA-002');
  });

  it('explains a change of purpose without discarding captured data', () => {
    const s = run(initialState(NOW), {
      type: 'setSelection',
      selection: { ...initialState(NOW).selection, purpose: 'FAMILY_LAW' },
    });
    expect(s.lastChange?.diff.newlyRequired.length).toBeGreaterThan(0);
    expect(s.values.assets['a1']?.['valuation.adoptedValue']).toBe(1_150_000);
  });
});
