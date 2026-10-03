import { DomainError } from '../core/errors.js';
import type { Point } from './polygon.js';
import { distance } from './polygon.js';

/** Snaps a point to the nearest grid intersection. */
export function snapToGrid(p: Point, grid: number): Point {
  if (!(grid > 0)) throw new DomainError('INVALID_ARGUMENT', 'grid size must be positive');
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** Keeps the segment length but rounds its direction to the nearest `stepDeg` (90 = right angles). */
export function snapAngle(from: Point, to: Point, stepDeg = 90): Point {
  const len = distance(from, to);
  if (len === 0) return to;
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  const x = from.x + len * Math.cos(angle);
  const y = from.y + len * Math.sin(angle);
  // Clean floating noise so axis-aligned walls stay exactly axis-aligned.
  return { x: Math.round(x * 1e9) / 1e9, y: Math.round(y * 1e9) / 1e9 };
}

/** Snaps to an existing vertex within `tolerance`, otherwise returns the point unchanged. */
export function snapToVertex(p: Point, vertices: readonly Point[], tolerance: number): Point {
  let best: Point | undefined;
  let bestDist = tolerance;
  for (const v of vertices) {
    const d = distance(p, v);
    if (d <= bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best ?? p;
}

export type Direction = 'N' | 'E' | 'S' | 'W' | 'NE' | 'SE' | 'SW' | 'NW';
const DIRECTION_BEARINGS: Readonly<Record<Direction, number>> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export interface WallSegment {
  readonly lengthM: number;
  /** Compass direction or bearing in degrees clockwise from north (sketch "up"). */
  readonly direction: Direction | number;
}

export interface WallPolygon {
  readonly points: Point[];
  /** Distance between the end of the last wall and the start point. */
  readonly misclosureM: number;
  readonly closed: boolean;
}

/**
 * Builds a polygon from wall lengths entered on site ("4.2 m east, 3.6 m north, …").
 * A misclosure above `closeTolerance` leaves the shape open so the user must correct it.
 */
export function polygonFromWalls(
  segments: readonly WallSegment[],
  start: Point = { x: 0, y: 0 },
  closeTolerance = 0.05,
): WallPolygon {
  if (segments.length < 3)
    throw new DomainError('GEOMETRY_INVALID', 'at least three walls are required');
  const points: Point[] = [start];
  let cur = start;
  for (const s of segments) {
    if (!(s.lengthM > 0))
      throw new DomainError('GEOMETRY_INVALID', 'wall lengths must be positive');
    const bearing = typeof s.direction === 'number' ? s.direction : DIRECTION_BEARINGS[s.direction];
    const rad = (bearing * Math.PI) / 180;
    cur = {
      x: Math.round((cur.x + s.lengthM * Math.sin(rad)) * 1e9) / 1e9,
      y: Math.round((cur.y + s.lengthM * Math.cos(rad)) * 1e9) / 1e9,
    };
    points.push(cur);
  }
  const misclosureM = distance(cur, start);
  const closed = misclosureM <= closeTolerance;
  if (closed) points.pop();
  return { points, misclosureM, closed };
}
