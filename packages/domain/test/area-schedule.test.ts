import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONVENTIONS,
  approveMeasurement,
  calibrateTwoPoint,
  computeAreaSchedule,
  confirmCalibration,
  freezeSketchVersion,
  nextSketchVersion,
  assertSketchMutable,
  type Actor,
  type Boundary,
  type MeasurementConvention,
  type Point,
  type SketchVersion,
} from '../src/index.js';

const at = '2026-10-02T00:00:00Z';
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const boundary = (id: string, points: Point[], over: Partial<Boundary> = {}): Boundary => ({
  id,
  level: 'Ground',
  label: id,
  role: 'component',
  componentType: 'living',
  points,
  closed: true,
  dimensionSource: 'measured',
  origin: 'drawn',
  reviewStatus: 'accepted',
  measuredBy: 'inspector1',
  measuredAt: at,
  ...over,
});
const convention = (id: string): MeasurementConvention =>
  DEFAULT_CONVENTIONS.find((c) => c.id === id)!;
const sketch = (boundaries: Boundary[], over: Partial<SketchVersion> = {}): SketchVersion => ({
  id: 'sv1',
  sketchId: 'sk1',
  assetId: 'a1',
  version: 1,
  units: 'metres',
  boundaries,
  basis: 'BUILDING_AREA',
  conventionId: 'res-under-main-roof',
  includeInClientReport: true,
  changeSummary: 'Initial sketch',
  createdBy: 'inspector1',
  createdAt: at,
  status: 'working',
  ...over,
});
const valuer: Actor = {
  kind: 'human',
  userId: 'valuer1',
  orgId: 'org1',
  roles: ['VALUER'],
  mfaVerified: true,
};

