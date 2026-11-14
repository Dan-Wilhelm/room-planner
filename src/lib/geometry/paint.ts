/**
 * Paint quantity calculation for walls ("W1"…"Wn") and slopes ("slope:<slopeId>").
 */
import type { PaintCalc, RoomModel, Slope } from "@/lib/types";
import { ceilingHeightAt, slopeDistance } from "./ceiling";
import { allWalls, wallSegment } from "./walls";
import { add, raySegment, scale } from "./vec";

export const PAINT_EXTRAS = ["Primer (only for fresh plaster or dark old colour)", "Painter's tape", "Roller kit with tray"];

const SAMPLE_STEP = 2; // cm

/** Gross wall area (cm²) = ∫ ceiling height along the wall. Openings are NOT subtracted. */
export function wallAreaCm2(room: RoomModel, wallIndex: number): number {
  const w = wallSegment(room, wallIndex);
  const n = Math.max(1, Math.ceil(w.length / SAMPLE_STEP));
  let area = 0;
  let prev = ceilingHeightAt(room, w.a);
  for (let k = 1; k <= n; k++) {
    const p = add(w.a, scale(w.dir, (w.length * k) / n));
    const h = ceilingHeightAt(room, p);
    area += ((prev + h) / 2) * (w.length / n);
    prev = h;
  }
  return area;
}

/**
 * Sloped ceiling surface (cm²): along the slope's wall, the horizontal run is
 * min(fullHeightDistance, distance to the opposite wall); surface = run × sqrt(1 + (rise/run)²).
 */
export function slopeAreaCm2(room: RoomModel, slope: Slope): number {
  if (slope.wallIndex < 1 || slope.wallIndex > room.corners.length) return 0;
  const fhd = slope.fullHeightDistance;
  if (!(fhd > 0)) return 0;
  const rise = Math.max(0, room.ceilingHeight - slope.kneeWallHeight);
  const factor = Math.sqrt(1 + (rise / fhd) ** 2);
  const w = wallSegment(room, slope.wallIndex);
  const walls = allWalls(room).filter((x) => x.index !== slope.wallIndex);
  const n = Math.max(1, Math.ceil(w.length / SAMPLE_STEP));
  let area = 0;
  for (let k = 0; k < n; k++) {
    const t = (w.length * (k + 0.5)) / n;
    const o = add(add(w.a, scale(w.dir, t)), scale(w.inwardNormal, 0.01));
    let depth = Infinity;
    for (const other of walls) {
      const h = raySegment(o, w.inwardNormal, other.a, other.b);
      if (h !== null && h > 0.01 && h < depth) depth = h;
    }
    area += Math.min(fhd, depth) * factor * (w.length / n);
  }
  return area;
}

/** Bucket combination (sizes in litres) covering `liters` with the least waste, then fewest buckets. */
export function chooseBuckets(liters: number, sizes: number[] = [10, 5, 2.5]): number[] {
  if (!(liters > 0)) return [];
  const sorted = [...sizes].sort((a, b) => b - a);
  const halves = sorted.map((s) => Math.round(s * 2));
  const need = Math.ceil(liters * 2 - 1e-9);
  let best: { total: number; count: number; counts: number[] } | null = null;
  const counts = new Array(halves.length).fill(0);
  const rec = (i: number, sum: number) => {
    if (sum >= need) {
      const count = counts.reduce((a, b) => a + b, 0);
      if (!best || sum < best.total || (sum === best.total && count < best.count)) best = { total: sum, count, counts: [...counts] };
      return;
    }
    if (i >= halves.length) return;
    const max = Math.ceil((need - sum) / halves[i]);
    for (let c = max; c >= 0; c--) {
      counts[i] = c;
      rec(i + 1, sum + c * halves[i]);
    }
    counts[i] = 0;
  };
  rec(0, 0);
  const out: number[] = [];
  const b = best as { counts: number[] } | null;
  if (!b) return out;
  b.counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) out.push(sorted[i]);
  });
  return out;
}

export function paintCalc(room: RoomModel, surfaces: string[], opts: { coverageM2PerL?: number; coats?: number } = {}): PaintCalc {
  const coverage = opts.coverageM2PerL && opts.coverageM2PerL > 0 ? opts.coverageM2PerL : 8;
  const coats = opts.coats && opts.coats > 0 ? opts.coats : 2;
  const n = room.corners.length;
  let cm2 = 0;
  const done = new Set<string>();
  for (const raw of surfaces) {
    const s = raw.trim();
    if (done.has(s)) continue;
    done.add(s);
    const wm = /^W(\d+)$/i.exec(s);
    if (wm) {
      const wi = Number(wm[1]);
      if (wi < 1 || wi > n) continue;
      let a = wallAreaCm2(room, wi);
      for (const f of room.wallFeatures ?? []) {
        if (f.wallIndex !== wi || (f.kind !== "door" && f.kind !== "window")) continue;
        a -= Math.max(0, f.width) * Math.max(0, f.height);
      }
      cm2 += Math.max(0, a);
      continue;
    }
    const sm = /^slope:(.+)$/.exec(s);
    if (sm) {
      const slope = (room.slopes ?? []).find((x) => x.id === sm[1]);
      if (!slope) continue;
      let a = slopeAreaCm2(room, slope);
      for (const cf of room.ceilingFeatures ?? []) {
        if (cf.kind !== "roofWindow" || !cf.width || !cf.length) continue;
        const d = slopeDistance(room, slope, cf);
        if (d >= -1 && d <= slope.fullHeightDistance) a -= cf.width * cf.length;
      }
      cm2 += Math.max(0, a);
    }
  }
  const areaM2 = Math.round((cm2 / 10000) * 100) / 100;
  const litersNeeded = areaM2 > 0 ? Math.ceil(((areaM2 * coats) / coverage) * 2 - 1e-9) / 2 : 0;
  return { areaM2, coats, coverageM2PerL: coverage, litersNeeded, buckets: chooseBuckets(litersNeeded), extras: [...PAINT_EXTRAS] };
}
