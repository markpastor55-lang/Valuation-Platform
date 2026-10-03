import { DEFAULT_QA_CHECKLIST, buildWip, verifyAuditChain } from '@vp/domain';
import { describe, expect, it } from 'vitest';
import { DEMO_PROFILE, seedApp, wipJobs } from '../src/app-state.js';
import {
  REVIEWER,
  VALUER,
  apply,
  derive,
  initialState,
  qaVisible,
  type PreviewAction,
  type PreviewState,
} from '../src/model.js';

const NOW = '2026-10-02T00:00:00Z';
const run = (s: PreviewState, ...actions: PreviewAction[]) =>
  actions.reduce((acc, a) => apply(acc, a, NOW), s);
const codes = (s: PreviewState, stage: 'submit' | 'issue') =>
  derive(s, NOW).validation[stage].findings.map((f) => f.code);
const set = (fieldId: string, value: unknown, assetId: string | null = 'a1'): PreviewAction => ({
  type: 'setField',
  fieldId,
  assetId,
  value,
});

const complete = (s: PreviewState): PreviewState =>
  run(
    s,
    set('improvements.condition', 'Good: well maintained'),
    { type: 'useSketchArea' },
    set('valuation.reconciliation', 'Direct comparison adopted, supported by summation.'),
  );

describe('preview journey (runs the domain engine)', () => {
  it('starts with three things to do and no QA tab', () => {
    const s = initialState(NOW);
    const d = derive(s, NOW);
    expect(
      d.missing
        .filter((m) => m.level === 'required')
        .map((m) => m.fieldId)
        .sort(),
    ).toEqual(['improvements.buildingArea', 'improvements.condition', 'valuation.reconciliation']);
    expect(d.missingByTab).toEqual({ inspection: 2, valuation: 1 });
    expect(codes(s, 'submit')).toEqual(['VAL-REQ-001', 'VAL-REQ-001', 'VAL-REQ-001']);
    expect(qaVisible(s)).toBe(false);
  });

  it('keeps the sketch as notes: not checked, not reported, total copied on request', () => {
    let s = initialState(NOW);
    // An overlapping shape would block a reported schedule; notes are not checked
    const extra = { ...s.sketch.boundaries[0]!, id: 'b-dup', label: 'Duplicate' };
    s = run(s, { type: 'setBoundaries', boundaries: [...s.sketch.boundaries, extra] });
    expect(codes(s, 'submit').filter((c) => c.startsWith('VAL-AREA'))).toEqual([]);
    s = run(s, { type: 'setBoundaries', boundaries: s.sketch.boundaries.slice(0, 4) });
    s = run(s, { type: 'useSketchArea' });
    expect(s.values.assets['a1']?.['improvements.buildingArea']).toBe(216);
    const report = derive(s, NOW).report;
    expect(report.sections.map((x) => x.sectionId)).not.toContain('areas');
    expect(
      report.sections
        .flatMap((x) => x.blocks)
        .some((b) => b.kind === 'image' && b.ref.type === 'sketch'),
    ).toBe(false);
  });

  it('asks CGT questions without a tax-agent field and detects retrospective dates', () => {
    let s = run(initialState(NOW), {
      type: 'setSelection',
      selection: { ...initialState(NOW).selection, purpose: 'CGT' },
    });
    let d = derive(s, NOW);
    const ids = d.requirements.fields.map((f) => f.fieldId);
    expect(ids).toContain('cgt.taxEvent');
    expect(ids.some((id) => /adviser|agent/i.test(id))).toBe(false);
    expect(d.retrospective.retrospective).toBe(false);

    s = run(s, set('dates.valuation', '2020-07-01', null));
    d = derive(s, NOW);
    expect(d.retrospective.retrospective).toBe(true);
    expect(d.requirements.fields.find((f) => f.fieldId === 'retro.evidenceBasis')?.level).toBe(
      'required',
    );
    expect(s.lastChange?.diff.newlyRequired).toContain('retro.evidenceBasis');

    s = run(s, set('dates.valuation', '2026-09-30', null));
    expect(derive(s, NOW).retrospective.retrospective).toBe(false);
  });

  it('will not send to QA until everything is done', () => {
    const s = initialState(NOW);
    expect(() => apply(s, { type: 'sendToQa', profile: DEMO_PROFILE }, NOW)).toThrow(/blocking/);
  });

  it('runs from capture to issue with QA only after the valuer sends it', () => {
    let s = complete(initialState(NOW));
    expect(codes(s, 'submit')).toEqual([]);

    s = run(s, { type: 'sendToQa', profile: DEMO_PROFILE });
    expect(s.status).toBe('submitted');
    expect(qaVisible(s)).toBe(true);
    expect(s.certification?.valuer.userId).toBe(VALUER.userId);
    expect(() => apply(s, set('land.area', 700), NOW)).toThrow(/locked/);

    s = run(
      s,
      { type: 'transition', action: 'startReview' },
      ...DEFAULT_QA_CHECKLIST.map((c): PreviewAction => ({
        type: 'answerChecklist',
        itemId: c.id,
        response: 'yes',
      })),
      { type: 'transition', action: 'approve' },
    );
    expect(s.status).toBe('approved');
    expect(s.audit.find((e) => e.action === 'qa.approved')?.actor.userId).toBe(REVIEWER.userId);

    s = run(s, { type: 'transition', action: 'issue' });
    expect(s.status).toBe('issued');
    expect(s.audit.find((e) => e.action === 'report.issued')?.actor.userId).toBe(VALUER.userId);
    const d = derive(s, NOW);
    expect(d.report.meta.status).toBe('final');
    expect(d.report.problems).toEqual([]);
    expect(d.validation.issue.blockingCount).toBe(0);
    expect(verifyAuditChain(s.audit)).toMatchObject({ valid: true });
  });

  it('lets QA send the job back; the valuer fixes it and signs again', () => {
    let s = run(
      complete(initialState(NOW)),
      { type: 'sendToQa', profile: DEMO_PROFILE },
      {
        type: 'transition',
        action: 'startReview',
      },
    );
    expect(() => apply(s, { type: 'transition', action: 'approve' }, NOW)).toThrow(/unanswered/);
    s = run(s, {
      type: 'transition',
      action: 'returnToValuer',
      reason: 'Explain the adjustment to sale 2',
    });
    expect(s.status).toBe('returned');
    const firstSignature = s.certification?.snapshotHash;
    s = run(s, set('land.area', 652));
    expect(derive(s, NOW).certificationCurrent).toBe(false);
    s = run(s, { type: 'sendToQa', profile: DEMO_PROFILE });
    expect(s.status).toBe('submitted');
    expect(s.certification?.snapshotHash).not.toBe(firstSignature);
    expect(derive(s, NOW).certificationCurrent).toBe(true);
  });

  it('seeds one demo job in each main work-in-progress stage', async () => {
    const app = await seedApp(NOW);
    const board = buildWip(wipJobs(app), NOW.slice(0, 10));
    expect(board.counts).toMatchObject({
      new: 1,
      to_inspect: 2,
      in_progress: 1,
      with_qa: 1,
      to_issue: 1,
      issued: 1,
    });
    expect(
      buildWip(wipJobs(app), NOW.slice(0, 10), { query: 'sampleville cgt' }).rows,
    ).toHaveLength(1);
  });
});
