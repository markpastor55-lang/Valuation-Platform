import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import type { Point } from './polygon.js';
import { distance } from './polygon.js';

export type CalibrationMethod = 'two_point' | 'stated_scale';
export type CalibrationStatus = 'unverified' | 'confirmed' | 'superseded';

/**
 * Converts source-plan units (pixels of an image or PDF page) to metres. Areas derived from an
 * unconfirmed calibration are labelled unverified and are not reportable (brief §6).
 */
export interface ScaleCalibration {
  readonly id: string;
  readonly sourcePlanId: string;
  readonly method: CalibrationMethod;
  readonly points?: readonly [Point, Point];
  readonly knownDistanceM?: number;
  readonly statedScale?: { readonly ratio: number; readonly dpi: number };
  readonly metresPerUnit: number;
  /** Approximate relative error from ±1 unit picking error at each end. */
  readonly estimatedRelativeError: number;
  readonly status: CalibrationStatus;
  readonly createdBy: string;
  readonly createdAt: Instant;
  readonly confirmedBy?: string;
  readonly confirmedAt?: Instant;
  readonly supersedesId?: string;
}

export const MIN_CALIBRATION_SPAN_UNITS = 50;
export const MIN_KNOWN_DISTANCE_M = 0.5;
export const MAX_KNOWN_DISTANCE_M = 2000;

/** Two-point calibration from a known real-world dimension drawn on the plan. */
export function calibrateTwoPoint(params: {
  id: string;
  sourcePlanId: string;
  p1: Point;
  p2: Point;
  knownDistanceM: number;
  createdBy: string;
  createdAt: Instant;
  supersedesId?: string;
}): ScaleCalibration {
  const span = distance(params.p1, params.p2);
  if (
    !Number.isFinite(params.knownDistanceM) ||
    params.knownDistanceM < MIN_KNOWN_DISTANCE_M ||
    params.knownDistanceM > MAX_KNOWN_DISTANCE_M
  ) {
    throw new DomainError(
      'CALIBRATION_INVALID',
      `known distance must be between ${MIN_KNOWN_DISTANCE_M} m and ${MAX_KNOWN_DISTANCE_M} m`,
      { knownDistanceM: params.knownDistanceM },
    );
  }
  if (span < MIN_CALIBRATION_SPAN_UNITS) {
    throw new DomainError(
      'CALIBRATION_INVALID',
      `calibration points are too close (${span.toFixed(1)} units); pick a longer known dimension`,
      { span },
    );
  }
  return {
    id: params.id,
    sourcePlanId: params.sourcePlanId,
    method: 'two_point',
    points: [params.p1, params.p2],
    knownDistanceM: params.knownDistanceM,
    metresPerUnit: params.knownDistanceM / span,
    estimatedRelativeError: 2 / span,
    status: 'unverified',
    createdBy: params.createdBy,
    createdAt: params.createdAt,
    ...(params.supersedesId ? { supersedesId: params.supersedesId } : {}),
  };
}

/** Calibration from a stated drawing scale (e.g. 1:100) and the raster resolution. */
export function calibrateFromStatedScale(params: {
  id: string;
  sourcePlanId: string;
  ratio: number;
  dpi: number;
  createdBy: string;
  createdAt: Instant;
}): ScaleCalibration {
  if (!(params.ratio > 0) || !(params.dpi > 0)) {
    throw new DomainError('CALIBRATION_INVALID', 'scale ratio and dpi must be positive');
  }
  return {
    id: params.id,
    sourcePlanId: params.sourcePlanId,
    method: 'stated_scale',
    statedScale: { ratio: params.ratio, dpi: params.dpi },
    metresPerUnit: (0.0254 / params.dpi) * params.ratio,
    // Printed/scanned plans are frequently not at their stated scale: treat as indicative.
    estimatedRelativeError: 0.02,
    status: 'unverified',
    createdBy: params.createdBy,
    createdAt: params.createdAt,
  };
}

/** The valuer confirms the scale (typically after a check dimension agrees). Human-only. */
export function confirmCalibration(
  cal: ScaleCalibration,
  by: string,
  at: Instant,
): ScaleCalibration {
  if (cal.status === 'superseded')
    throw new DomainError('IMMUTABLE_RECORD', 'calibration has been superseded');
  return { ...cal, status: 'confirmed', confirmedBy: by, confirmedAt: at };
}

export interface CalibrationCheck {
  readonly measuredM: number;
  readonly expectedM: number;
  readonly deviation: number;
  readonly withinTolerance: boolean;
}

/** Checks a second known dimension against the calibration (default tolerance 2%). */
export function checkCalibration(
  cal: ScaleCalibration,
  p1: Point,
  p2: Point,
  expectedM: number,
  tolerance = 0.02,
): CalibrationCheck {
  const measuredM = distance(p1, p2) * cal.metresPerUnit;
  const deviation = (measuredM - expectedM) / expectedM;
  return { measuredM, expectedM, deviation, withinTolerance: Math.abs(deviation) <= tolerance };
}

// ── Perspective correction ────────────────────────────────────────────────────

/** 3×3 projective transform, row-major, h[8] = 1. */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Solves `a·x = b` by Gauss–Jordan elimination with partial pivoting (row-major `a`, size n×n). */
function solve(a: readonly number[], b: readonly number[]): number[] {
  const n = b.length;
  const w = n + 1;
  const m = new Float64Array(n * w);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) m[r * w + c] = a[r * n + c] ?? 0;
    m[r * w + n] = b[r] ?? 0;
  }
  const at = (r: number, c: number): number => m[r * w + c] ?? 0;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(at(r, col)) > Math.abs(at(pivot, col))) pivot = r;
    if (Math.abs(at(pivot, col)) < 1e-12) {
      throw new DomainError(
        'GEOMETRY_INVALID',
        'reference points are degenerate (three are collinear)',
      );
    }
    if (pivot !== col) {
      for (let c = 0; c <= n; c++) {
        const tmp = at(col, c);
        m[col * w + c] = at(pivot, c);
        m[pivot * w + c] = tmp;
      }
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = at(r, col) / at(col, col);
      for (let c = col; c <= n; c++) m[r * w + c] = at(r, c) - f * at(col, c);
    }
  }
  return Array.from({ length: n }, (_, i) => at(i, n) / at(i, i));
}

/**
 * Homography mapping four source points (e.g. corners of a photographed plan) to four target
 * points (the rectified rectangle). Assists tracing only: output is never a surveyed measurement.
 */
export function computeHomography(src: readonly Point[], dst: readonly Point[]): Homography {
  if (src.length !== 4 || dst.length !== 4) {
    throw new DomainError(
      'GEOMETRY_INVALID',
      'perspective correction needs exactly four point pairs',
    );
  }
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i] as Point;
    const { x: u, y: v } = dst[i] as Point;
    a.push(x, y, 1, 0, 0, 0, -u * x, -u * y);
    b.push(u);
    a.push(0, 0, 0, x, y, 1, -v * x, -v * y);
    b.push(v);
  }
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = solve(a, b);
  return [h0, h1, h2, h3, h4, h5, h6, h7, 1];
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) throw new DomainError('GEOMETRY_INVALID', 'point maps to infinity');
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}
