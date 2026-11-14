import { describe, expect, it } from "vitest";
import type { DesignWarning, RoomModel } from "@/lib/types";
import { analyzeWalkways, checkDesign, checkItem, narrowestWalkway, nudgeItem, snapToGrid, snapToWall } from "..";
import { item, makeTestRoom, testRoom } from "./testRoom";

const codes = (ws: DesignWarning[], id?: string) => ws.filter((w) => !id || w.itemIds.includes(id)).map((w) => w.code);

describe("checkDesign — item rules", () => {
  it("wardrobe under the slope gets a headroom error", () => {
    const wardrobe = item({ id: "wr", category: "wardrobe", label: "Wardrobe", x: 200, y: 320, w: 100, d: 60, h: 200 });
    const ws = checkDesign(testRoom, [wardrobe]);
    const head = ws.find((w) => w.code === "headroom");
    expect(head).toBeDefined();
    expect(head!.severity).toBe("error");
    expect(head!.itemIds).toEqual(["wr"]);
    expect(head!.message).toMatch(/Wardrobe is 200 cm tall but the sloped ceiling is only 109 cm above it/);
  });

  it("detects overlapping beds but not a rug under a bed", () => {
    const b1 = item({ id: "b1", category: "bed", x: 150, y: 120, w: 140, d: 200, h: 45 });
    const b2 = item({ id: "b2", category: "bed", x: 220, y: 120, w: 140, d: 200, h: 45 });
    const ws = checkDesign(testRoom, [b1, b2]);
    const ov = ws.filter((w) => w.code === "overlap");
    expect(ov).toHaveLength(1);
    expect(ov[0].severity).toBe("error");
    expect(ov[0].itemIds.sort()).toEqual(["b1", "b2"]);

    const rug = item({ id: "rug", category: "rug", x: 150, y: 120, w: 200, d: 140, h: 1 });
    expect(codes(checkDesign(testRoom, [b1, rug])).includes("overlap")).toBe(false);
  });

  it("exempts stacked, wall-mounted above and curtains from overlap", () => {
    const desk = item({ id: "desk", category: "desk", x: 250, y: 100, w: 120, d: 60, h: 75 });
    const lamp = item({ id: "lamp", category: "tableLamp", x: 270, y: 100, w: 20, d: 20, h: 40, stackedOn: "desk" });
    const shelf = item({ id: "wshelf", category: "shelf", x: 250, y: 115, w: 80, d: 25, h: 30, z: 150, mount: "wall" });
    expect(codes(checkDesign(testRoom, [desk, lamp, shelf])).includes("overlap")).toBe(false);
    const lowShelf = { ...shelf, z: 60 };
    expect(codes(checkDesign(testRoom, [desk, lowShelf])).includes("overlap")).toBe(true);
  });

  it("flags items outside the room", () => {
    const sofa = item({ id: "sofa", category: "sofa", x: 470, y: 180, w: 100, d: 80, h: 80 });
    const ws = checkDesign(testRoom, [sofa]);
    expect(ws.find((w) => w.code === "outside")?.severity).toBe("error");
  });

  it("inward door on W6 blocks an item at (100, 40)", () => {
    const chair = item({ id: "ch", category: "armchair", x: 100, y: 40, w: 40, d: 40, h: 80 });
    const ws = checkDesign(testRoom, [chair]);
    const sw = ws.find((w) => w.code === "doorSwing");
    expect(sw?.severity).toBe("warning");
    expect(sw?.itemIds).toEqual(["ch"]);
    // the same item outside the quarter circle is fine
    const moved = { ...chair, x: 200 };
    expect(codes(checkDesign(testRoom, [moved])).includes("doorSwing")).toBe(false);
    // a thin rug is fine, a thick one is not
    const thin = item({ id: "r1", category: "rug", x: 100, y: 40, w: 60, d: 60, h: 1 });
    const thick = item({ id: "r2", category: "rug", x: 100, y: 40, w: 60, d: 60, h: 2 });
    expect(codes(checkDesign(testRoom, [thin])).includes("doorSwing")).toBe(false);
    expect(codes(checkDesign(testRoom, [thick])).includes("doorSwing")).toBe(true);
    // an outward door has no keep-out
    const out: RoomModel = { ...makeTestRoom() };
    out.wallFeatures = out.wallFeatures.map((f) => (f.id === "door" ? { ...f, opens: "outward" as const } : f));
    expect(codes(checkDesign(out, [chair])).includes("doorSwing")).toBe(false);
  });

  it("radiator, window and curtain rules", () => {
    // dresser right in front of the window/radiator in the niche (W5, x = 540)
    const dresser = item({ id: "dr", category: "dresser", x: 505, y: 75, w: 100, d: 50, h: 100, rotation: 270 });
    const ws = checkDesign(testRoom, [dresser]);
    expect(codes(ws, "dr")).toEqual(expect.arrayContaining(["radiator", "window"]));
    // long curtain covering the radiator
    const curtain = item({ id: "cu", category: "curtain", x: 535, y: 75, w: 140, d: 6, h: 230, z: 2, rotation: 270, mount: "wall" });
    const cw = checkDesign(testRoom, [curtain]).filter((w) => w.code === "radiator");
    expect(cw).toHaveLength(1);
    expect(cw[0].message).toMatch(/cover the radiator/);
    // short curtain ending above the radiator is fine; a small plant in front of the window too
    const short = { ...curtain, z: 80, h: 150 };
    const plant = item({ id: "pl", category: "plant", x: 480, y: 75, w: 30, d: 30, h: 50 });
    expect(codes(checkDesign(testRoom, [short, plant]))).not.toContain("radiator");
    expect(codes(checkDesign(testRoom, [plant]))).not.toContain("window");
  });

  it("wall gap hint for wardrobes against the wall", () => {
    const wr = item({ id: "wr", category: "wardrobe", x: 250, y: 31, w: 100, d: 60, h: 200, rotation: 0 });
    const ws = checkDesign(testRoom, [wr]);
    const gap = ws.find((w) => w.code === "wallGap");
    expect(gap?.severity).toBe("hint");
    expect(gap?.message).toMatch(/5–10 cm for ventilation/);
    const spaced = { ...wr, y: 36 };
    expect(codes(checkDesign(testRoom, [spaced]))).not.toContain("wallGap");
  });

  it("socket hint for a desk 600 cm from any socket", () => {
    const room: RoomModel = {
      ...makeTestRoom(),
      corners: [
        { x: 0, y: 0 },
        { x: 0, y: 300 },
        { x: 800, y: 300 },
        { x: 800, y: 0 },
      ],
      slopes: [],
      wallFeatures: [
        { id: "s", kind: "socket", wallIndex: 1, offset: 146, width: 8, height: 8, z: 30 },
        { id: "d", kind: "door", wallIndex: 4, offset: 100, width: 80, height: 200, z: 0, hinge: "start", opens: "inward" },
      ],
      ceilingFeatures: [],
    };
    const desk = item({ id: "desk", category: "desk", label: "Desk", x: 600, y: 150, w: 120, d: 60, h: 75 });
    const ws = checkDesign(room, [desk]);
    const s = ws.find((w) => w.code === "socket");
    expect(s?.severity).toBe("hint");
    expect(s?.message).toMatch(/Desk is 600 cm from the nearest socket — plan a cable\/extension cord/);
    // close to the socket: no hint
    const near = { ...desk, x: 100 };
    expect(codes(checkDesign(room, [near]))).not.toContain("socket");
  });
});

