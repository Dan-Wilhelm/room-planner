import type { PlacedItem, RoomModel } from "@/lib/types";

/**
 * The app's main test room: 420 × 360 main rectangle with a 120 × 150 niche on the east side
 * (south-east), sloped ceiling on the north wall W2. Area 16.92 m².
 *
 *   W1 west (0,0)→(0,360), W2 north →(420,360), W3 east →(420,150), W4 niche north →(540,150),
 *   W5 niche east →(540,0), W6 south →(0,0).
 */
export function makeTestRoom(): RoomModel {
  return {
    version: 1,
    corners: [
      { x: 0, y: 0 },
      { x: 0, y: 360 },
      { x: 420, y: 360 },
      { x: 420, y: 150 },
      { x: 540, y: 150 },
      { x: 540, y: 0 },
    ],
    northAngle: 0,
    ceilingHeight: 250,
    slopes: [{ id: "s1", wallIndex: 2, kneeWallHeight: 100, fullHeightDistance: 160 }],
    wallFeatures: [
      { id: "door", kind: "door", wallIndex: 6, offset: 400, width: 80, height: 200, z: 0, hinge: "end", opens: "inward" },
      { id: "win", kind: "window", wallIndex: 5, offset: 25, width: 100, height: 120, z: 90, opening: "tilt-turn" },
      { id: "rad", kind: "radiator", wallIndex: 5, offset: 25, width: 100, height: 60, z: 15 },
      { id: "sock1", kind: "socket", wallIndex: 3, offset: 20, width: 8, height: 8, z: 30 },
      { id: "sock2", kind: "socket", wallIndex: 3, offset: 190, width: 8, height: 8, z: 30 },
      { id: "sock3", kind: "socket", wallIndex: 6, offset: 485, width: 8, height: 8, z: 30 },
      { id: "switch", kind: "switch", wallIndex: 6, offset: 488, width: 8, height: 8, z: 105 },
    ],
    ceilingFeatures: [
      { id: "rw", kind: "roofWindow", x: 210, y: 339, width: 78, length: 118, lowerEdgeZ: 120, typeCode: "GGL MK06" },
      { id: "light", kind: "ceilingLight", x: 210, y: 180 },
    ],
    wallColor: "white",
    floorType: "oak-look laminate",
    estimates: {},
  };
}

export const testRoom: RoomModel = makeTestRoom();

let n = 0;
/** Small factory for placed items in tests. */
export function item(p: Partial<PlacedItem> & Pick<PlacedItem, "category" | "x" | "y" | "w" | "d" | "h">): PlacedItem {
  n += 1;
  return {
    id: p.id ?? `${p.category}-${n}`,
    ref: { type: "slot", slotId: `slot-${n}` },
    label: p.label ?? p.category,
    rotation: 0,
    ...p,
  } as PlacedItem;
}
