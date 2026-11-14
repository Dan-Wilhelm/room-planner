/**
 * Pure plan-space geometry for the 3D room view (no three.js imports).
 * Units: centimetres in plan space (x east, y north), see src/lib/types.ts.
 */
import type { Point, RoomModel, Slope } from "@/lib/types";

export interface WallInfo {
  index: number; // 1-based Wi
  a: Point;
  b: Point;
  length: number;
  ux: number; // unit direction a→b
  uy: number;
  nx: number; // unit normal pointing into the room
  ny: number;
}

export interface SlopeInfo {
  slope: Slope;
  wall: WallInfo;
  knee: number;
  base: number;
  full: number;
}

export interface RoomAnalysis {
  valid: boolean;
  corners: Point[];
  clockwise: boolean;
  walls: WallInfo[];
  slopes: SlopeInfo[];
  base: number; // full ceiling height (cm)
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
  center: Point;
}

const EPS = 1e-6;

export function signedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function analyzeRoom(room: RoomModel | null | undefined): RoomAnalysis {
  const base = room && finite(room.ceilingHeight) && room.ceilingHeight > 10 ? room.ceilingHeight : 250;
  const empty: RoomAnalysis = {
    valid: false,
    corners: [],
    clockwise: true,
    walls: [],
    slopes: [],
    base,
    bbox: { minX: 0, maxX: 400, minY: 0, maxY: 400 },
    center: { x: 200, y: 200 },
  };
  const raw = room?.corners;
  if (!Array.isArray(raw) || raw.length < 3) return empty;
  if (!raw.every((p) => p && finite(p.x) && finite(p.y))) return empty;
  const corners = raw.map((p) => ({ x: p.x, y: p.y }));
  const area = signedArea(corners);
  if (Math.abs(area) < 1) return empty;
  const clockwise = area < 0; // y points north → clockwise from above has negative signed area

  const walls: WallInfo[] = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const ux = length > EPS ? dx / length : 1;
    const uy = length > EPS ? dy / length : 0;
    const nx = clockwise ? uy : -uy;
    const ny = clockwise ? -ux : ux;
    return { index: i + 1, a, b, length, ux, uy, nx, ny };
  });

  const slopes: SlopeInfo[] = [];
  for (const s of room?.slopes ?? []) {
    if (!s || !finite(s.wallIndex) || !finite(s.kneeWallHeight) || !finite(s.fullHeightDistance)) continue;
    const wall = walls[s.wallIndex - 1];
    if (!wall || wall.length < 1) continue;
    const knee = Math.max(0, s.kneeWallHeight);
    if (knee >= base - 0.5 || s.fullHeightDistance <= 1) continue;
    slopes.push({ slope: s, wall, knee, base, full: s.fullHeightDistance });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return {
    valid: true,
    corners,
    clockwise,
    walls,
    slopes,
    base,
    bbox: { minX, maxX, minY, maxY },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/** Signed perpendicular distance from the slope's wall line, positive into the room. */
export function slopeDistance(si: SlopeInfo, x: number, y: number): number {
  return (x - si.wall.a.x) * si.wall.nx + (y - si.wall.a.y) * si.wall.ny;
}

/** Unclamped linear ceiling height of the slope plane at (x, y). */
export function slopePlaneHeight(si: SlopeInfo, x: number, y: number): number {
  return si.knee + ((si.base - si.knee) * slopeDistance(si, x, y)) / si.full;
}

/** Ceiling height in cm at plan point (x, y): min over slopes and the base height. */
export function ceilingHeightAt(ra: RoomAnalysis, x: number, y: number): number {
  let h = ra.base;
  for (const si of ra.slopes) {
    const d = Math.max(0, slopeDistance(si, x, y));
    if (d < si.full) h = Math.min(h, si.knee + ((si.base - si.knee) * d) / si.full);
  }
  return h;
}

/** Top profile of a wall: points (s along the wall in cm, height in cm), s from 0 to length. */
export function wallTopProfile(ra: RoomAnalysis, wall: WallInfo): { s: number; h: number }[] {
  const L = wall.length;
  const at = (s: number) => ceilingHeightAt(ra, wall.a.x + wall.ux * s, wall.a.y + wall.uy * s);
  const cand = new Set<number>([0, L]);
  // d(s) = d0 + k s for each slope
  const lin = ra.slopes.map((si) => ({
    si,
    d0: slopeDistance(si, wall.a.x, wall.a.y),
    k: wall.ux * si.wall.nx + wall.uy * si.wall.ny,
  }));
  for (const { si, d0, k } of lin) {
    if (Math.abs(k) < EPS) continue;
    for (const target of [0, si.full]) {
      const s = (target - d0) / k;
      if (s > 0 && s < L) cand.add(s);
    }
  }
  // kinks where two slope planes intersect
  for (let i = 0; i < lin.length; i++) {
    for (let j = i + 1; j < lin.length; j++) {
      const A = lin[i];
      const B = lin[j];
      const ga = (A.si.base - A.si.knee) / A.si.full;
      const gb = (B.si.base - B.si.knee) / B.si.full;
      // A.knee + ga (d0a + ka s) = B.knee + gb (d0b + kb s)
      const den = ga * A.k - gb * B.k;
      if (Math.abs(den) < EPS) continue;
      const s = (B.si.knee + gb * B.d0 - A.si.knee - ga * A.d0) / den;
      if (s > 0 && s < L) cand.add(s);
    }
  }
  const pts = [...cand].sort((p, q) => p - q).map((s) => ({ s, h: at(s) }));
  // drop near-duplicates and collinear points
  const out: { s: number; h: number }[] = [];
  for (const p of pts) {
    if (out.length && p.s - out[out.length - 1].s < 0.05) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const cross = (b.s - a.s) * (p.h - a.h) - (b.h - a.h) * (p.s - a.s);
      if (Math.abs(cross) < 1e-3) out.pop();
      else break;
    }
    out.push(p);
  }
  if (out[out.length - 1].s < L) out.push({ s: L, h: at(L) });
  return out;
}

export function profileMinBetween(profile: { s: number; h: number }[], s0: number, s1: number): number {
  const hAt = (s: number) => {
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i];
      const b = profile[i + 1];
      if (s >= a.s && s <= b.s) {
        const t = b.s - a.s > EPS ? (s - a.s) / (b.s - a.s) : 0;
        return a.h + (b.h - a.h) * t;
      }
    }
    return profile[profile.length - 1]?.h ?? 0;
  };
  let m = Math.min(hAt(s0), hAt(s1));
  for (const p of profile) if (p.s > s0 && p.s < s1) m = Math.min(m, p.h);
  return m;
}

