/**
 * Room templates → corner lists.
 *
 * All templates produce a clockwise outline (seen from above) that starts at C0 = (0,0) in the
 * south-west, with the first wall (W1) running north. Collinear/duplicate corners are merged.
 *
 * Parameters (all cm):
 * - rectangle { width, depth }                      width along x, depth along y
 * - lShape    { width, depth, cutWidth, cutDepth }  rectangle with the north-east corner cut out
 * - rectNiche { width, depth, nicheWall, nicheOffset, nicheWidth, nicheDepth }
 *     nicheWall: 1 = west, 2 = north, 3 = east, 4 = south wall of the main rectangle
 *     (W1 west going north from (0,0), W2 north going east, W3 east going south, W4 south going west);
 *     nicheOffset is measured from that wall's start corner along its direction;
 *     the niche protrudes OUTWARD by nicheDepth.
 * - uShape    { width, depth, gapWidth, gapDepth, gapOffset }
 *     rectangle with a gapWidth × gapDepth notch cut from the north side, gapOffset from the west.
 * - custom: no parameters; a rectangle from params.width/depth (default 400 × 300) is returned
 *   as a starting point that the user then edits corner by corner.
 */
import type { Point, RoomTemplate, RoomTemplateKind } from "@/lib/types";
import { ensureClockwise, mergeCollinear } from "./polygon";
import { add, normalize, scale, sub } from "./vec";

export function defaultTemplateParams(kind: RoomTemplateKind): Record<string, number> {
  switch (kind) {
    case "rectangle":
      return { width: 400, depth: 300 };
    case "lShape":
      return { width: 500, depth: 400, cutWidth: 200, cutDepth: 150 };
    case "rectNiche":
      return { width: 420, depth: 360, nicheWall: 3, nicheOffset: 210, nicheWidth: 150, nicheDepth: 120 };
    case "uShape":
      return { width: 500, depth: 400, gapWidth: 150, gapDepth: 150, gapOffset: 175 };
    case "custom":
    default:
      return { width: 400, depth: 300 };
  }
}

function num(params: Record<string, number>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function rect(w: number, d: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 0, y: d },
    { x: w, y: d },
    { x: w, y: 0 },
  ];
}

export function templateToCorners(t: RoomTemplate): Point[] {
  const defaults = defaultTemplateParams(t.kind);
  const p = (k: string) => num(t.params ?? {}, k, defaults[k] ?? 0);
  let pts: Point[];
  switch (t.kind) {
    case "lShape": {
      const w = p("width");
      const d = p("depth");
      const cw = p("cutWidth");
      const cd = p("cutDepth");
      pts = [
        { x: 0, y: 0 },
        { x: 0, y: d },
        { x: w - cw, y: d },
        { x: w - cw, y: d - cd },
        { x: w, y: d - cd },
        { x: w, y: 0 },
      ];
      break;
    }
    case "rectNiche": {
      const w = p("width");
      const d = p("depth");
      const wall = Math.round(p("nicheWall"));
      const off = p("nicheOffset");
      const nw = p("nicheWidth");
      const nd = p("nicheDepth");
      const base = rect(w, d);
      pts = [];
      for (let i = 1; i <= 4; i++) {
        const a = base[i - 1];
        const b = base[i % 4];
        pts.push(a);
        if (i === wall && nw > 0 && nd !== 0) {
          const dir = normalize(sub(b, a));
          const outward = { x: -dir.y, y: dir.x }; // left of the direction = outside for a clockwise outline
          const s = add(a, scale(dir, off));
          const e = add(a, scale(dir, off + nw));
          pts.push(s, add(s, scale(outward, nd)), add(e, scale(outward, nd)), e);
        }
      }
      break;
    }
    case "uShape": {
      const w = p("width");
      const d = p("depth");
      const gw = p("gapWidth");
      const gd = p("gapDepth");
      const go = p("gapOffset");
      pts = [
        { x: 0, y: 0 },
        { x: 0, y: d },
        { x: go, y: d },
        { x: go, y: d - gd },
        { x: go + gw, y: d - gd },
        { x: go + gw, y: d },
        { x: w, y: d },
        { x: w, y: 0 },
      ];
      break;
    }
    case "rectangle":
    case "custom":
    default:
      pts = rect(p("width"), p("depth"));
  }
  return normalizeOutline(pts);
}

/**
 * Clockwise, merged, and rotated/translated so that C0 is the south-west corner
 * (smallest x, then smallest y) at (0,0).
 */
export function normalizeOutline(points: Point[]): Point[] {
  let pts = mergeCollinear(ensureClockwise(mergeCollinear(points)));
  if (pts.length === 0) return pts;
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[best];
    if (a.x < b.x - 1e-9 || (Math.abs(a.x - b.x) <= 1e-9 && a.y < b.y)) best = i;
  }
  pts = [...pts.slice(best), ...pts.slice(0, best)];
  const o = pts[0];
  return pts.map((q) => ({ x: q.x - o.x + 0, y: q.y - o.y + 0 }));
}
