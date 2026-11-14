/**
 * Deterministic design checks (collisions, headroom, walkways, door swing, radiators, windows,
 * ventilation gaps, sockets). Pure TS, no React. Typical rooms run in a few milliseconds.
 */
import type { DesignWarning, ItemCategory, PlacedItem, Point, RoomModel, WallFeature } from "@/lib/types";
import { POWERED_CATEGORIES } from "@/lib/types";
import { minCeilingOverFootprint, slopeDistanceForHeight } from "./ceiling";
import { itemFootprint, itemSide, itemVerticalRange, type ItemSideName } from "./items";
import {
  pointInConvex,
  pointInPolygonXY,
  polygonBounds,
  polygonInsidePolygon,
  polygonsOverlap,
  segmentDistance,
} from "./polygon";
import { allWalls, featureSegment, wallSegment, type WallSegment } from "./walls";
import { add, dist, distPointSegXY, dot, midpoint, normalize, raySegment, scale, sub } from "./vec";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum headroom for walking areas (cm). */
export const WALK_HEADROOM = 190;
/** Walkway grid cell size (cm). */
export const WALK_CELL = 5;
export const WALKWAY_MIN = 80;
export const MAIN_WALKWAY_MIN = 90;
export const BED_SIDE_MIN = 60;
export const RADIATOR_CLEARANCE = 20;
export const WINDOW_CLEARANCE = 30;
export const WALL_GAP_MIN = 5;
export const SOCKET_MAX_DISTANCE = 150;

const NON_SPATIAL = new Set<ItemCategory>(["paint", "material", "cushion", "throw"]);
const TALL_FOR_GAP = new Set<ItemCategory>(["wardrobe", "shelf", "dresser"]);
const TARGET_CATS = new Set<ItemCategory>(["bed", "desk", "wardrobe", "dresser", "shelf", "sofa"]);
const WINDOW_TEXTILE = new Set<ItemCategory>(["curtain", "blind"]);
const SEATING_MOVABLE = new Set<ItemCategory>(["chair", "deskChair"]);

const SEVERITY_ORDER: Record<DesignWarning["severity"], number> = { error: 0, warning: 1, hint: 2 };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Geo {
  item: PlacedItem;
  fp: Point[];
  bottom: number;
  top: number;
  /** wall-/ceiling-mounted or lifted (z > 0), not resting on another item */
  elevated: boolean;
  /** stackedOn set or mount "onTop" */
  stacked: boolean;
  /** stands on the floor */
  floor: boolean;
}

interface Ctx {
  room: RoomModel;
  items: PlacedItem[];
  poly: Point[];
  walls: WallSegment[];
  geos: Geo[];
  byId: Map<string, Geo>;
  builtIns: { feature: WallFeature; poly: Point[] }[];
}

function buildCtx(room: RoomModel, items: PlacedItem[]): Ctx {
  const geos: Geo[] = [];
  const byId = new Map<string, Geo>();
  for (const item of items) {
    if (NON_SPATIAL.has(item.category)) continue;
    if (!(item.w > 0 && item.d > 0)) continue;
    const { bottom, top } = itemVerticalRange(room, items, item);
    const stacked = !!item.stackedOn || item.mount === "onTop";
    const elevated = !stacked && (item.mount === "wall" || item.mount === "ceiling" || bottom > 0.5);
    const g: Geo = { item, fp: itemFootprint(item), bottom, top, elevated, stacked, floor: !stacked && !elevated };
    geos.push(g);
    byId.set(item.id, g);
  }
  const builtIns: Ctx["builtIns"] = [];
  for (const f of room.wallFeatures ?? []) {
    if (f.kind !== "builtIn" || !(f.depth && f.depth > 0)) continue;
    if (f.wallIndex < 1 || f.wallIndex > room.corners.length) continue;
    const w = wallSegment(room, f.wallIndex);
    const s = featureSegment(room, f);
    const off = scale(w.inwardNormal, f.depth);
    builtIns.push({ feature: f, poly: [s.a, s.b, add(s.b, off), add(s.a, off)] });
  }
  return { room, items, poly: room.corners, walls: allWalls(room), geos, byId, builtIns };
}