describe("walkways", () => {
  const bed = item({ id: "bed", category: "bed", label: "Bed", x: 105, y: 250, w: 140, d: 200, h: 45, rotation: 90 });
  const desk = item({ id: "desk", category: "desk", label: "Desk", x: 385, y: 260, w: 120, d: 60, h: 75, rotation: 270 });

  it("narrowestWalkway returns a sensible number for a bed + desk layout", () => {
    const w = narrowestWalkway(testRoom, [bed, desk]);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThanOrEqual(90);
    expect(w!).toBeLessThan(300);
    expect(codes(checkDesign(testRoom, [bed, desk]))).not.toContain("walkway");
  });

  it("measures a corridor accurately and warns below 80 / 90 cm", () => {
    // wardrobe in the south-west, desk facing it: a corridor between them
    const wr = item({ id: "wr", category: "wardrobe", label: "Wardrobe", x: 230, y: 30, w: 100, d: 50, h: 200, rotation: 0 }); // y 5..55, front faces north
    const shelf = (gap: number) => item({ id: "sh", category: "shelf", label: "Shelf", x: 230, y: 55 + gap + 15, w: 300, d: 30, h: 100, rotation: 0 });
    const a80 = analyzeWalkways(testRoom, [wr, shelf(80)]).targets.find((t) => t.itemId === "wr")!;
    expect(a80.width).not.toBeNull();
    expect(a80.width!).toBeGreaterThan(78.5);
    expect(a80.width!).toBeLessThan(81.5);
    expect(checkDesign(testRoom, [wr, shelf(80)]).filter((w) => w.code === "walkway" && w.itemIds.includes("wr"))).toHaveLength(0);
    const narrow = checkDesign(testRoom, [wr, shelf(60)]).filter((w) => w.code === "walkway" && w.itemIds[0] === "wr");
    expect(narrow).toHaveLength(1);
    expect(narrow[0].severity).toBe("warning");
    expect(narrow[0].message).toMatch(/only 6\d cm wide/);
    expect(narrow[0].itemIds).toContain("sh");
  });

  it("errors when a target is unreachable and warns about cramped bed sides", () => {
    // desk in the niche, completely walled in by a long dresser across the niche entrance
    const nicheDesk = item({ id: "nd", category: "desk", label: "Desk", x: 500, y: 75, w: 100, d: 60, h: 75, rotation: 270 }); // x 470..530
    const wall = item({ id: "wall", category: "dresser", label: "Sideboard", x: 440, y: 75, w: 150, d: 40, h: 80, rotation: 90 }); // x 420..460, y 0..150
    const ws = checkDesign(testRoom, [nicheDesk, wall]);
    expect(codes(ws)).not.toContain("outside");
    expect(codes(ws)).not.toContain("overlap");
    const err = ws.find((w) => w.code === "walkway" && w.itemIds[0] === "nd");
    expect(err?.severity).toBe("error");
    expect(err?.message).toMatch(/no way from the door to the Desk/);

    const cramped = item({ id: "bed2", category: "bed", label: "Bed", x: 100, y: 200, w: 160, d: 200, h: 45, rotation: 0 });
    const blockers = [
      item({ id: "w1", category: "wardrobe", x: 210, y: 200, w: 200, d: 50, h: 150, rotation: 90 }),
    ];
    const ws2 = checkDesign(testRoom, [cramped, ...blockers]);
    expect(ws2.some((w) => w.code === "walkway" && w.message.includes("long sides"))).toBe(true);
  });

  it("runs well under 300 ms for a typical furnished room", () => {
    const items = [
      bed,
      desk,
      item({ category: "deskChair", x: 330, y: 260, w: 50, d: 50, h: 100 }),
      item({ category: "nightstand", x: 25, y: 140, w: 40, d: 35, h: 50 }),
      item({ category: "wardrobe", x: 260, y: 32, w: 150, d: 58, h: 200 }),
      item({ category: "rug", x: 250, y: 200, w: 200, d: 140, h: 1 }),
      item({ category: "plant", x: 520, y: 20, w: 30, d: 30, h: 120 }),
      item({ category: "floorLamp", x: 400, y: 30, w: 30, d: 30, h: 160 }),
      item({ category: "shelf", x: 480, y: 130, w: 80, d: 30, h: 100, rotation: 180 }),
      item({ category: "pendantLamp", x: 210, y: 180, w: 40, d: 40, h: 30, mount: "ceiling" }),
    ];
    checkDesign(testRoom, items); // warm-up (JIT)
    const t0 = performance.now();
    const ws = checkDesign(testRoom, items);
    const ms = performance.now() - t0;
    expect(Array.isArray(ws)).toBe(true);
    expect(ms).toBeLessThan(300);
  });
});

