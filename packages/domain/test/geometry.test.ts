import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  calibrateFromStatedScale,
  calibrateTwoPoint,
  centroid,
  checkCalibration,
  computeHomography,
  confirmCalibration,
  coveredArea,
  intersectionArea,
  perimeter,
  pointInPolygon,
  polygonArea,
  polygonFromWalls,
  polygonProblems,
  signedArea,
  snapAngle,
  snapToGrid,
  snapToVertex,
  unionArea,
  type Point,
} from '../src/index.js';

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('polygon measurement', () => {
  it('computes area with the shoelace formula regardless of winding', () => {
    const r = rect(0, 0, 10, 12.5);
    expect(polygonArea(r)).toBe(125);
    expect(signedArea(r)).toBe(125);
    expect(signedArea([...r].reverse())).toBe(-125);
  });

  it('handles an L-shaped dwelling', () => {
    const l: Point[] = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 6 },
      { x: 7, y: 6 },
      { x: 7, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(l)).toBe(12 * 6 + 7 * 4);
    expect(perimeter(l)).toBe(44);
    expect(perimeter(l, false)).toBe(34);
  });

  it('finds the centroid', () => {
    expect(centroid(rect(0, 0, 4, 2))).toEqual({ x: 2, y: 1 });
  });

  it('detects invalid polygons', () => {
    const bowtie: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ];
    expect(polygonProblems(bowtie)).toContain('self_intersecting');
    expect(
      polygonProblems([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual(['too_few_vertices']);
    expect(
      polygonProblems([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toContain('zero_area');
    expect(polygonProblems(rect(0, 0, 3, 3))).toEqual([]);
    expect(
      polygonProblems([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toEqual(['non_finite']);
  });

  it('tests point containment including boundary points', () => {
    const r = rect(0, 0, 10, 10);
    expect(pointInPolygon({ x: 5, y: 5 }, r)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 5 }, r)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 5 }, r)).toBe(false);
  });

  it('measures overlap, unions and coverage without double counting', () => {
    expect(intersectionArea(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBeCloseTo(25, 9);
    // rooms sharing a wall touch but do not overlap
    expect(intersectionArea(rect(0, 0, 5, 5), rect(5, 0, 5, 5))).toBeCloseTo(0, 9);
    expect(unionArea([rect(0, 0, 10, 10), rect(5, 5, 10, 10)])).toBeCloseTo(175, 9);
    expect(coveredArea(rect(0, 0, 10, 10), [rect(2, 2, 2, 2), rect(3, 3, 2, 2)])).toBeCloseTo(7, 9);
  });
});

describe('scale calibration', () => {
  const meta = {
    id: 'cal1',
    sourcePlanId: 'plan1',
    createdBy: 'u1',
    createdAt: '2026-10-02T00:00:00Z',
  };

  it('calibrates from two points and a known dimension', () => {
    const cal = calibrateTwoPoint({
      ...meta,
      p1: { x: 100, y: 100 },
      p2: { x: 600, y: 100 },
      knownDistanceM: 10,
    });
    expect(cal.metresPerUnit).toBeCloseTo(0.02, 12);
    expect(cal.status).toBe('unverified');
    expect(cal.estimatedRelativeError).toBeCloseTo(0.004, 12);
  });

  it('rejects calibration spans that are too short or distances that are implausible', () => {
    expect(() =>
      calibrateTwoPoint({ ...meta, p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, knownDistanceM: 5 }),
    ).toThrow(/too close/);
    expect(() =>
      calibrateTwoPoint({ ...meta, p1: { x: 0, y: 0 }, p2: { x: 500, y: 0 }, knownDistanceM: 0 }),
    ).toThrow(/known distance/);
  });

  it('calibrates from a stated drawing scale', () => {
    const cal = calibrateFromStatedScale({ ...meta, ratio: 100, dpi: 300 });
    // 1 px at 300 dpi = 0.0254/300 m on paper; × 100 on the ground
    expect(cal.metresPerUnit).toBeCloseTo(0.00846667, 7);
  });

  it('checks a second known dimension and confirms', () => {
    const cal = calibrateTwoPoint({
      ...meta,
      p1: { x: 0, y: 0 },
      p2: { x: 500, y: 0 },
      knownDistanceM: 10,
    });
    const check = checkCalibration(cal, { x: 0, y: 0 }, { x: 0, y: 302 }, 6);
    expect(check.withinTolerance).toBe(true);
    expect(check.measuredM).toBeCloseTo(6.04, 9);
    expect(checkCalibration(cal, { x: 0, y: 0 }, { x: 0, y: 330 }, 6).withinTolerance).toBe(false);
    const confirmed = confirmCalibration(cal, 'valuer1', '2026-10-02T01:00:00Z');
    expect(confirmed).toMatchObject({ status: 'confirmed', confirmedBy: 'valuer1' });
  });
});

describe('perspective correction', () => {
  it('maps a photographed quadrilateral onto a rectangle', () => {
    const src: Point[] = [
      { x: 10, y: 20 },
      { x: 410, y: 5 },
      { x: 430, y: 300 },
      { x: 0, y: 310 },
    ];
    const dst: Point[] = rect(0, 0, 400, 300);
    const h = computeHomography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(dst[i]!.x, 6);
      expect(q.y).toBeCloseTo(dst[i]!.y, 6);
    });
  });

  it('rejects degenerate reference points', () => {
    const collinear: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(() => computeHomography(collinear, rect(0, 0, 1, 1))).toThrow(/degenerate/);
  });
});

describe('sketch helpers', () => {
  it('snaps to grid, right angles and nearby vertices', () => {
    expect(snapToGrid({ x: 1.26, y: 3.74 }, 0.5)).toEqual({ x: 1.5, y: 3.5 });
    expect(snapAngle({ x: 0, y: 0 }, { x: 5, y: 0.3 })).toEqual({
      x: expect.closeTo(5.009, 3),
      y: 0,
    });
    expect(snapToVertex({ x: 4.98, y: 0.03 }, [{ x: 5, y: 0 }], 0.1)).toEqual({ x: 5, y: 0 });
    expect(snapToVertex({ x: 4.5, y: 0 }, [{ x: 5, y: 0 }], 0.1)).toEqual({ x: 4.5, y: 0 });
  });

  it('builds a closed polygon from wall lengths entered on site', () => {
    const r = polygonFromWalls([
      { lengthM: 12, direction: 'E' },
      { lengthM: 6, direction: 'N' },
      { lengthM: 5, direction: 'W' },
      { lengthM: 4, direction: 'N' },
      { lengthM: 7, direction: 'W' },
      { lengthM: 10, direction: 'S' },
    ]);
    expect(r.closed).toBe(true);
    expect(r.misclosureM).toBeCloseTo(0, 9);
    expect(polygonArea(r.points)).toBeCloseTo(100, 9);
  });

  it('reports misclosure and leaves the shape open', () => {
    const r = polygonFromWalls([
      { lengthM: 10, direction: 'E' },
      { lengthM: 8, direction: 'N' },
      { lengthM: 9.7, direction: 'W' },
      { lengthM: 8, direction: 'S' },
    ]);
    expect(r.closed).toBe(false);
    expect(r.misclosureM).toBeCloseTo(0.3, 9);
  });
});
