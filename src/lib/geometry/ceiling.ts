/**
 * Ceiling height model.
 *
 * Each slope starts at its wall (height = kneeWallHeight) and rises linearly with the
 * perpendicular distance d from that wall's line until it reaches the base ceiling height at
 * d = fullHeightDistance. The ceiling height at a point is the minimum over all slopes and the
 * base height. Points behind a slope's wall line (d < 0, e.g. in an L-shaped room) are not
 * affected by that slope.
 */
import type { Point, RoomModel, Slope } from "@/lib/types";
import { pointInPolygonXY, polygonBounds } from "./polygon";
import { wallSegment } from "./walls";

type CeilingRoom = Pick<RoomModel, "corners" | "ceilingHeight" | "slopes">;

/** Signed perpendicular distance (cm) from the slope's wall line; positive = into the room. */
export function slopeDistance(room: Pick<RoomModel, "corners">, slope: Slope, p: Point): number {
  const w = wallSegment(room, slope.wallIndex);
  return (p.x - w.a.x) * w.inwardNormal.x + (p.y - w.a.y) * w.inwardNormal.y;
}

/** Height of a single slope at signed distance d (Infinity if the slope does not apply). */
export function slopeHeightAtDistance(slope: Slope, baseHeight: number, d: number): number {
  if (d < -1) return Infinity;
  const dd = Math.max(0, d);
  if (slope.fullHeightDistance <= 0 || dd >= slope.fullHeightDistance) return baseHeight;
  return slope.kneeWallHeight + ((baseHeight - slope.kneeWallHeight) * dd) / slope.fullHeightDistance;
}

export function ceilingHeightAt(room: CeilingRoom, p: Point): number {
  let h = room.ceilingHeight;
  for (const s of room.slopes ?? []) {
    if (s.wallIndex < 1 || s.wallIndex > room.corners.length) continue;
    const sh = slopeHeightAtDistance(s, room.ceilingHeight, slopeDistance(room, s, p));
    if (sh < h) h = sh;
  }
  return h;
}

/**
 * Distance from the slope's wall at which the ceiling reaches `height`
 * (0 if the knee wall is already high enough, Infinity if the base ceiling is lower).
 */
export function slopeDistanceForHeight(slope: Slope, baseHeight: number, height: number): number {
  if (slope.kneeWallHeight >= height) return 0;
  if (baseHeight < height) return Infinity;
  if (baseHeight <= slope.kneeWallHeight) return 0;
  return (slope.fullHeightDistance * (height - slope.kneeWallHeight)) / (baseHeight - slope.kneeWallHeight);
}

/**
 * Lowest ceiling above a footprint polygon: samples the corners, edge points and an interior grid.
 * (The ceiling function is concave, so for convex footprints the corners already give the exact
 * minimum; the extra samples make it robust for other shapes.)
 */
export function minCeilingOverFootprint(room: CeilingRoom, polygon: Point[], step = 10): number {
  if (polygon.length === 0) return room.ceilingHeight;
  if (!room.slopes || room.slopes.length === 0) return room.ceilingHeight;
  let m = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const h = ceilingHeightAt(room, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      if (h < m) m = h;
    }
  }
  const bb = polygonBounds(polygon);
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      if (!pointInPolygonXY(x, y, polygon)) continue;
      const h = ceilingHeightAt(room, { x, y });
      if (h < m) m = h;
    }
  }
  return m;
}
