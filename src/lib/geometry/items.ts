/**
 * Placed-item geometry. x/y = centre; rotation = degrees clockwise seen from above;
 * rotation 0 → the front faces +y; w along local x, d along local y.
 */
import type { PlacedItem, Point, RoomModel } from "@/lib/types";
import { type Bounds, polygonBounds } from "./polygon";
import { ceilingHeightAt } from "./ceiling";
import { add, rotateCw, scale } from "./vec";

type ItemPose = Pick<PlacedItem, "x" | "y" | "w" | "d" | "rotation">;

/** Local (item) coordinates → plan coordinates. */
export function localToWorld(item: ItemPose, lx: number, ly: number): Point {
  const v = rotateCw({ x: lx, y: ly }, item.rotation || 0);
  return { x: item.x + v.x, y: item.y + v.y };
}

/** Plan coordinates → local (item) coordinates. */
export function worldToLocal(item: ItemPose, p: Point): Point {
  return rotateCw({ x: p.x - item.x, y: p.y - item.y }, -(item.rotation || 0));
}

/** Direction the item's front faces (unit vector). */
export function frontDir(item: Pick<PlacedItem, "rotation">): Point {
  return rotateCw({ x: 0, y: 1 }, item.rotation || 0);
}

/**
 * Footprint corners, clockwise from above:
 * back-left, front-left, front-right, back-right.
 */
export function itemFootprint(item: ItemPose): Point[] {
  const hw = item.w / 2;
  const hd = item.d / 2;
  return [localToWorld(item, -hw, -hd), localToWorld(item, -hw, hd), localToWorld(item, hw, hd), localToWorld(item, hw, -hd)];
}

export function itemAabb(item: ItemPose): Bounds {
  return polygonBounds(itemFootprint(item));
}

/** Point `distance` cm in front of the middle of the item's front side. */
export function frontPoint(item: ItemPose, distance: number): Point {
  return add({ x: item.x, y: item.y }, scale(frontDir(item), item.d / 2 + distance));
}

export type ItemSideName = "front" | "back" | "left" | "right";

/**
 * One side of the footprint as a segment plus its outward unit normal.
 * "left"/"right" are seen from the item looking out of its front (left = local −x).
 */
export function itemSide(item: ItemPose, side: ItemSideName): { a: Point; b: Point; outward: Point; length: number } {
  const hw = item.w / 2;
  const hd = item.d / 2;
  const rot = item.rotation || 0;
  switch (side) {
    case "front":
      return { a: localToWorld(item, -hw, hd), b: localToWorld(item, hw, hd), outward: rotateCw({ x: 0, y: 1 }, rot), length: item.w };
    case "back":
      return { a: localToWorld(item, hw, -hd), b: localToWorld(item, -hw, -hd), outward: rotateCw({ x: 0, y: -1 }, rot), length: item.w };
    case "left":
      return { a: localToWorld(item, -hw, -hd), b: localToWorld(item, -hw, hd), outward: rotateCw({ x: -1, y: 0 }, rot), length: item.d };
    case "right":
      return { a: localToWorld(item, hw, hd), b: localToWorld(item, hw, -hd), outward: rotateCw({ x: 1, y: 0 }, rot), length: item.d };
  }
}

/**
 * Vertical extent of an item (cm above floor).
 * bottom = z if given; ceiling-mounted without z → hangs from the ceiling at its centre;
 * stacked (stackedOn / mount "onTop") without z → sits on top of its base item.
 */
export function itemVerticalRange(
  room: Pick<RoomModel, "corners" | "ceilingHeight" | "slopes">,
  items: PlacedItem[],
  item: PlacedItem,
): { bottom: number; top: number } {
  let bottom = 0;
  if (typeof item.z === "number" && Number.isFinite(item.z)) bottom = item.z;
  else if (item.mount === "ceiling") bottom = ceilingHeightAt(room, { x: item.x, y: item.y }) - item.h;
  else if (item.stackedOn) {
    const base = items.find((i) => i.id === item.stackedOn);
    if (base && base.id !== item.id) bottom = (typeof base.z === "number" ? base.z : 0) + base.h;
  }
  return { bottom, top: bottom + item.h };
}
