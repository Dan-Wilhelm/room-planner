/**
 * Small 2D vector helpers (plan coordinates in cm, x east, y north).
 * Pure functions, no allocation-heavy abstractions.
 */
import type { Point } from "@/lib/types";

export const EPS = 1e-9;

export const pt = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
/** z-component of the 2D cross product a × b. */
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const midpoint = (a: Point, b: Point): Point => lerp(a, b, 0.5);

export function normalize(a: Point): Point {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rotate a vector CLOCKWISE (seen from above, y up) by `deg` degrees. */
export function rotateCw(v: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c };
}

/** Closest point on segment ab to p. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < EPS) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). Scalar version for hot loops. */
export function distPointSegXY(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 < EPS ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.sqrt(dx * dx + dy * dy);
}

export function distPointSegment(p: Point, a: Point, b: Point): number {
  return distPointSegXY(p.x, p.y, a.x, a.y, b.x, b.y);
}

/**
 * Ray (origin o, unit direction d) vs segment ab. Returns the distance along the ray to the
 * hit, or null if there is none.
 */
export function raySegment(o: Point, d: Point, a: Point, b: Point): number | null {
  const e = sub(b, a);
  const denom = cross(d, e);
  if (Math.abs(denom) < EPS) return null; // parallel
  const ao = sub(a, o);
  const t = cross(ao, e) / denom;
  const u = cross(ao, d) / denom;
  if (t < -EPS || u < -EPS || u > 1 + EPS) return null;
  return Math.max(0, t);
}

/** Bearing-style angle helpers. */
export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;
export const normDeg = (d: number): number => ((d % 360) + 360) % 360;
