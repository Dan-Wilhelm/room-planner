/**
 * Polygon helpers. Coordinates are y-up (x east, y north), so a polygon listed clockwise seen
 * from above has a NEGATIVE signed shoelace area.
 */
import type { Point } from "@/lib/types";
import { EPS, cross, dist, distPointSegment, dot, sub } from "./vec";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Signed shoelace area in cm². Positive = counter-clockwise, negative = clockwise (y up). */
export function signedArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonAreaCm2(poly: Point[]): number {
  return Math.abs(signedArea(poly));
}

export function polygonAreaM2(poly: Point[]): number {
  return polygonAreaCm2(poly) / 10000;
}

/** Clockwise as seen from above (y-up) ⇔ negative signed shoelace area. */
export function isClockwise(poly: Point[]): boolean {
  return signedArea(poly) < 0;
}

/** Returns a clockwise copy; keeps C0 as the first corner when it has to reverse. */
export function ensureClockwise(poly: Point[]): Point[] {
  if (poly.length < 3 || isClockwise(poly)) return poly.map((p) => ({ ...p }));
  const [first, ...rest] = poly;
  return [{ ...first }, ...rest.reverse().map((p) => ({ ...p }))];
}

export function polygonBounds(poly: Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function polygonCentroid(poly: Point[]): Point {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function orient(a: Point, b: Point, c: Point): number {
  const v = cross(sub(b, a), sub(c, a));
  return Math.abs(v) < 1e-7 ? 0 : v > 0 ? 1 : -1;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) - 1e-7 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-7 &&
    Math.min(a.y, b.y) - 1e-7 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-7
  );
}

/**
 * True if segments p1p2 and p3p4 share at least one point (touching and collinear overlap count).
 * With `proper: true` only true crossings (interiors cross at a single point) count.
 */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point, opts?: { proper?: boolean }): boolean {
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  if (opts?.proper) return o1 * o2 < 0 && o3 * o4 < 0;
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
}

/** Minimum distance between two segments. */
export function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointSegment(a1, b1, b2),
    distPointSegment(a2, b1, b2),
    distPointSegment(b1, a1, a2),
    distPointSegment(b2, a1, a2),
  );
}

/** Ray-casting point-in-polygon (works for any simple polygon, either orientation). */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  return pointInPolygonXY(p.x, p.y, poly);
}

export function pointInPolygonXY(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from p to the nearest polygon edge. */
export function distanceToPolygonEdges(p: Point, poly: Point[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < m) m = d;
  }
  return m;
}

/** Remove duplicate points and points lying on a straight line between their neighbours. */
export function mergeCollinear(points: Point[]): Point[] {
  let pts = points.map((p) => ({ x: p.x, y: p.y }));
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (dist(prev, cur) < 1e-6) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      const d1 = sub(cur, prev);
      const d2 = sub(next, cur);
      if (Math.abs(cross(d1, d2)) < 1e-6 * Math.max(1, Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)) && dot(d1, d2) > 0) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  pts = pts.map((p) => ({ x: clean(p.x), y: clean(p.y) }));
  return pts;
}

function clean(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-6 ? r + 0 : v; // "+ 0" turns -0 into 0
}

export interface PolygonValidation {
  ok: boolean;
  errors: string[];
  areaM2: number;
  clockwise: boolean;
}

/**
 * Checks a room outline: ≥ 3 corners, finite numbers, no zero-length walls, no self-intersection,
 * non-zero area. The polygon is closed by definition (last wall returns to C0).
 * Orientation is reported via `clockwise` but is not an error (see ensureClockwise).
 */
export function validatePolygon(corners: Point[]): PolygonValidation {
  const errors: string[] = [];
  const n = corners.length;
  if (n < 3) {
    return { ok: false, errors: ["A room needs at least 3 corners."], areaM2: 0, clockwise: false };
  }
  if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { ok: false, errors: ["Some corner coordinates are not valid numbers."], areaM2: 0, clockwise: false };
  }
  // zero-length walls
  const zero = new Set<number>();
  for (let i = 1; i <= n; i++) {
    const a = corners[i - 1];
    const b = corners[i % n];
    if (dist(a, b) < 0.5) {
      zero.add(i);
      errors.push(`Wall W${i} has zero length (corners C${i - 1} and C${i % n} are in the same place).`);
    }
  }
  // self-intersection
  if (zero.size === 0) {
    for (let i = 1; i <= n; i++) {
      const a1 = corners[i - 1];
      const a2 = corners[i % n];
      for (let j = i + 1; j <= n; j++) {
        const b1 = corners[j - 1];
        const b2 = corners[j % n];
        const adjacent = j === i + 1 || (i === 1 && j === n);
        if (adjacent) {
          // they share one corner; error only if they fold back onto each other
          const da = sub(a2, a1);
          const db = sub(b2, b1);
          if (Math.abs(cross(da, db)) < 1e-6 * Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y) && dot(da, db) < 0) {
            errors.push(`Walls W${i} and W${j} fold back onto each other.`);
          }
          continue;
        }
        if (segmentsIntersect(a1, a2, b1, b2)) {
          errors.push(`Walls W${i} and W${j} cross or touch each other — the outline intersects itself.`);
        }
      }
    }
  }
  const areaM2 = polygonAreaM2(corners);
  if (areaM2 < 1e-4) errors.push("The room outline has no area.");
  return { ok: errors.length === 0, errors, areaM2, clockwise: isClockwise(corners) };
}

/**
 * Separating-axis test for two CONVEX polygons. Shapes that merely touch (overlap ≤ eps cm)
 * do not count as overlapping.
 */
export function polygonsOverlap(a: Point[], b: Point[], eps = 0.5): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      let ax = -(q.y - p.y);
      let ay = q.x - p.x;
      const l = Math.hypot(ax, ay);
      if (l < EPS) continue;
      ax /= l;
      ay /= l;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const v of a) {
        const s = v.x * ax + v.y * ay;
        if (s < minA) minA = s;
        if (s > maxA) maxA = s;
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of b) {
        const s = v.x * ax + v.y * ay;
        if (s < minB) minB = s;
        if (s > maxB) maxB = s;
      }
      if (maxA - minB <= eps || maxB - minA <= eps) return false;
    }
  }
  return true;
}

/** Inside test for a convex polygon (either orientation). Boundary counts as inside. */
export function pointInConvex(p: Point, poly: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * True if the CONVEX polygon `inner` lies completely inside the simple polygon `outer`
 * (which may be non-convex). Touching the boundary and poking out by up to `tol` cm is allowed.
 */
export function polygonInsidePolygon(inner: Point[], outer: Point[], tol = 0.5): boolean {
  if (inner.length === 0) return true;
  const c = polygonCentroid(inner);
  const shrunk = inner.map((v) => {
    const d = dist(v, c);
    if (d <= tol + EPS) return { x: c.x, y: c.y };
    const f = (d - tol) / d;
    return { x: c.x + (v.x - c.x) * f, y: c.y + (v.y - c.y) * f };
  });
  for (const v of shrunk) if (!pointInPolygon(v, outer)) return false;
  for (let i = 0; i < shrunk.length; i++) {
    const a = shrunk[i];
    const b = shrunk[(i + 1) % shrunk.length];
    for (let j = 0; j < outer.length; j++) {
      if (segmentsIntersect(a, b, outer[j], outer[(j + 1) % outer.length])) return false;
    }
  }
  return true;
}