/** Sutherland–Hodgman clip: keep the part where a·x + b·y + c ≥ 0. */
export function clipHalfPlane(poly: Point[], a: number, b: number, c: number): Point[] {
  if (poly.length === 0) return poly;
  const out: Point[] = [];
  const f = (p: Point) => a * p.x + b * p.y + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  // remove consecutive duplicates
  const clean: Point[] = [];
  for (const p of out) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.01) clean.push(p);
  }
  if (clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) <= 0.01)
    clean.pop();
  return clean.length >= 3 && Math.abs(signedArea(clean)) > 0.5 ? clean : [];
}

/** Half-plane coefficients for slopeDistance(si) - k ≥ 0 (sign = +1) or k - d ≥ 0 (sign = -1). */
function distanceHalfPlane(si: SlopeInfo, k: number, sign: 1 | -1): [number, number, number] {
  const { nx, ny, a } = si.wall;
  const c = -(a.x * nx + a.y * ny) - k;
  return [sign * nx, sign * ny, sign * c];
}

/** Plan region (cm) where slope `si` forms the ceiling. */
export function slopeRegion(ra: RoomAnalysis, si: SlopeInfo): Point[] {
  let poly = ra.corners.slice();
  poly = clipHalfPlane(poly, ...distanceHalfPlane(si, 0, 1));
  poly = clipHalfPlane(poly, ...distanceHalfPlane(si, si.full, -1));
  const gs = (si.base - si.knee) / si.full;
  for (const t of ra.slopes) {
    if (t === si || poly.length === 0) continue;
    const gt = (t.base - t.knee) / t.full;
    // L_t - L_s ≥ 0, with L(p) = knee + g (n·p - n·a)
    const a = gt * t.wall.nx - gs * si.wall.nx;
    const b = gt * t.wall.ny - gs * si.wall.ny;
    const c =
      t.knee - gt * (t.wall.nx * t.wall.a.x + t.wall.ny * t.wall.a.y) - (si.knee - gs * (si.wall.nx * si.wall.a.x + si.wall.ny * si.wall.a.y));
    poly = clipHalfPlane(poly, a, b, c);
  }
  return poly;
}

/** Plan region (cm) where the ceiling is flat at base height. */
export function flatCeilingRegion(ra: RoomAnalysis): Point[] {
  let poly = ra.corners.slice();
  for (const si of ra.slopes) {
    if (poly.length === 0) break;
    poly = clipHalfPlane(poly, ...distanceHalfPlane(si, si.full, 1));
  }
  return poly;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** Offsets a simple polygon outward (away from the interior) by `dist` with mitred corners. */
export function offsetPolygon(ra: RoomAnalysis, dist: number): Point[] {
  const n = ra.walls.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ra.walls[(i - 1 + n) % n];
    const next = ra.walls[i];
    const corner = ra.corners[i];
    // outward normals
    const p1 = { x: -prev.nx, y: -prev.ny };
    const p2 = { x: -next.nx, y: -next.ny };
    let mx = p1.x + p2.x;
    let my = p1.y + p2.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) {
      mx = p1.x;
      my = p1.y;
    } else {
      mx /= ml;
      my /= ml;
    }
    const cos = mx * p1.x + my * p1.y;
    const k = Math.min(dist / Math.max(cos, 0.25), dist * 4);
    out.push({ x: corner.x + mx * k, y: corner.y + my * k });
  }
  return out;
}

/** Tiny deterministic PRNG from a string seed. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
