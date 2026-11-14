/**
 * Wall helpers. Wall Wi (1-based) runs from corners[i-1] to corners[i % n].
 * For a clockwise polygon (seen from above, y up) the room interior lies on the RIGHT of the
 * wall direction, so the inward normal is (dir.y, -dir.x).
 */
import type { Point, RoomModel, WallFeature } from "@/lib/types";
import { add, len, normDeg, normalize, rad2deg, scale, sub } from "./vec";
import { isClockwise } from "./polygon";

export interface WallSegment {
  index: number; // 1-based
  a: Point;
  b: Point;
  length: number;
  dir: Point; // unit vector a → b
  inwardNormal: Point; // unit vector pointing into the room
}

export function wallCount(room: Pick<RoomModel, "corners">): number {
  return room.corners.length;
}

export function wallSegment(room: Pick<RoomModel, "corners">, wallIndex: number): WallSegment {
  const n = room.corners.length;
  if (n < 2 || wallIndex < 1 || wallIndex > n) {
    throw new RangeError(`Wall W${wallIndex} does not exist (room has ${n} walls).`);
  }
  const a = room.corners[wallIndex - 1];
  const b = room.corners[wallIndex % n];
  const v = sub(b, a);
  const dir = normalize(v);
  // Right-hand normal for clockwise outlines; flip if the outline is counter-clockwise.
  const cw = n < 3 ? true : isClockwise(room.corners);
  const inwardNormal = cw ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x };
  return { index: wallIndex, a: { ...a }, b: { ...b }, length: len(v), dir, inwardNormal };
}

export function allWalls(room: Pick<RoomModel, "corners">): WallSegment[] {
  const out: WallSegment[] = [];
  for (let i = 1; i <= room.corners.length; i++) out.push(wallSegment(room, i));
  return out;
}

/** Point on wall Wi at distance `t` cm from its start corner. */
export function pointOnWall(room: Pick<RoomModel, "corners">, wallIndex: number, t: number): Point {
  const w = wallSegment(room, wallIndex);
  return add(w.a, scale(w.dir, t));
}

/** Plan endpoints of a wall feature (a = near the wall start, b = further along). */
export function featureSegment(
  room: Pick<RoomModel, "corners">,
  f: Pick<WallFeature, "wallIndex" | "offset" | "width">,
): { a: Point; b: Point } {
  const w = wallSegment(room, f.wallIndex);
  return { a: add(w.a, scale(w.dir, f.offset)), b: add(w.a, scale(w.dir, f.offset + f.width)) };
}

/** Compass bearing (0 = north, 90 = east) of the wall's OUTWARD normal, honouring northAngle. */
export function outwardBearing(room: Pick<RoomModel, "corners" | "northAngle">, wallIndex: number): number {
  const w = wallSegment(room, wallIndex);
  const out = { x: -w.inwardNormal.x, y: -w.inwardNormal.y };
  // angle of `out` measured clockwise from +y, then rotate by the bearing of +y
  const local = rad2deg(Math.atan2(out.x, out.y));
  return normDeg(local + (room.northAngle || 0));
}

export type FacingLabel =
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west";

const LABELS: FacingLabel[] = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function facingLabel(bearing: number): FacingLabel {
  return LABELS[Math.round(normDeg(bearing) / 45) % 8];
}
