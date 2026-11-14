/**
 * "Does this product fit?" — swaps an item's dimensions and re-runs the checks.
 */
import type { DesignWarning, FitLabel, PlacedItem, RoomModel } from "@/lib/types";
import { checkDesign } from "./check";
import { nudgeItem } from "./nudge";

export interface FitResult {
  label: FitLabel;
  reason: string;
  moved?: PlacedItem;
}

function relevant(ws: DesignWarning[], itemId: string): DesignWarning[] {
  return ws.filter((w) => w.severity !== "hint" && w.itemIds.includes(itemId));
}

function key(w: DesignWarning): string {
  return `${w.code}|${[...w.itemIds].sort().join(",")}`;
}

function direction(dx: number, dy: number): string {
  const parts: string[] = [];
  if (Math.abs(dy) >= 1) parts.push(dy > 0 ? "north" : "south");
  if (Math.abs(dx) >= 1) parts.push(dx > 0 ? "east" : "west");
  return parts.join("-");
}

/**
 * - "fits": the new dimensions create no new error/warning for that item
 * - "fits if moved": nudgeItem finds a nearby position without new errors/warnings
 * - "doesn't fit": otherwise (reason = the first new problem)
 * Missing dims keep the item's current value.
 */
export function fitProduct(
  room: RoomModel,
  items: PlacedItem[],
  itemId: string,
  dims: { w?: number; d?: number; h?: number },
): FitResult {
  const item = items.find((i) => i.id === itemId);
  if (!item) return { label: "doesn't fit", reason: "The item is not part of this design." };
  const pick = (v: number | undefined, cur: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : cur);
  const resized: PlacedItem = { ...item, w: pick(dims.w, item.w), d: pick(dims.d, item.d), h: pick(dims.h, item.h) };
  const before = new Set(relevant(checkDesign(room, items), itemId).map(key));
  const next = items.map((i) => (i.id === itemId ? resized : i));
  const isNew = (ws: DesignWarning[]) => relevant(ws, itemId).filter((w) => !before.has(key(w)));
  const newIssues = isNew(checkDesign(room, next));
  if (newIssues.length === 0) {
    return { label: "fits", reason: `Fits at the planned position (${resized.w} × ${resized.d} × ${resized.h} cm).` };
  }
  const moved = nudgeItem(room, next, itemId, {
    accept: (_cand, candItems) => isNew(checkDesign(room, candItems)).length === 0,
  });
  if (moved) {
    const dx = moved.x - item.x;
    const dy = moved.y - item.y;
    const d = Math.round(Math.hypot(dx, dy));
    return {
      label: "fits if moved",
      reason: `Fits if moved ${d} cm ${direction(dx, dy)}. At the planned spot: ${newIssues[0].message}`,
      moved,
    };
  }
  const more = newIssues.length > 1 ? ` (+${newIssues.length - 1} more problem${newIssues.length > 2 ? "s" : ""})` : "";
  return { label: "doesn't fit", reason: `${newIssues[0].message}${more}` };
}
