import { intersection, union } from 'polyclip-ts';
import { DomainError } from '../core/errors.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

type Ring = [number, number][];
type MultiPoly = Ring[][];

const EPS = 1e-9;

export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Shoelace formula. Positive for counter-clockwise rings (y up). */
export function signedArea(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

export const polygonArea = (points: readonly Point[]): number => Math.abs(signedArea(points));

export function perimeter(points: readonly Point[], closed = true): number {
  let total = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++)
    total += distance(points[i] as Point, points[(i + 1) % points.length] as Point);
  return total;
}

export function edgeLengths(points: readonly Point[], closed = true): number[] {
  const out: number[] = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++)
    out.push(distance(points[i] as Point, points[(i + 1) % points.length] as Point));
  return out;
}

export function centroid(points: readonly Point[]): Point {
  const a = signedArea(points);
  if (Math.abs(a) < EPS) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point;
    const q = points[(i + 1) % points.length] as Point;
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < EPS) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, c.x) - EPS <= b.x &&
    b.x <= Math.max(a.x, c.x) + EPS &&
    Math.min(a.y, c.y) - EPS <= b.y &&
    b.y <= Math.max(a.y, c.y) + EPS
  );
}

/** True if segments p1q1 and p2q2 share any point (including collinear overlap). */
export function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

export type PolygonProblem =
  'too_few_vertices' | 'duplicate_vertex' | 'zero_area' | 'self_intersecting' | 'non_finite';

/** Checks that a closed ring is a simple polygon (no self-intersections, non-zero area). */
export function polygonProblems(points: readonly Point[]): PolygonProblem[] {
  const problems: PolygonProblem[] = [];
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return ['non_finite'];
  if (points.length < 3) return ['too_few_vertices'];
  for (let i = 0; i < points.length; i++) {
    if (distance(points[i] as Point, points[(i + 1) % points.length] as Point) < EPS) {
      problems.push('duplicate_vertex');
      break;
    }
  }
  if (polygonArea(points) < EPS) problems.push('zero_area');
  const n = points.length;
  outer: for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // adjacent edges share a vertex by construction
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (
        segmentsIntersect(
          points[i] as Point,
          points[(i + 1) % n] as Point,
          points[j] as Point,
          points[(j + 1) % n] as Point,
        )
      ) {
        problems.push('self_intersecting');
        break outer;
      }
    }
  }
  return problems;
}

/** Ray-casting point-in-polygon test (boundary points count as inside). */
export function pointInPolygon(p: Point, ring: readonly Point[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    if (orientation(a, p, b) === 0 && onSegment(a, p, b)) return true;
  }
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

function toRing(points: readonly Point[]): Ring {
  if (points.length < 3)
    throw new DomainError('GEOMETRY_INVALID', 'a polygon needs at least three vertices');
  const ring: Ring = points.map((p) => [p.x, p.y]);
  const first = ring[0] as [number, number];
  ring.push([first[0], first[1]]);
  return ring;
}

function ringArea(ring: Ring): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as [number, number];
    const b = ring[i + 1] as [number, number];
    total += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(total / 2);
}

/** Area of a multipolygon (outer rings minus holes). */
export function multiPolygonArea(mp: MultiPoly): number {
  let total = 0;
  for (const poly of mp) {
    poly.forEach((ring, idx) => {
      total += idx === 0 ? ringArea(ring) : -ringArea(ring);
    });
  }
  return total;
}

/** Area shared by two simple polygons (0 when they only touch along an edge). */
export function intersectionArea(a: readonly Point[], b: readonly Point[]): number {
  return multiPolygonArea(intersection([toRing(a)], [toRing(b)]));
}

/** Area covered by the union of polygons (overlaps counted once). */
export function unionArea(polygons: readonly (readonly Point[])[]): number {
  if (polygons.length === 0) return 0;
  const [first, ...rest] = polygons.map((p) => [toRing(p)]);
  return multiPolygonArea(union(first as Ring[], ...rest));
}

/** Area of `subject` covered by the union of `clips`. */
export function coveredArea(
  subject: readonly Point[],
  clips: readonly (readonly Point[])[],
): number {
  if (clips.length === 0) return 0;
  const [first, ...rest] = clips.map((p) => [toRing(p)]);
  const merged = union(first as Ring[], ...rest);
  return multiPolygonArea(intersection([toRing(subject)], merged));
}

export function scalePoints(points: readonly Point[], factor: number): Point[] {
  return points.map((p) => ({ x: p.x * factor, y: p.y * factor }));
}
