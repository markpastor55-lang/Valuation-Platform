import type { Actor } from '../core/actor.js';
import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import { hashCanonical } from '../core/hash.js';
import type { SpecialistReviewer } from '../config/codes.js';
import type { MEASUREMENT_BASIS_OPTIONS } from '../config/fields.js';
import { roundHalfAwayFromZero } from '../units/units.js';
import type { ScaleCalibration } from './calibration.js';
import type { Point } from './polygon.js';
import {
  coveredArea,
  edgeLengths,
  intersectionArea,
  perimeter,
  polygonArea,
  polygonProblems,
  scalePoints,
  unionArea,
} from './polygon.js';

export const COMPONENT_TYPES = [
  'living',
  'garage',
  'carport',
  'verandah',
  'balcony',
  'alfresco',
  'office',
  'retail',
  'warehouse',
  'mezzanine',
  'amenities',
  'plant',
  'storage',
  'hardstand',
  'ancillary',
  'other',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const DEDUCTION_TYPES = ['void', 'courtyard', 'lightwell', 'excluded'] as const;
export type DeductionType = (typeof DEDUCTION_TYPES)[number];

export type MeasurementBasis = (typeof MEASUREMENT_BASIS_OPTIONS)[number];
export type DimensionSource = 'measured' | 'supplied' | 'scaled' | 'estimated';

/** A closed (or not yet closed) outline on one level of a sketch. */
export interface Boundary {
  readonly id: string;
  readonly level: string;
  readonly label: string;
  readonly role: 'component' | 'deduction';
  readonly componentType: ComponentType | DeductionType;
  /** In metres for in-app sketches, in plan units for traced plans. */
  readonly points: readonly Point[];
  readonly closed: boolean;
  readonly dimensionSource: DimensionSource;
  readonly origin: 'drawn' | 'traced' | 'ai_suggested' | 'imported';
  /** AI-suggested boundaries start `pending`; only `accepted` boundaries are measured. */
  readonly reviewStatus: 'accepted' | 'pending' | 'rejected';
  readonly measuredBy: string;
  readonly measuredAt: Instant;
  readonly notes?: string;
}

/**
 * Which component types count towards the reported total for a basis. These are firm-level
 * configuration; recognised methods of measurement are referenced, not reproduced.
 */
export interface MeasurementConvention {
  readonly id: string;
  readonly name: string;
  readonly basis: MeasurementBasis;
  readonly reference: string;
  readonly includes: readonly ComponentType[];
  readonly status: 'draft' | 'approved';
  readonly review: SpecialistReviewer;
}

export const DEFAULT_CONVENTIONS: readonly MeasurementConvention[] = [
  {
    id: 'res-living',
    name: 'Residential living area',
    basis: 'BUILDING_AREA',
    reference: 'Firm convention: enclosed habitable area measured to external faces of walls',
    includes: ['living'],
    status: 'draft',
    review: 'API_STANDARDS',
  },
  {
    id: 'res-under-main-roof',
    name: 'Residential building area under main roof',
    basis: 'BUILDING_AREA',
    reference: 'Firm convention: living plus garage and alfresco areas under the main roof',
    includes: ['living', 'garage', 'alfresco'],
    status: 'draft',
    review: 'API_STANDARDS',
  },
  {
    id: 'comm-nla',
    name: 'Commercial net lettable area',
    basis: 'NLA',
    reference:
      'Recognised lettable-area method nominated by the firm (e.g. PCA method) — reference only',
    includes: ['office', 'retail', 'storage'],
    status: 'draft',
    review: 'API_STANDARDS',
  },
  {
    id: 'retail-gla',
    name: 'Retail gross lettable area',
    basis: 'GLA',
    reference: 'Recognised lettable-area method nominated by the firm — reference only',
    includes: ['retail', 'storage'],
    status: 'draft',
    review: 'API_STANDARDS',
  },
  {
    id: 'ind-gba',
    name: 'Industrial gross building area',
    basis: 'GBA',
    reference: 'Firm convention: warehouse, office, mezzanine and ancillary enclosed areas',
    includes: ['warehouse', 'office', 'mezzanine', 'amenities', 'plant', 'storage', 'ancillary'],
    status: 'draft',
    review: 'API_STANDARDS',
  },
  {
    id: 'gfa',
    name: 'Gross floor area',
    basis: 'GFA',
    reference: 'Firm convention: all enclosed floor area; excludes open-sided and external areas',
    includes: [
      'living',
      'garage',
      'office',
      'retail',
      'warehouse',
      'mezzanine',
      'amenities',
      'plant',
      'storage',
      'ancillary',
      'other',
    ],
    status: 'draft',
    review: 'API_STANDARDS',
  },
];

export interface SuppliedArea {
  readonly label: string;
  readonly areaM2: number;
  /** Compare with this level's total; omit to compare with the overall included total. */
  readonly level?: string;
  readonly source: string;
}

export interface SketchVersion {
  readonly id: string;
  readonly sketchId: string;
  readonly assetId: string;
  readonly version: number;
  readonly parentVersionId?: string;
  readonly units: 'metres' | 'plan_units';
  readonly sourcePlanId?: string;
  readonly calibration?: ScaleCalibration;
  readonly boundaries: readonly Boundary[];
  readonly basis: MeasurementBasis;
  readonly conventionId: string;
  readonly northBearingDeg?: number;
  readonly suppliedAreas?: readonly SuppliedArea[];
  readonly includeInClientReport: boolean;
  readonly changeSummary: string;
  readonly createdBy: string;
  readonly createdAt: Instant;
  readonly status: 'working' | 'approved' | 'frozen';
}

export type GeometryIssueCode =
  | 'GEO-SCALE-MISSING'
  | 'GEO-SCALE-UNVERIFIED'
  | 'GEO-OPEN-SHAPE'
  | 'GEO-INVALID-POLYGON'
  | 'GEO-PENDING-REVIEW'
  | 'GEO-OVERLAP'
  | 'GEO-DEDUCTION-OUTSIDE'
  | 'GEO-DEDUCTION-PARTIAL'
  | 'GEO-IMPLAUSIBLE-DIMENSION'
  | 'GEO-IMPLAUSIBLE-AREA'
  | 'GEO-SUPPLIED-VARIANCE'
  | 'GEO-FLOOR-TOTAL-MISMATCH'
  | 'GEO-CONVENTION-BASIS-MISMATCH'
  | 'GEO-NO-COMPONENTS';

export interface GeometryIssue {
  readonly code: GeometryIssueCode;
  readonly severity: 'blocking' | 'warning';
  readonly message: string;
  readonly boundaryIds: readonly string[];
}

export type ScaleStatus = 'not_applicable' | 'confirmed' | 'unverified' | 'missing';

export interface AreaScheduleRow {
  readonly boundaryId: string;
  readonly level: string;
  readonly label: string;
  readonly componentType: ComponentType;
  readonly basis: MeasurementBasis;
  readonly grossAreaM2: number;
  readonly deductionsM2: number;
  readonly netAreaM2: number;
  readonly perimeterM: number;
  readonly dimensionSource: DimensionSource;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly includedInTotal: boolean;
  readonly measuredBy: string;
  readonly measuredAt: Instant;
  readonly sketchVersionId: string;
  readonly calibrationId?: string;
}

export interface LevelTotal {
  readonly level: string;
  readonly grossM2: number;
  readonly deductionsM2: number;
  readonly netM2: number;
  readonly includedM2: number;
}

export interface AreaSchedule {
  readonly sketchVersionId: string;
  readonly assetId: string;
  readonly basis: MeasurementBasis;
  readonly conventionId: string;
  readonly scaleStatus: ScaleStatus;
  readonly rows: readonly AreaScheduleRow[];
  readonly levelTotals: readonly LevelTotal[];
  readonly totalNetM2: number;
  readonly totalIncludedM2: number;
  readonly issues: readonly GeometryIssue[];
  /** No blocking issues and the scale is confirmed (or not needed). */
  readonly reportable: boolean;
  readonly scheduleHash: string;
}

export interface ScheduleTolerances {
  readonly overlapM2: number;
  readonly minEdgeM: number;
  readonly maxEdgeM: number;
  readonly minAreaM2: number;
  readonly maxAreaM2: number;
  /** Relative difference from supplied areas that triggers a warning. */
  readonly suppliedVariance: number;
}

export const DEFAULT_TOLERANCES: ScheduleTolerances = {
  overlapM2: 0.01,
  minEdgeM: 0.1,
  maxEdgeM: 1000,
  minAreaM2: 0.5,
  maxAreaM2: 200_000,
  suppliedVariance: 0.05,
};

const r2 = (n: number): number => roundHalfAwayFromZero(n, 2);

interface MeasuredBoundary {
  readonly boundary: Boundary;
  readonly pointsM: Point[];
  readonly areaM2: number;
}

function confidenceOf(b: Boundary, scale: ScaleStatus): 'high' | 'medium' | 'low' {
  if (b.origin === 'ai_suggested' || b.dimensionSource === 'estimated' || scale === 'unverified')
    return 'low';
  if (b.dimensionSource === 'measured' && (scale === 'not_applicable' || scale === 'confirmed'))
    return 'high';
  return 'medium';
}

/**
 * Computes the improvement-area schedule for a sketch version: per-component gross area,
 * deductions and net area; level and overall totals; and every geometry issue that stops the
 * schedule being reportable. Overlapping components are flagged and never double-counted in
 * totals (totals use the union of component outlines).
 */
export function computeAreaSchedule(
  version: SketchVersion,
  convention: MeasurementConvention,
  tolerances: ScheduleTolerances = DEFAULT_TOLERANCES,
): AreaSchedule {
  const issues: GeometryIssue[] = [];
  const issue = (
    code: GeometryIssueCode,
    severity: 'blocking' | 'warning',
    message: string,
    ids: string[] = [],
  ) => issues.push({ code, severity, message, boundaryIds: ids });

  let scaleStatus: ScaleStatus = 'not_applicable';
  let factor = 1;
  if (version.units === 'plan_units') {
    if (!version.calibration || version.calibration.status === 'superseded') {
      scaleStatus = 'missing';
    } else {
      factor = version.calibration.metresPerUnit;
      scaleStatus = version.calibration.status === 'confirmed' ? 'confirmed' : 'unverified';
    }
  }
  if (convention.basis !== version.basis) {
    issue(
      'GEO-CONVENTION-BASIS-MISMATCH',
      'blocking',
      `convention ${convention.name} measures ${convention.basis} but the sketch basis is ${version.basis}`,
    );
  }

  const finish = (rows: AreaScheduleRow[], levelTotals: LevelTotal[]): AreaSchedule => {
    const totalNetM2 = r2(levelTotals.reduce((s, l) => s + l.netM2, 0));
    const totalIncludedM2 = r2(levelTotals.reduce((s, l) => s + l.includedM2, 0));
    for (const supplied of version.suppliedAreas ?? []) {
      const compareTo = supplied.level
        ? (levelTotals.find((l) => l.level === supplied.level)?.includedM2 ?? 0)
        : totalIncludedM2;
      if (supplied.areaM2 <= 0) continue;
      const variance = (compareTo - supplied.areaM2) / supplied.areaM2;
      if (Math.abs(variance) > tolerances.suppliedVariance) {
        issue(
          supplied.level ? 'GEO-FLOOR-TOTAL-MISMATCH' : 'GEO-SUPPLIED-VARIANCE',
          'warning',
          `${supplied.level ? `${supplied.level} total` : 'Measured total'} ${r2(compareTo)} m² differs from ${supplied.label} (${supplied.source}) ${r2(supplied.areaM2)} m² by ${(variance * 100).toFixed(1)}%`,
        );
      }
    }
    const reportable =
      !issues.some((i) => i.severity === 'blocking') &&
      (scaleStatus === 'not_applicable' || scaleStatus === 'confirmed');
    const body = {
      sketchVersionId: version.id,
      assetId: version.assetId,
      basis: version.basis,
      conventionId: convention.id,
      scaleStatus,
      rows,
      levelTotals,
      totalNetM2,
      totalIncludedM2,
      issues,
      reportable,
    };
    return { ...body, scheduleHash: hashCanonical(body) };
  };

  if (scaleStatus === 'missing') {
    issue(
      'GEO-SCALE-MISSING',
      'blocking',
      'traced plan has no scale: calibrate from a known dimension before measuring',
    );
    return finish([], []);
  }
  if (scaleStatus === 'unverified') {
    issue(
      'GEO-SCALE-UNVERIFIED',
      'blocking',
      'scale has not been confirmed by the valuer: areas are unverified',
    );
  }

  const measured: MeasuredBoundary[] = [];
  for (const b of version.boundaries) {
    if (b.reviewStatus === 'rejected') continue;
    if (b.reviewStatus === 'pending') {
      issue(
        'GEO-PENDING-REVIEW',
        'blocking',
        `${b.label}: suggested boundary must be accepted or rejected`,
        [b.id],
      );
      continue;
    }
    if (!b.closed) {
      issue('GEO-OPEN-SHAPE', 'blocking', `${b.label}: shape is not closed`, [b.id]);
      continue;
    }
    const problems = polygonProblems(b.points);
    if (problems.length > 0) {
      issue(
        'GEO-INVALID-POLYGON',
        'blocking',
        `${b.label}: ${problems.join(', ').replaceAll('_', ' ')}`,
        [b.id],
      );
      continue;
    }
    const pointsM = scalePoints(b.points, factor);
    const areaM2 = polygonArea(pointsM);
    const edges = edgeLengths(pointsM);
    if (edges.some((e) => e < tolerances.minEdgeM || e > tolerances.maxEdgeM)) {
      issue(
        'GEO-IMPLAUSIBLE-DIMENSION',
        'warning',
        `${b.label}: wall length outside ${tolerances.minEdgeM}–${tolerances.maxEdgeM} m`,
        [b.id],
      );
    }
    if (areaM2 < tolerances.minAreaM2 || areaM2 > tolerances.maxAreaM2) {
      issue('GEO-IMPLAUSIBLE-AREA', 'warning', `${b.label}: area ${r2(areaM2)} m² is implausible`, [
        b.id,
      ]);
    }
    measured.push({ boundary: b, pointsM, areaM2 });
  }

  const levels = [...new Set(measured.map((m) => m.boundary.level))];
  const rows: AreaScheduleRow[] = [];
  const levelTotals: LevelTotal[] = [];

  for (const level of levels) {
    const components = measured.filter(
      (m) => m.boundary.level === level && m.boundary.role === 'component',
    );
    const deductions = measured.filter(
      (m) => m.boundary.level === level && m.boundary.role === 'deduction',
    );

    for (let i = 0; i < components.length; i++) {
      for (let j = i + 1; j < components.length; j++) {
        const a = components[i] as MeasuredBoundary;
        const b = components[j] as MeasuredBoundary;
        const overlap = intersectionArea(a.pointsM, b.pointsM);
        if (overlap > tolerances.overlapM2) {
          issue(
            'GEO-OVERLAP',
            'blocking',
            `${a.boundary.label} and ${b.boundary.label} overlap by ${r2(overlap)} m² (not double-counted)`,
            [a.boundary.id, b.boundary.id],
          );
        }
      }
    }

    for (const d of deductions) {
      const inside = components.length
        ? coveredArea(
            d.pointsM,
            components.map((c) => c.pointsM),
          )
        : 0;
      if (inside <= tolerances.overlapM2) {
        issue(
          'GEO-DEDUCTION-OUTSIDE',
          'warning',
          `${d.boundary.label} does not fall within any component on ${level}`,
          [d.boundary.id],
        );
      } else if (d.areaM2 - inside > tolerances.overlapM2) {
        issue(
          'GEO-DEDUCTION-PARTIAL',
          'warning',
          `${d.boundary.label}: only ${r2(inside)} of ${r2(d.areaM2)} m² falls within components`,
          [d.boundary.id],
        );
      }
    }

    const deductionPolys = deductions.map((d) => d.pointsM);
    let gross = 0;
    let deducted = 0;
    let included = 0;
    for (const c of components) {
      const ded = deductionPolys.length ? coveredArea(c.pointsM, deductionPolys) : 0;
      const net = c.areaM2 - ded;
      const includedInTotal = convention.includes.includes(
        c.boundary.componentType as ComponentType,
      );
      gross += c.areaM2;
      deducted += ded;
      if (includedInTotal) included += net;
      rows.push({
        boundaryId: c.boundary.id,
        level,
        label: c.boundary.label,
        componentType: c.boundary.componentType as ComponentType,
        basis: version.basis,
        grossAreaM2: r2(c.areaM2),
        deductionsM2: r2(ded),
        netAreaM2: r2(net),
        perimeterM: r2(perimeter(c.pointsM)),
        dimensionSource: c.boundary.dimensionSource,
        confidence: confidenceOf(c.boundary, scaleStatus),
        includedInTotal,
        measuredBy: c.boundary.measuredBy,
        measuredAt: c.boundary.measuredAt,
        sketchVersionId: version.id,
        ...(version.calibration ? { calibrationId: version.calibration.id } : {}),
      });
    }

    // Totals never double-count: if components overlap, cap at the union of their outlines.
    const includedPolys = components
      .filter((c) => convention.includes.includes(c.boundary.componentType as ComponentType))
      .map((c) => c.pointsM);
    if (includedPolys.length > 1) {
      const unionGross = unionArea(includedPolys);
      const unionDeductions = deductionPolys.length
        ? deductionPolys.reduce((s, d) => s + coveredArea(d, includedPolys), 0)
        : 0;
      included = Math.min(included, unionGross - unionDeductions);
    }
    levelTotals.push({
      level,
      grossM2: r2(gross),
      deductionsM2: r2(deducted),
      netM2: r2(gross - deducted),
      includedM2: r2(included),
    });
  }

  if (!rows.length)
    issue('GEO-NO-COMPONENTS', 'blocking', 'the sketch has no accepted, closed components');

  return finish(rows, levelTotals);
}

// ── Versioning and approval ──────────────────────────────────────────────────

export interface MeasurementApproval {
  readonly id: string;
  readonly sketchVersionId: string;
  readonly scheduleHash: string;
  readonly basis: MeasurementBasis;
  readonly totalIncludedM2: number;
  readonly approvedBy: string;
  readonly approvedAt: Instant;
}

export function assertSketchMutable(version: SketchVersion): void {
  if (version.status !== 'working') {
    throw new DomainError(
      'IMMUTABLE_RECORD',
      `sketch version ${version.version} is ${version.status}; create a new version`,
    );
  }
}

/** Creates the next version. Earlier versions (including approved/frozen ones) are kept as-is. */
export function nextSketchVersion(
  previous: SketchVersion,
  changes: Partial<
    Pick<
      SketchVersion,
      | 'boundaries'
      | 'calibration'
      | 'basis'
      | 'conventionId'
      | 'northBearingDeg'
      | 'suppliedAreas'
      | 'includeInClientReport'
      | 'units'
      | 'sourcePlanId'
    >
  >,
  meta: { id: string; changeSummary: string; createdBy: string; createdAt: Instant },
): SketchVersion {
  if (!meta.changeSummary.trim())
    throw new DomainError('INVALID_ARGUMENT', 'a change summary is required');
  return {
    ...previous,
    ...changes,
    id: meta.id,
    version: previous.version + 1,
    parentVersionId: previous.id,
    changeSummary: meta.changeSummary,
    createdBy: meta.createdBy,
    createdAt: meta.createdAt,
    status: 'working',
  };
}

/**
 * The valuer approves a reportable schedule. The approval binds to the schedule hash, so any
 * later change to the sketch requires a new version and a new approval.
 */
export function approveMeasurement(params: {
  id: string;
  version: SketchVersion;
  schedule: AreaSchedule;
  approver: Actor;
  at: Instant;
}): { approval: MeasurementApproval; version: SketchVersion } {
  const { version, schedule, approver } = params;
  if (approver.kind !== 'human')
    throw new DomainError('HUMAN_ACTOR_REQUIRED', 'measurements must be approved by a person');
  if (schedule.sketchVersionId !== version.id) {
    throw new DomainError('CONFLICT', 'schedule was computed for a different sketch version');
  }
  if (!schedule.reportable) {
    throw new DomainError('GUARD_FAILED', 'schedule has blocking issues or an unconfirmed scale', {
      issues: schedule.issues.filter((i) => i.severity === 'blocking').map((i) => i.code),
    });
  }
  assertSketchMutable(version);
  return {
    approval: {
      id: params.id,
      sketchVersionId: version.id,
      scheduleHash: schedule.scheduleHash,
      basis: schedule.basis,
      totalIncludedM2: schedule.totalIncludedM2,
      approvedBy: approver.userId,
      approvedAt: params.at,
    },
    version: { ...version, status: 'approved' },
  };
}

/** Freezes an approved version when the report is issued (immutable thereafter). */
export function freezeSketchVersion(version: SketchVersion): SketchVersion {
  if (version.status !== 'approved')
    throw new DomainError('GUARD_FAILED', 'only approved sketch versions can be frozen');
  return { ...version, status: 'frozen' };
}