function humanize(category: string): string {
  return category.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function nameOf(item: PlacedItem): string {
  const l = item.label?.trim();
  return l && l.length > 0 ? l : humanize(item.category);
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

const r0 = (v: number) => Math.round(v);

function isFlatRug(i: PlacedItem): boolean {
  return i.category === "rug" && i.h <= 2;
}

function validFeature(room: RoomModel, f: WallFeature): boolean {
  return f.wallIndex >= 1 && f.wallIndex <= room.corners.length && f.width > 0;
}

/** Rectangle in front of a wall feature, from depth s0 to s1 (cm, into the room). */
function bandInFront(room: RoomModel, f: WallFeature, s0: number, s1: number): Point[] {
  const w = wallSegment(room, f.wallIndex);
  const s = featureSegment(room, f);
  return [add(s.a, scale(w.inwardNormal, s0)), add(s.b, scale(w.inwardNormal, s0)), add(s.b, scale(w.inwardNormal, s1)), add(s.a, scale(w.inwardNormal, s1))];
}

/** Quarter-circle keep-out of an inward-opening door, as a convex polygon. */
export function doorSwingPolygon(room: RoomModel, door: WallFeature, steps = 16): Point[] {
  const w = wallSegment(room, door.wallIndex);
  const s = featureSegment(room, door);
  const hingeAtEnd = door.hinge === "end";
  const hinge = hingeAtEnd ? s.b : s.a;
  const other = hingeAtEnd ? s.a : s.b;
  const u = normalize(sub(other, hinge));
  const n = w.inwardNormal;
  const R = door.width;
  const pts: Point[] = [hinge];
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * (Math.PI / 2);
    pts.push(add(hinge, add(scale(u, R * Math.cos(t)), scale(n, R * Math.sin(t)))));
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Item-level rules
// ---------------------------------------------------------------------------

function ruleOutside(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  for (const g of subset) {
    const tol = g.elevated || g.stacked ? 2 : 0.5;
    if (!polygonInsidePolygon(g.fp, ctx.poly, tol)) {
      out.push({ code: "outside", severity: "error", itemIds: [g.item.id], message: `${cap(nameOf(g.item))} sticks out of the room — it does not fit at this position.` });
    }
  }
  return out;
}

function overlapExempt(a: Geo, b: Geo): boolean {
  if (a.stacked || b.stacked) return true;
  if (isFlatRug(a.item) || isFlatRug(b.item)) return true;
  if (WINDOW_TEXTILE.has(a.item.category) || WINDOW_TEXTILE.has(b.item.category)) return true;
  // vertical ranges that do not intersect (wall shelf above a desk, pendant above a table…)
  if (a.top <= b.bottom + 0.5 || b.top <= a.bottom + 0.5) return true;
  return false;
}

function ruleOverlap(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  const seen = new Set<string>();
  for (const a of subset) {
    for (const b of ctx.geos) {
      if (a === b) continue;
      const key = a.item.id < b.item.id ? `${a.item.id}|${b.item.id}` : `${b.item.id}|${a.item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (overlapExempt(a, b)) continue;
      if (polygonsOverlap(a.fp, b.fp, 0.5)) {
        const [first, second] = ctx.geos.indexOf(b) < ctx.geos.indexOf(a) ? [b, a] : [a, b];
        out.push({
          code: "overlap",
          severity: "error",
          itemIds: [first.item.id, second.item.id],
          message: `${cap(nameOf(first.item))} and ${nameOf(second.item)} overlap.`,
        });
      }
    }
    if (a.stacked || isFlatRug(a.item) || WINDOW_TEXTILE.has(a.item.category)) continue;
    for (const bi of ctx.builtIns) {
      const bz = bi.feature.z ?? 0;
      if (a.top <= bz + 0.5 || a.bottom >= bz + bi.feature.height - 0.5) continue;
      if (polygonsOverlap(a.fp, bi.poly, 0.5)) {
        const what = bi.feature.label ? `the ${bi.feature.label}` : "the built-in";
        out.push({ code: "overlap", severity: "error", itemIds: [a.item.id], message: `${cap(nameOf(a.item))} overlaps ${what} on wall W${bi.feature.wallIndex}.` });
      }
    }
  }
  return out;
}

function ruleHeadroom(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  for (const g of subset) {
    if (g.item.mount === "ceiling") continue;
    const minC = minCeilingOverFootprint(ctx.room, g.fp);
    if (g.top > minC + 0.5) {
      const sloped = minC < ctx.room.ceilingHeight - 0.5;
      const ceil = sloped ? "the sloped ceiling" : "the ceiling";
      const msg =
        g.bottom > 0.5
          ? `${cap(nameOf(g.item))} reaches ${r0(g.top)} cm high but ${ceil} is only ${r0(minC)} cm high there.`
          : `${cap(nameOf(g.item))} is ${r0(g.item.h)} cm tall but ${ceil} is only ${r0(minC)} cm above it.`;
      out.push({ code: "headroom", severity: "error", itemIds: [g.item.id], message: msg });
    }
  }
  return out;
}

function ruleDoorSwing(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  for (const door of ctx.room.wallFeatures ?? []) {
    if (door.kind !== "door" || door.opens === "outward" || !validFeature(ctx.room, door)) continue;
    const swing = doorSwingPolygon(ctx.room, door);
    for (const g of subset) {
      if (!g.floor || WINDOW_TEXTILE.has(g.item.category)) continue;
      if (g.item.category === "rug") {
        if (g.item.h > 1 && polygonsOverlap(g.fp, swing, 0.5)) {
          out.push({ code: "doorSwing", severity: "warning", itemIds: [g.item.id], message: `${cap(nameOf(g.item))} is ${g.item.h} cm thick and lies in the door's swing area — the door may catch on it.` });
        }
        continue;
      }
      if (polygonsOverlap(g.fp, swing, 0.5)) {
        out.push({ code: "doorSwing", severity: "warning", itemIds: [g.item.id], message: `${cap(nameOf(g.item))} stands in the swing area of the door on W${door.wallIndex} — the door cannot open fully.` });
      }
    }
  }
  return out;
}

function ruleRadiator(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  for (const rad of ctx.room.wallFeatures ?? []) {
    if (rad.kind !== "radiator" || !validFeature(ctx.room, rad)) continue;
    const band = bandInFront(ctx.room, rad, 0, RADIATOR_CLEARANCE);
    const curtainBand = bandInFront(ctx.room, rad, -5, 25);
    const radTop = (rad.z ?? 0) + rad.height;
    for (const g of subset) {
      const c = g.item.category;
      if (c === "curtain") {
        if (g.bottom < radTop - 0.5 && polygonsOverlap(g.fp, curtainBand, 0.5)) {
          out.push({ code: "radiator", severity: "warning", itemIds: [g.item.id], message: `${cap(nameOf(g.item))} would cover the radiator (it ends ${r0(g.bottom)} cm above the floor, the radiator top is at ${r0(radTop)} cm) — heat gets trapped behind it.` });
        }
        continue;
      }
      if (!g.floor || c === "rug" || c === "blind") continue;
      if (polygonsOverlap(g.fp, band, 0.5)) {
        out.push({ code: "radiator", severity: "warning", itemIds: [g.item.id], message: `${cap(nameOf(g.item))} stands within ${RADIATOR_CLEARANCE} cm in front of the radiator on W${rad.wallIndex} — keep that space free so the heat can circulate.` });
      }
    }
  }
  return out;
}

function ruleWindow(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  for (const win of ctx.room.wallFeatures ?? []) {
    if (win.kind !== "window" || !validFeature(ctx.room, win)) continue;
    const band = bandInFront(ctx.room, win, 0, WINDOW_CLEARANCE);
    const sill = win.z ?? 0;
    const winTop = sill + win.height;
    for (const g of subset) {
      const c = g.item.category;
      if (WINDOW_TEXTILE.has(c) || c === "rug" || g.stacked || g.item.mount === "ceiling" || SEATING_MOVABLE.has(c)) continue;
      if (c === "plant" && g.item.h <= 60) continue;
      if (g.top <= sill + 0.5 || g.bottom >= winTop - 0.5) continue;
      if (polygonsOverlap(g.fp, band, 0.5)) {
        out.push({ code: "window", severity: "warning", itemIds: [g.item.id], message: `${cap(nameOf(g.item))} (${r0(g.top)} cm high) stands right in front of the window on W${win.wallIndex} (sill at ${r0(sill)} cm) — it blocks light and the window cannot be opened fully.` });
      }
    }
  }
  return out;
}

function ruleWallGap(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  for (const g of subset) {
    const c = g.item.category;
    if (!g.floor) continue;
    const isBed = c === "bed";
    if (!TALL_FOR_GAP.has(c) && !isBed) continue;
    const edges: [Point, Point][] = [];
    if (isBed) {
      const back = itemSide(g.item, "back");
      edges.push([back.a, back.b]);
    } else {
      for (let i = 0; i < 4; i++) edges.push([g.fp[i], g.fp[(i + 1) % 4]]);
    }
    let dMin = Infinity;
    for (const [a, b] of edges) for (const w of ctx.walls) dMin = Math.min(dMin, segmentDistance(a, b, w.a, w.b));
    const subject = isBed ? `${cap(nameOf(g.item))} (headboard side)` : cap(nameOf(g.item));
    if (dMin < WALL_GAP_MIN - 0.01) {
      out.push({ code: "wallGap", severity: "hint", itemIds: [g.item.id], message: `${subject} is only ${r0(dMin)} cm from the wall — leave 5–10 cm for ventilation (mould prevention).` });
      continue;
    }
    if (ctx.room.slopes?.length) {
      const minC = minCeilingOverFootprint(ctx.room, g.fp);
      if (minC < ctx.room.ceilingHeight - 0.5) {
        out.push({ code: "wallGap", severity: "hint", itemIds: [g.item.id], message: `${subject} stands under the sloped ceiling — leave 5–10 cm for ventilation (mould prevention).` });
      }
    }
  }
  return out;
}

function ruleSocket(ctx: Ctx, subset: Geo[]): DesignWarning[] {
  const out: DesignWarning[] = [];
  const sockets = (ctx.room.wallFeatures ?? [])
    .filter((f) => f.kind === "socket" && validFeature(ctx.room, f))
    .map((f) => {
      const s = featureSegment(ctx.room, f);
      return midpoint(s.a, s.b);
    });
  for (const g of subset) {
    if (!POWERED_CATEGORIES.includes(g.item.category)) continue;
    const c = { x: g.item.x, y: g.item.y };
    if (sockets.length === 0) {
      out.push({ code: "socket", severity: "hint", itemIds: [g.item.id], message: `No sockets are recorded for this room — ${nameOf(g.item)} needs power, plan a cable/extension cord.` });
      continue;
    }
    const d = Math.min(...sockets.map((s) => dist(s, c)));
    if (d > SOCKET_MAX_DISTANCE) {
      out.push({ code: "socket", severity: "hint", itemIds: [g.item.id], message: `${cap(nameOf(g.item))} is ${r0(d)} cm from the nearest socket — plan a cable/extension cord.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Walkway analysis (grid + maximin "widest path")
// ---------------------------------------------------------------------------

interface Obstacle {
  poly: Point[];
  itemId?: string;
}

interface Grid {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  free: Uint8Array;
  clear: Float32Array;
}

export interface WalkwayTargetResult {
  itemId: string;
  label: string;
  main: boolean;
  /** Bottleneck width in cm; null = unreachable; Infinity = target directly at the door. */
  width: number | null;
  /** Items that form the narrowest point. */
  bottleneckItemIds: string[];
}

export interface WalkwayAnalysis {
  hasDoor: boolean;
  targets: WalkwayTargetResult[];
  bedSides: { itemId: string; freeCm: number[] }[];
}

const INF = 1e9;
const SUB = [-WALK_CELL / 3, 0, WALK_CELL / 3];

function walkObstacles(ctx: Ctx): Obstacle[] {
  const obs: Obstacle[] = [];
  for (const g of ctx.geos) {
    const c = g.item.category;
    if (c === "rug" || WINDOW_TEXTILE.has(c) || g.stacked) continue;
    if (g.bottom >= WALK_HEADROOM) continue;
    obs.push({ poly: g.fp, itemId: g.item.id });
  }
  for (const b of ctx.builtIns) if ((b.feature.z ?? 0) < WALK_HEADROOM) obs.push({ poly: b.poly });
  return obs;
}

/** Wall pieces with door openings removed (doors are passable). */
function wallPieces(ctx: Ctx): [Point, Point][] {
  const pieces: [Point, Point][] = [];
  for (const w of ctx.walls) {
    const gaps = (ctx.room.wallFeatures ?? [])
      .filter((f) => f.kind === "door" && f.wallIndex === w.index && f.width > 0)
      .map((f) => [Math.max(0, f.offset), Math.min(w.length, f.offset + f.width)] as [number, number])
      .filter(([s, e]) => e > s)
      .sort((p, q) => p[0] - q[0]);
    let t = 0;
    for (const [s, e] of gaps) {
      if (s > t) pieces.push([add(w.a, scale(w.dir, t)), add(w.a, scale(w.dir, s))]);
      t = Math.max(t, e);
    }
    if (t < w.length) pieces.push([add(w.a, scale(w.dir, t)), w.b]);
  }
  return pieces;
}

function buildGrid(ctx: Ctx, obstacles: Obstacle[]): Grid {
  const bb = polygonBounds(ctx.poly);
  const nx = Math.max(1, Math.ceil((bb.maxX - bb.minX) / WALK_CELL));
  const ny = Math.max(1, Math.ceil((bb.maxY - bb.minY) / WALK_CELL));
  const free = new Uint8Array(nx * ny);
  const clear = new Float32Array(nx * ny);

  // flatten segments for the hot loop
  const pieces = wallPieces(ctx);
  const wallSeg = new Float64Array(pieces.length * 4);
  pieces.forEach(([a, b], i) => wallSeg.set([a.x, a.y, b.x, b.y], i * 4));
  const obsBox = obstacles.map((o) => polygonBounds(o.poly));
  const slopes = (ctx.room.slopes ?? [])
    .filter((s) => s.wallIndex >= 1 && s.wallIndex <= ctx.room.corners.length)
    .map((s) => {
      const w = wallSegment(ctx.room, s.wallIndex);
      return { ax: w.a.x, ay: w.a.y, nx: w.inwardNormal.x, ny: w.inwardNormal.y, d0: slopeDistanceForHeight(s, ctx.room.ceilingHeight, WALK_HEADROOM) };
    })
    .filter((s) => s.d0 > 0);
  const roomTooLow = ctx.room.ceilingHeight < WALK_HEADROOM;

  const clearanceAt = (px: number, py: number): number => {
    let m = Infinity;
    for (let k = 0; k < wallSeg.length; k += 4) {
      const d = distPointSegXY(px, py, wallSeg[k], wallSeg[k + 1], wallSeg[k + 2], wallSeg[k + 3]);
      if (d < m) m = d;
    }
    for (let o = 0; o < obstacles.length; o++) {
      const box = obsBox[o];
      // cheap reject: AABB distance already ≥ current minimum
      const dx = Math.max(box.minX - px, 0, px - box.maxX);
      const dy = Math.max(box.minY - py, 0, py - box.maxY);
      if (dx * dx + dy * dy >= m * m) continue;
      const poly = obstacles[o].poly;
      if (pointInConvex({ x: px, y: py }, poly)) return 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const d = distPointSegXY(px, py, a.x, a.y, b.x, b.y);
        if (d < m) m = d;
      }
    }
    for (const s of slopes) {
      const sd = (px - s.ax) * s.nx + (py - s.ay) * s.ny;
      if (sd < -1) continue;
      const d = sd - s.d0;
      if (d <= 0) return 0;
      if (d < m) m = d;
    }
    return m;
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = bb.minX + (i + 0.5) * WALK_CELL;
      const cy = bb.minY + (j + 0.5) * WALK_CELL;
      const idx = j * nx + i;
      if (roomTooLow || !pointInPolygonXY(cx, cy, ctx.poly)) continue;
      const c0 = clearanceAt(cx, cy);
      if (c0 <= 0) continue;
      free[idx] = 1;
      // best clearance within the cell (3×3 sub-samples) → removes most grid-alignment bias
      let best = c0;
      for (const ox of SUB) {
        for (const oy of SUB) {
          if (ox === 0 && oy === 0) continue;
          const px = cx + ox;
          const py = cy + oy;
          if (!pointInPolygonXY(px, py, ctx.poly)) continue;
          const c = clearanceAt(px, py);
          if (c > best) best = c;
        }
      }
      clear[idx] = best;
    }
  }
  return { nx, ny, x0: bb.minX, y0: bb.minY, free, clear };
}

/**
 * Marks free cells whose centre lies in the rectangle a→b (along) × [s0,s1] (along `normal`) and
 * that are connected (within the rectangle) to the row of cells right at the side.
 */
function markBand(grid: Grid, a: Point, b: Point, normal: Point, s0: number, s1: number): Uint8Array {
  const mask = new Uint8Array(grid.nx * grid.ny);
  const L = dist(a, b);
  if (L <= 0) return mask;
  const u = scale(sub(b, a), 1 / L);
  const corners = [a, b, add(b, scale(normal, s1)), add(a, scale(normal, s1)), add(a, scale(normal, s0)), add(b, scale(normal, s0))];
  const bb = polygonBounds(corners);
  const i0 = Math.max(0, Math.floor((bb.minX - grid.x0) / WALK_CELL));
  const i1 = Math.min(grid.nx - 1, Math.ceil((bb.maxX - grid.x0) / WALK_CELL));
  const j0 = Math.max(0, Math.floor((bb.minY - grid.y0) / WALK_CELL));
  const j1 = Math.min(grid.ny - 1, Math.ceil((bb.maxY - grid.y0) / WALK_CELL));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const idx = j * grid.nx + i;
      if (!grid.free[idx]) continue;
      const p = { x: grid.x0 + (i + 0.5) * WALK_CELL, y: grid.y0 + (j + 0.5) * WALK_CELL };
      const v = sub(p, a);
      const t = dot(v, u);
      const s = dot(v, normal);
      if (t >= -0.01 && t <= L + 0.01 && s >= s0 && s <= s1) mask[idx] = s <= Math.max(s0, 0) + WALK_CELL * 1.5 ? 2 : 1;
    }
  }
  // keep only cells connected to the row right at the side/opening (no reaching through obstacles)
  const out = new Uint8Array(grid.nx * grid.ny);
  const queue: number[] = [];
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] === 2) {
      out[k] = 1;
      queue.push(k);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const i = k % grid.nx;
    const j = (k - i) / grid.nx;
    for (const [di, dj] of NB4) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= grid.nx || b >= grid.ny) continue;
      const n = b * grid.nx + a;
      if (mask[n] && !out[n]) {
        out[n] = 1;
        queue.push(n);
      }
    }
  }
  return out;
}

const NB4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Simple binary max-heap on (value, index). */
class MaxHeap {
  private v: number[] = [];
  private i: number[] = [];
  get size(): number {
    return this.v.length;
  }
  push(value: number, index: number): void {
    const v = this.v;
    const ix = this.i;
    let k = v.length;
    v.push(value);
    ix.push(index);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (v[p] >= v[k]) break;
      [v[p], v[k]] = [v[k], v[p]];
      [ix[p], ix[k]] = [ix[k], ix[p]];
      k = p;
    }
  }
  pop(): [number, number] {
    const v = this.v;
    const ix = this.i;
    const top: [number, number] = [v[0], ix[0]];
    const lv = v.pop()!;
    const li = ix.pop()!;
    if (v.length > 0) {
      v[0] = lv;
      ix[0] = li;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < v.length && v[l] > v[m]) m = l;
        if (r < v.length && v[r] > v[m]) m = r;
        if (m === k) break;
        [v[m], v[k]] = [v[k], v[m]];
        [ix[m], ix[k]] = [ix[k], ix[m]];
        k = m;
      }
    }
    return top;
  }
}

const NB: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Widest-path (maximin clearance) from the start band. Start-band cells are "transparent". */
function maximin(grid: Grid, start: Uint8Array): { best: Float32Array; parent: Int32Array } {
  const N = grid.nx * grid.ny;
  const best = new Float32Array(N).fill(-1);
  const parent = new Int32Array(N).fill(-1);
  const heap = new MaxHeap();
  for (let k = 0; k < N; k++) {
    if (start[k]) {
      best[k] = INF;
      heap.push(INF, k);
    }
  }
  const { nx, ny, free, clear } = grid;
  while (heap.size > 0) {
    const [v, k] = heap.pop();
    if (v < best[k]) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of NB) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a;
      if (!free[n]) continue;
      if (di !== 0 && dj !== 0 && (!free[j * nx + a] || !free[b * nx + i])) continue; // no corner cutting
      const cand = start[n] ? INF : Math.min(v, clear[n]);
      if (cand > best[n]) {
        best[n] = cand;
        parent[n] = k;
        heap.push(cand, n);
      }
    }
  }
  return { best, parent };
}

function widthFromClearance(c: number): number {
  // 2 × clearance, plus half of the remaining sub-sample spacing (unbiased estimate)
  return 2 * c + WALK_CELL / 6;
}

/** Free distance in front of a side: median over rays cast outward from 10 %…90 % of the side. */
function sideFreeDistance(ctx: Ctx, side: { a: Point; b: Point; outward: Point }, obstacles: Obstacle[], selfId: string): number {
  const L = dist(side.a, side.b);
  const n = Math.max(3, Math.round(L / 5));
  const ds: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = 0.1 + (0.8 * k) / n;
    const o = add(side.a, scale(sub(side.b, side.a), t));
    const origin = add(o, scale(side.outward, 0.01));
    let m = 1000;
    for (const w of ctx.walls) {
      const h = raySegment(origin, side.outward, w.a, w.b);
      if (h !== null && h < m) m = h;
    }
    for (const ob of obstacles) {
      if (ob.itemId === selfId) continue;
      for (let i = 0; i < ob.poly.length; i++) {
        const h = raySegment(origin, side.outward, ob.poly[i], ob.poly[(i + 1) % ob.poly.length]);
        if (h !== null && h < m) m = h;
      }
    }
    ds.push(m);
  }
  ds.sort((p, q) => p - q);
  return ds[Math.floor(ds.length / 2)];
}

function bedLongSides(item: PlacedItem): ItemSideName[] {
  return item.d >= item.w ? ["left", "right"] : ["front", "back"];
}

export function analyzeWalkways(room: RoomModel, items: PlacedItem[]): WalkwayAnalysis {
  return analyzeWalkwaysCtx(buildCtx(room, items));
}

function analyzeWalkwaysCtx(ctx: Ctx): WalkwayAnalysis {
  const obstacles = walkObstacles(ctx);
  const targets = ctx.geos.filter((g) => g.floor && TARGET_CATS.has(g.item.category));

  const bedSides = targets
    .filter((g) => g.item.category === "bed")
    .map((g) => ({ itemId: g.item.id, freeCm: bedLongSides(g.item).map((s) => r0(sideFreeDistance(ctx, itemSide(g.item, s), obstacles, g.item.id))) }));

  const doors = (ctx.room.wallFeatures ?? []).filter((f) => f.kind === "door" && validFeature(ctx.room, f));
  if (doors.length === 0 || targets.length === 0) return { hasDoor: doors.length > 0, targets: [], bedSides };

  const grid = buildGrid(ctx, obstacles);
  const N = grid.nx * grid.ny;

  // main target: the largest bed, otherwise the largest target
  const area = (g: Geo) => g.item.w * g.item.d;
  const beds = targets.filter((g) => g.item.category === "bed").sort((p, q) => area(q) - area(p));
  const mainId = (beds[0] ?? [...targets].sort((p, q) => area(q) - area(p))[0]).item.id;

  // target bands
  const bands = targets.map((g) => {
    const sides: ItemSideName[] = g.item.category === "bed" ? bedLongSides(g.item) : ["front"];
    const mask = new Uint8Array(N);
    for (const s of sides) {
      const side = itemSide(g.item, s);
      const m = markBand(grid, side.a, side.b, side.outward, 0, 60);
      for (let k = 0; k < N; k++) if (m[k]) mask[k] = 1;
    }
    return mask;
  });

  const results: WalkwayTargetResult[] = targets.map((g) => ({ itemId: g.item.id, label: nameOf(g.item), main: g.item.id === mainId, width: null, bottleneckItemIds: [] }));
  const bestC = targets.map(() => -1);
  const bestPath = targets.map((): { parent: Int32Array; from: number } | null => null);

  for (const door of doors) {
    const w = wallSegment(ctx.room, door.wallIndex);
    const s = featureSegment(ctx.room, door);
    const start = markBand(grid, s.a, s.b, w.inwardNormal, -WALK_CELL, 30);
    let any = false;
    for (let k = 0; k < N; k++) if (start[k]) any = true;
    if (!any) continue;
    const { best, parent } = maximin(grid, start);
    targets.forEach((_, ti) => {
      const band = bands[ti];
      let val = -1;
      let from = -1;
      for (let k = 0; k < N; k++) {
        if (!band[k]) continue;
        if (start[k]) {
          val = INF;
          from = -1;
          break;
        }
        const i = k % grid.nx;
        const j = (k - i) / grid.nx;
        for (const [di, dj] of NB) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= grid.nx || b >= grid.ny) continue;
          const n = b * grid.nx + a;
          if (!grid.free[n] || band[n]) continue;
          if (best[n] > val) {
            val = best[n];
            from = n;
          }
        }
      }
      if (val > bestC[ti]) {
        bestC[ti] = val;
        bestPath[ti] = from >= 0 ? { parent, from } : null;
      }
    });
  }

  targets.forEach((g, ti) => {
    const c = bestC[ti];
    if (c < 0) return; // unreachable → width stays null
    if (c >= INF) {
      results[ti].width = Infinity;
      return;
    }
    results[ti].width = widthFromClearance(c);
    // find the bottleneck cell on the path and the items around it
    const path = bestPath[ti];
    if (!path) return;
    let k = path.from;
    let minK = k;
    let guard = 0;
    while (k >= 0 && guard++ < N) {
      if (grid.clear[k] < grid.clear[minK] && path.parent[k] >= 0) minK = k;
      k = path.parent[k];
    }
    const i = minK % grid.nx;
    const j = (minK - i) / grid.nx;
    const p = { x: grid.x0 + (i + 0.5) * WALK_CELL, y: grid.y0 + (j + 0.5) * WALK_CELL };
    const near = new Set<string>();
    for (const ob of obstacles) {
      if (!ob.itemId) continue;
      let d = Infinity;
      for (let e = 0; e < ob.poly.length; e++) {
        const a = ob.poly[e];
        const b = ob.poly[(e + 1) % ob.poly.length];
        d = Math.min(d, distPointSegXY(p.x, p.y, a.x, a.y, b.x, b.y));
      }
      if (d <= grid.clear[minK] + WALK_CELL * 1.5) near.add(ob.itemId);
    }
    near.delete(g.item.id);
    results[ti].bottleneckItemIds = [...near];
  });

  return { hasDoor: true, targets: results, bedSides };
}

function ruleWalkway(ctx: Ctx, subsetIds: Set<string> | null): DesignWarning[] {
  const out: DesignWarning[] = [];
  const a = analyzeWalkwaysCtx(ctx);
  for (const t of a.targets) {
    if (subsetIds && !subsetIds.has(t.itemId) && !t.bottleneckItemIds.some((id) => subsetIds.has(id))) continue;
    const name = t.label;
    if (t.width === null) {
      out.push({ code: "walkway", severity: "error", itemIds: [t.itemId], message: `There is no way from the door to the ${name} — it is boxed in by walls, furniture or the low sloped ceiling.` });
      continue;
    }
    if (!Number.isFinite(t.width)) continue;
    const min = t.main ? MAIN_WALKWAY_MIN : WALKWAY_MIN;
    if (t.width < min - 1) {
      out.push({
        code: "walkway",
        severity: "warning",
        itemIds: [t.itemId, ...t.bottleneckItemIds],
        message: `The way from the door to the ${name} is only ${r0(t.width)} cm wide at its narrowest point — at least ${min} cm recommended${t.main ? " for the main path" : ""}.`,
      });
    }
  }
  for (const b of a.bedSides) {
    if (subsetIds && !subsetIds.has(b.itemId)) continue;
    if (Math.max(...b.freeCm) < BED_SIDE_MIN - 0.5) {
      const item = ctx.byId.get(b.itemId)!.item;
      out.push({
        code: "walkway",
        severity: "warning",
        itemIds: [b.itemId],
        message: `${cap(nameOf(item))} has only ${b.freeCm.join(" cm and ")} cm free on its long sides — at least one side needs ${BED_SIDE_MIN} cm to get in and make the bed.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CheckCode = "outside" | "overlap" | "headroom" | "walkway" | "doorSwing" | "radiator" | "window" | "wallGap" | "socket";

const ITEM_RULES: Record<Exclude<CheckCode, "walkway">, (ctx: Ctx, subset: Geo[]) => DesignWarning[]> = {
  outside: ruleOutside,
  overlap: ruleOverlap,
  headroom: ruleHeadroom,
  doorSwing: ruleDoorSwing,
  radiator: ruleRadiator,
  window: ruleWindow,
  wallGap: ruleWallGap,
  socket: ruleSocket,
};

function sortWarnings(ws: DesignWarning[]): DesignWarning[] {
  return ws.map((w, i) => ({ w, i })).sort((p, q) => SEVERITY_ORDER[p.w.severity] - SEVERITY_ORDER[q.w.severity] || p.i - q.i).map((x) => x.w);
}

/** Runs every rule on the whole design. Result is sorted: errors, warnings, hints. */
export function checkDesign(room: RoomModel, items: PlacedItem[]): DesignWarning[] {
  if (!room || room.corners.length < 3) return [];
  const ctx = buildCtx(room, items);
  const out: DesignWarning[] = [];
  for (const code of ["outside", "overlap", "headroom", "doorSwing", "radiator", "window", "wallGap", "socket"] as const) {
    out.push(...ITEM_RULES[code](ctx, ctx.geos));
  }
  out.push(...ruleWalkway(ctx, null));
  return sortWarnings(out);
}

/**
 * Fast per-item check (used by nudge/fit). Runs only the given rules for one item.
 * The "walkway" rule is global and only included when explicitly requested.
 */
export function checkItem(room: RoomModel, items: PlacedItem[], itemId: string, codes: CheckCode[] = ["outside", "overlap", "headroom", "doorSwing"]): DesignWarning[] {
  if (!room || room.corners.length < 3) return [];
  const ctx = buildCtx(room, items);
  const g = ctx.byId.get(itemId);
  const out: DesignWarning[] = [];
  for (const code of codes) {
    if (code === "walkway") out.push(...ruleWalkway(ctx, new Set([itemId])));
    else if (g) out.push(...ITEM_RULES[code](ctx, [g]));
  }
  return sortWarnings(out);
}

/**
 * Width (cm) of the narrowest walkway from the door(s) to any main zone (bed sides, fronts of
 * desks, wardrobes, dressers, shelves, sofas). null if there is no door or no such target.
 * Unreachable targets count as 0.
 */
export function narrowestWalkway(room: RoomModel, items: PlacedItem[]): number | null {
  if (!room || room.corners.length < 3) return null;
  const a = analyzeWalkways(room, items);
  let m: number | null = null;
  for (const t of a.targets) {
    const w = t.width === null ? 0 : t.width;
    if (!Number.isFinite(w)) continue;
    m = m === null ? w : Math.min(m, w);
  }
  return m === null ? null : r0(m);
}