describe("nudge / snap", () => {
  it("snapToGrid", () => {
    expect(snapToGrid(102)).toBe(100);
    expect(snapToGrid(103)).toBe(105);
    expect(snapToGrid(-2)).toBe(0);
    expect(snapToGrid(17, 10)).toBe(20);
  });

  it("snapToWall puts the back against the nearest wall with a 5 cm gap, front facing in", () => {
    const wr = item({ id: "wr", category: "wardrobe", x: 60, y: 200, w: 100, d: 60, h: 200, rotation: 0 });
    const s = snapToWall(testRoom, wr);
    expect(s.rotation).toBe(90); // W1 inward normal (1,0) → front faces east
    expect(s.x).toBe(35); // 5 cm gap + 30 half depth
    expect(s.y).toBe(200);
    const s2 = snapToWall(testRoom, { ...wr, x: 200, y: 20 });
    expect(s2.rotation).toBe(0); // W6, front faces north
    expect(s2.y).toBe(35);
  });

  it("nudgeItem resolves an overlap with the nearest valid position", () => {
    const a = item({ id: "a", category: "dresser", x: 300, y: 150, w: 100, d: 50, h: 80 });
    const b = item({ id: "b", category: "sideTable", x: 240, y: 150, w: 40, d: 40, h: 50 }); // overlaps a by 20
    expect(checkItem(testRoom, [a, b], "b").map((w) => w.code)).toContain("overlap");
    const moved = nudgeItem(testRoom, [a, b], "b");
    expect(moved).not.toBeNull();
    expect(moved!.rotation).toBe(b.rotation);
    expect(Math.hypot(moved!.x - b.x, moved!.y - b.y)).toBeLessThanOrEqual(25);
    expect(checkItem(testRoom, [a, moved!], "b")).toHaveLength(0);
  });

  it("nudgeItem returns null when nothing nearby works", () => {
    const huge = item({ id: "h", category: "wardrobe", x: 200, y: 150, w: 600, d: 100, h: 200 });
    expect(nudgeItem(testRoom, [huge], "h")).toBeNull();
  });
});
