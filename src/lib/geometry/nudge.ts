/**
 * Deterministic placement helpers: snapping and "nudge to the nearest valid position".
 */
import type { DesignWarning, PlacedItem, Point, RoomModel } from "@/lib/types";
import { checkDesign, checkItem } from "./check";
import { itemFootprint } from "./items";
import { segmentDistance } from "./polygon";
import { allWalls } from "./walls";
import { add, closestPointOnSegment, dist, normDeg, rad2deg, scale } from "./vec";

export function snapToGrid(v: number, step = 5): number {
  if (!(step > 0)) return v;
  return Math.round(v / step) * step + 0; // "+ 0" avoids -0
}

/**
 * Moves the item's back side against the closest wall (leaving `gap` cm) and rotates it so its
 * front faces into the room. The position along the wall is kept where possible.
 */
export function snapToWall(room: Pick<RoomModel, "corners">, item: PlacedItem, gap = 5): PlacedItem {
  const walls = allWalls(room);
  if (walls.length === 0) return { ...item };
  const c = { x: item.x, y: item.y };
  let best = walls[0];
  let bestD = Infinity;
  for (const w of walls) {
    const d = dist(c, closestPointOnSegment(c, w.a, w.b));
    if (d < bestD - 1e-9) {
      bestD = d;
      best = w;
    }
  }
  const n = best.inwardNormal;
  const rotation = Math.round(normDeg(rad2deg(Math.atan2(n.x, n.y))));
  let t = (c.x - best.a.x) * best.dir.x + (c.y - best.a.y) * best.dir.y;
  if (best.length >= item.w) t = Math.min(Math.max(t, item.w / 2), best.length - item.w / 2);
  else t = best.length / 2;
  const p = add(add(best.a, scale(best.dir, t)), scale(n, gap + item.d / 2));
  return { ...item, x: Math.round(p.x), y: Math.round(p.y), rotation };
}

export interface NudgeOptions {
  /** Search radius in cm (default 100). */
  maxDistance?: number;
  /** Step in cm (default 5). */
  step?: number;
  /** Extra acceptance test for a candidate (called after the built-in checks pass). */
  accept?: (candidate: PlacedItem, items: PlacedItem[]) => boolean;
  /** Max number of full design checks (default 30). */
  maxFullChecks?: number;
}

const FAST_CODES = ["outside", "overlap", "headroom", "doorSwing"] as const;

function warningKey(w: DesignWarning): string {
  return `${w.code}|${[...w.itemIds].sort().join(",")}`;
}

function candidateOffsets(room: RoomModel, item: PlacedItem, maxDistance: number, step: number): Point[] {
  const out: Point[] = [{ x: 0, y: 0 }];
  // 1) slide along the nearest wall if the item stands close to one
  const fp = itemFootprint(item);
  let nearest: { dir: Point; d: number } | null = null;
  for (const w of allWalls(room)) {
    let d = Infinity;
    for (let i = 0; i < 4; i++) d = Math.min(d, segmentDistance(fp[i], fp[(i + 1) % 4], w.a, w.b));
    if (!nearest || d < nearest.d) nearest = { dir: w.dir, d };
  }
  if (nearest && nearest.d <= 30) {
    for (let k = 1; k * step <= maxDistance; k++) {
      out.push(scale(nearest.dir, k * step), scale(nearest.dir, -k * step));
    }
  }
  // 2) spiral (rings sorted by distance, then angle)
  const K = Math.floor(maxDistance / step);
  const ring: { p: Point; r: number; a: number }[] = [];
  for (let i = -K; i <= K; i++) {
    for (let j = -K; j <= K; j++) {
      if (i === 0 && j === 0) continue;
      const r = Math.hypot(i, j);
      if (r > K + 1e-9) continue;
      ring.push({ p: { x: i * step, y: j * step }, r, a: normDeg(rad2deg(Math.atan2(i, j))) });
    }
  }
  ring.sort((p, q) => p.r - q.r || p.a - q.a);
  for (const r of ring) out.push(r.p);
  return out;
}

/**
 * Nearest position (same rotation) where the item has no error-severity warnings and no
 * overlap/doorSwing/outside/headroom warnings, and the move creates no new errors elsewhere.
 * Search order: current spot, sliding along the nearest wall (if within 30 cm of it), then a
 * spiral of `step` cm offsets up to `maxDistance`. Returns null if nothing is found.
 */
export function nudgeItem(room: RoomModel, items: PlacedItem[], itemId: string, opts: NudgeOptions = {}): PlacedItem | null {
  const item = items.find((i) => i.id === itemId);
  if (!item || room.corners.length < 3) return null;
  const maxDistance = opts.maxDistance ?? 100;
  const step = opts.step ?? 5;
  const maxFull = opts.maxFullChecks ?? 30;
  const baseline = new Set(checkDesign(room, items).filter((w) => w.severity === "error").map(warningKey));
  const seen = new Set<string>();
  let fullChecks = 0;
  for (const off of candidateOffsets(room, item, maxDistance, step)) {
    const cand: PlacedItem = { ...item, x: Math.round(item.x + off.x), y: Math.round(item.y + off.y) };
    const key = `${cand.x},${cand.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const next = items.map((i) => (i.id === itemId ? cand : i));
    if (checkItem(room, next, itemId, [...FAST_CODES]).length > 0) continue;
    if (fullChecks >= maxFull) return null;
    fullChecks++;
    const full = checkDesign(room, next);
    const bad = full.some((w) => w.severity === "error" && (w.itemIds.includes(itemId) || !baseline.has(warningKey(w))));
    if (bad) continue;
    if (opts.accept && !opts.accept(cand, next)) continue;
    return cand;
  }
  return null;
}