describe('area schedule', () => {
  it('computes component, level and included totals for a two-storey dwelling', () => {
    const v = sketch([
      boundary('living-gf', rect(0, 0, 12, 10)),
      boundary('garage', rect(12, 0, 6, 6), { componentType: 'garage' }),
      boundary('verandah', rect(0, -2, 12, 2), { componentType: 'verandah' }),
      boundary('living-l1', rect(0, 0, 12, 8), { level: 'Level 1' }),
      boundary('void', rect(1, 1, 3, 3), {
        level: 'Level 1',
        role: 'deduction',
        componentType: 'void',
      }),
    ]);
    const s = computeAreaSchedule(v, convention('res-under-main-roof'));
    expect(s.issues).toEqual([]);
    expect(s.reportable).toBe(true);
    expect(s.scaleStatus).toBe('not_applicable');
    const row = (id: string) => s.rows.find((r) => r.boundaryId === id)!;
    expect(row('living-gf')).toMatchObject({
      grossAreaM2: 120,
      netAreaM2: 120,
      perimeterM: 44,
      confidence: 'high',
      includedInTotal: true,
    });
    expect(row('verandah').includedInTotal).toBe(false);
    expect(row('living-l1')).toMatchObject({ grossAreaM2: 96, deductionsM2: 9, netAreaM2: 87 });
    expect(s.levelTotals).toEqual([
      { level: 'Ground', grossM2: 180, deductionsM2: 0, netM2: 180, includedM2: 156 },
      { level: 'Level 1', grossM2: 96, deductionsM2: 9, netM2: 87, includedM2: 87 },
    ]);
    expect(s.totalIncludedM2).toBe(243);
    expect(s.totalNetM2).toBe(267);
    expect(s.scheduleHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies the convention: living-only excludes the garage', () => {
    const v = sketch([
      boundary('living', rect(0, 0, 10, 10)),
      boundary('garage', rect(10, 0, 6, 6), { componentType: 'garage' }),
    ]);
    expect(computeAreaSchedule(v, convention('res-living')).totalIncludedM2).toBe(100);
    expect(computeAreaSchedule(v, convention('res-under-main-roof')).totalIncludedM2).toBe(136);
  });

  it('flags overlapping components and never double-counts them', () => {
    const v = sketch([boundary('a', rect(0, 0, 10, 10)), boundary('b', rect(5, 0, 10, 10))]);
    const s = computeAreaSchedule(v, convention('res-living'));
    expect(s.issues.map((i) => i.code)).toContain('GEO-OVERLAP');
    expect(s.reportable).toBe(false);
    expect(s.totalIncludedM2).toBe(150);
  });

  it('allows rooms that share a wall', () => {
    const v = sketch([boundary('a', rect(0, 0, 5, 5)), boundary('b', rect(5, 0, 5, 5))]);
    const s = computeAreaSchedule(v, convention('res-living'));
    expect(s.issues).toEqual([]);
    expect(s.totalIncludedM2).toBe(50);
  });

  it('flags open shapes, invalid polygons and pending AI suggestions as blocking', () => {
    const v = sketch([
      boundary('ok', rect(0, 0, 10, 10)),
      boundary('open', rect(20, 0, 5, 5), { closed: false }),
      boundary('bowtie', [
        { x: 30, y: 0 },
        { x: 34, y: 4 },
        { x: 34, y: 0 },
        { x: 30, y: 4 },
      ]),
      boundary('ai', rect(40, 0, 5, 5), { origin: 'ai_suggested', reviewStatus: 'pending' }),
      boundary('rejected', rect(50, 0, 5, 5), { origin: 'ai_suggested', reviewStatus: 'rejected' }),
    ]);
    const s = computeAreaSchedule(v, convention('res-living'));
    expect(s.issues.map((i) => i.code).sort()).toEqual([
      'GEO-INVALID-POLYGON',
      'GEO-OPEN-SHAPE',
      'GEO-PENDING-REVIEW',
    ]);
    expect(s.rows.map((r) => r.boundaryId)).toEqual(['ok']);
    expect(s.reportable).toBe(false);
  });

  it('warns about deductions outside components and implausible dimensions', () => {
    const v = sketch([
      boundary('room', rect(0, 0, 10, 10)),
      boundary('courtyard', rect(20, 20, 3, 3), { role: 'deduction', componentType: 'courtyard' }),
      boundary('sliver', rect(30, 0, 0.05, 4)),
    ]);
    const s = computeAreaSchedule(v, convention('res-living'));
    const codes = s.issues.map((i) => i.code);
    expect(codes).toContain('GEO-DEDUCTION-OUTSIDE');
    expect(codes).toContain('GEO-IMPLAUSIBLE-DIMENSION');
    expect(codes).toContain('GEO-IMPLAUSIBLE-AREA');
    expect(s.reportable).toBe(true); // warnings only
  });

  it('compares with supplied plan and floor totals', () => {
    const v = sketch([boundary('living', rect(0, 0, 10, 10))], {
      suppliedAreas: [
        { label: 'Builder plan', areaM2: 112, source: 'Plan dated 2019' },
        { label: 'Ground floor on plan', areaM2: 101, level: 'Ground', source: 'Plan dated 2019' },
      ],
    });
    const s = computeAreaSchedule(v, convention('res-living'));
    expect(s.issues.map((i) => i.code)).toEqual(['GEO-SUPPLIED-VARIANCE']);
    expect(s.issues[0]!.message).toContain('-10.7%');
  });

  it('requires a scale for traced plans and labels areas unverified until confirmed', () => {
    const traced = rect(100, 100, 500, 400).map((p) => ({ ...p })); // plan units (pixels)
    const b = boundary('traced', traced, { origin: 'traced', dimensionSource: 'scaled' });
    const noScale = computeAreaSchedule(
      sketch([b], { units: 'plan_units' }),
      convention('res-living'),
    );
    expect(noScale.scaleStatus).toBe('missing');
    expect(noScale.rows).toEqual([]);
    expect(noScale.issues.map((i) => i.code)).toEqual(['GEO-SCALE-MISSING']);

    const cal = calibrateTwoPoint({
      id: 'cal1',
      sourcePlanId: 'plan1',
      p1: { x: 100, y: 100 },
      p2: { x: 600, y: 100 },
      knownDistanceM: 10,
      createdBy: 'inspector1',
      createdAt: at,
    });
    const unverified = computeAreaSchedule(
      sketch([b], { units: 'plan_units', calibration: cal }),
      convention('res-living'),
    );
    expect(unverified.scaleStatus).toBe('unverified');
    expect(unverified.totalIncludedM2).toBe(80); // 500×400 px × 0.02² m²/px²
    expect(unverified.rows[0]!.confidence).toBe('low');
    expect(unverified.reportable).toBe(false);

    const confirmed = computeAreaSchedule(
      sketch([b], { units: 'plan_units', calibration: confirmCalibration(cal, 'valuer1', at) }),
      convention('res-living'),
    );
    expect(confirmed.reportable).toBe(true);
    expect(confirmed.rows[0]).toMatchObject({ confidence: 'medium', calibrationId: 'cal1' });
  });

  it('blocks when the convention basis does not match the sketch basis', () => {
    const s = computeAreaSchedule(
      sketch([boundary('a', rect(0, 0, 5, 5))]),
      convention('comm-nla'),
    );
    expect(s.issues.map((i) => i.code)).toContain('GEO-CONVENTION-BASIS-MISMATCH');
  });

  it('is deterministic (same sketch → same hash)', () => {
    const v = sketch([boundary('a', rect(0, 0, 5, 5))]);
    expect(computeAreaSchedule(v, convention('res-living')).scheduleHash).toBe(
      computeAreaSchedule(v, convention('res-living')).scheduleHash,
    );
  });
});

describe('sketch versioning and approval', () => {
  const v1 = sketch([boundary('a', rect(0, 0, 10, 10))]);

  it('approves a reportable schedule, binding the approval to its hash', () => {
    const schedule = computeAreaSchedule(v1, convention('res-living'));
    const { approval, version } = approveMeasurement({
      id: 'ap1',
      version: v1,
      schedule,
      approver: valuer,
      at,
    });
    expect(approval).toMatchObject({
      sketchVersionId: 'sv1',
      scheduleHash: schedule.scheduleHash,
      totalIncludedM2: 100,
      approvedBy: 'valuer1',
    });
    expect(version.status).toBe('approved');
    expect(() => {
      assertSketchMutable(version);
    }).toThrow(/create a new version/);
    const frozen = freezeSketchVersion(version);
    expect(frozen.status).toBe('frozen');
  });

  it('refuses approval by non-humans, of non-reportable schedules or mismatched versions', () => {
    const schedule = computeAreaSchedule(v1, convention('res-living'));
    expect(() =>
      approveMeasurement({
        id: 'x',
        version: v1,
        schedule,
        approver: { ...valuer, kind: 'ai' },
        at,
      }),
    ).toThrow(/approved by a person/);
    const bad = computeAreaSchedule(
      sketch([boundary('a', rect(0, 0, 10, 10), { closed: false })]),
      convention('res-living'),
    );
    expect(() =>
      approveMeasurement({ id: 'x', version: v1, schedule: bad, approver: valuer, at }),
    ).toThrow(/blocking/);
    const other = computeAreaSchedule({ ...v1, id: 'sv2' }, convention('res-living'));
    expect(() =>
      approveMeasurement({ id: 'x', version: v1, schedule: other, approver: valuer, at }),
    ).toThrow(/different sketch/);
  });

  it('creates new versions with lineage and requires a change summary', () => {
    const v2 = nextSketchVersion(
      { ...v1, status: 'frozen' },
      { boundaries: [boundary('a', rect(0, 0, 10, 11))] },
      { id: 'sv2', changeSummary: 'Corrected rear wall', createdBy: 'valuer1', createdAt: at },
    );
    expect(v2).toMatchObject({ version: 2, parentVersionId: 'sv1', status: 'working' });
    expect(() =>
      nextSketchVersion(v1, {}, { id: 'sv3', changeSummary: ' ', createdBy: 'u', createdAt: at }),
    ).toThrow();
  });
});
