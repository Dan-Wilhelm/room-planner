import { describe, expect, it } from "vitest";
import {
  ceilingHeightAt,
  defaultTemplateParams,
  ensureClockwise,
  facingLabel,
  featureSegment,
  frontPoint,
  isClockwise,
  itemAabb,
  itemFootprint,
  minCeilingOverFootprint,
  outwardBearing,
  pointInPolygon,
  polygonAreaM2,
  polygonInsidePolygon,
  polygonsOverlap,
  segmentsIntersect,
  templateToCorners,
  validatePolygon,
  wallCount,
  wallSegment,
} from "..";
import { item, testRoom } from "./testRoom";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("templates", () => {
  it("builds the test room from rectNiche exactly", () => {
    const corners = templateToCorners({
      kind: "rectNiche",
      params: { width: 420, depth: 360, nicheWall: 3, nicheOffset: 210, nicheWidth: 150, nicheDepth: 120 },
    });
    expect(corners).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 360 },
      { x: 420, y: 360 },
      { x: 420, y: 150 },
      { x: 540, y: 150 },
      { x: 540, y: 0 },
    ]);
    expect(polygonAreaM2(corners)).toBeCloseTo(16.92, 6);
    expect(templateToCorners({ kind: "rectNiche", params: defaultTemplateParams("rectNiche") })).toEqual(corners);
  });

  it("rectangle, L-shape and U-shape start at (0,0), go north first and are clockwise", () => {
    expect(templateToCorners({ kind: "rectangle", params: { width: 400, depth: 300 } })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 300 },
      { x: 400, y: 300 },
      { x: 400, y: 0 },
    ]);
    const l = templateToCorners({ kind: "lShape", params: { width: 500, depth: 400, cutWidth: 200, cutDepth: 150 } });
    expect(l).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 400 },
      { x: 300, y: 400 },
      { x: 300, y: 250 },
      { x: 500, y: 250 },
      { x: 500, y: 0 },
    ]);
    expect(polygonAreaM2(l)).toBeCloseTo(17, 6);
    const u = templateToCorners({ kind: "uShape", params: { width: 500, depth: 400, gapWidth: 100, gapDepth: 150, gapOffset: 200 } });
    expect(u).toHaveLength(8);
    expect(polygonAreaM2(u)).toBeCloseTo(20 - 1.5, 6);
    for (const c of [l, u]) {
      expect(isClockwise(c)).toBe(true);
      expect(c[0]).toEqual({ x: 0, y: 0 });
      expect(c[1].x).toBe(0);
      expect(c[1].y).toBeGreaterThan(0);
      expect(validatePolygon(c).ok).toBe(true);
    }
  });

  it("merges collinear corners (niche flush with a corner) and re-anchors a west niche", () => {
    const flush = templateToCorners({
      kind: "rectNiche",
      params: { width: 400, depth: 300, nicheWall: 2, nicheOffset: 0, nicheWidth: 100, nicheDepth: 50 },
    });
    // niche at the very start of the north wall: west wall continues straight up to y = 350
    expect(flush).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 350 },
      { x: 100, y: 350 },
      { x: 100, y: 300 },
      { x: 400, y: 300 },
      { x: 400, y: 0 },
    ]);
    const west = templateToCorners({
      kind: "rectNiche",
      params: { width: 400, depth: 300, nicheWall: 1, nicheOffset: 100, nicheWidth: 100, nicheDepth: 50 },
    });
    expect(west[0]).toEqual({ x: 0, y: 0 });
    expect(isClockwise(west)).toBe(true);
    expect(polygonAreaM2(west)).toBeCloseTo(12.5, 6);
  });
});

describe("polygon", () => {
  it("detects clockwise orientation and fixes it", () => {
    expect(isClockwise(testRoom.corners)).toBe(true);
    const ccw = [...testRoom.corners].reverse();
    expect(isClockwise(ccw)).toBe(false);
    const fixed = ensureClockwise(ccw);
    expect(isClockwise(fixed)).toBe(true);
    expect(fixed[0]).toEqual(ccw[0]);
  });

  it("validates the test room and catches self-intersection / zero-length walls", () => {
    const v = validatePolygon(testRoom.corners);
    expect(v.ok).toBe(true);
    expect(v.areaM2).toBeCloseTo(16.92, 6);
    expect(v.clockwise).toBe(true);

    const bowtie = validatePolygon([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(bowtie.ok).toBe(false);
    expect(bowtie.errors.join(" ")).toMatch(/intersects itself/);

    const dup = validatePolygon([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(dup.ok).toBe(false);
    expect(dup.errors.join(" ")).toMatch(/zero length/);

    expect(validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok).toBe(false);
  });

  it("segments, point-in-polygon and convex overlap", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false);
    expect(pointInPolygon({ x: 480, y: 75 }, testRoom.corners)).toBe(true); // niche
    expect(pointInPolygon({ x: 480, y: 250 }, testRoom.corners)).toBe(false); // outside, north of niche
    const a = itemFootprint({ x: 0, y: 0, w: 100, d: 100, rotation: 0 });
    const b = itemFootprint({ x: 100, y: 0, w: 100, d: 100, rotation: 0 }); // touching
    const c = itemFootprint({ x: 90, y: 0, w: 100, d: 100, rotation: 45 });
    expect(polygonsOverlap(a, b)).toBe(false);
    expect(polygonsOverlap(a, c)).toBe(true);
    // rect fully inside the (non-convex) room
    expect(polygonInsidePolygon(itemFootprint({ x: 480, y: 75, w: 100, d: 100, rotation: 0 }), testRoom.corners)).toBe(true);
    expect(polygonInsidePolygon(itemFootprint({ x: 450, y: 150, w: 60, d: 60, rotation: 0 }), testRoom.corners)).toBe(false);
  });
});

describe("walls", () => {
  it("has six walls; W1 inward normal is (1,0)", () => {
    expect(wallCount(testRoom)).toBe(6);
    const w1 = wallSegment(testRoom, 1);
    close(w1.inwardNormal, { x: 1, y: 0 });
    expect(w1.length).toBe(360);
    close(wallSegment(testRoom, 2).inwardNormal, { x: 0, y: -1 });
    close(wallSegment(testRoom, 6).inwardNormal, { x: 0, y: 1 });
  });

  it("places features along the wall", () => {
    const door = testRoom.wallFeatures.find((f) => f.id === "door")!;
    const s = featureSegment(testRoom, door);
    close(s.a, { x: 140, y: 0 });
    close(s.b, { x: 60, y: 0 });
  });

  it("window on W5 faces east; northAngle rotates bearings", () => {
    expect(outwardBearing(testRoom, 5)).toBeCloseTo(90, 6);
    expect(facingLabel(outwardBearing(testRoom, 5))).toBe("east");
    expect(facingLabel(outwardBearing(testRoom, 2))).toBe("north");
    expect(facingLabel(outwardBearing(testRoom, 6))).toBe("south");
    expect(facingLabel(outwardBearing(testRoom, 1))).toBe("west");
    const rotated = { ...testRoom, northAngle: 90 };
    expect(facingLabel(outwardBearing(rotated, 5))).toBe("south");
    expect(facingLabel(135)).toBe("south-east");
    expect(facingLabel(350)).toBe("north");
  });
});

describe("ceiling", () => {
  it("follows the slope on W2", () => {
    expect(ceilingHeightAt(testRoom, { x: 100, y: 360 })).toBeCloseTo(100, 6);
    expect(ceilingHeightAt(testRoom, { x: 100, y: 280 })).toBeCloseTo(175, 6);
    expect(ceilingHeightAt(testRoom, { x: 100, y: 200 })).toBeCloseTo(250, 6);
    expect(ceilingHeightAt(testRoom, { x: 100, y: 100 })).toBe(250);
    expect(ceilingHeightAt(testRoom, { x: 480, y: 75 })).toBe(250);
    expect(ceilingHeightAt(testRoom, { x: 535, y: 145 })).toBe(250);
  });

  it("finds the lowest point over a footprint", () => {
    const fp = itemFootprint({ x: 200, y: 320, w: 100, d: 60, rotation: 0 });
    expect(minCeilingOverFootprint(testRoom, fp)).toBeCloseTo(100 + (150 * 10) / 160, 6);
  });
});

describe("items", () => {
  it("rotates clockwise about the centre", () => {
    const it0 = { x: 100, y: 100, w: 200, d: 100, rotation: 0 };
    expect(itemAabb(it0)).toEqual({ minX: 0, minY: 50, maxX: 200, maxY: 150 });
    const it90 = { ...it0, rotation: 90 };
    const bb = itemAabb(it90);
    expect(bb.minX).toBeCloseTo(50, 6);
    expect(bb.maxX).toBeCloseTo(150, 6);
    expect(bb.minY).toBeCloseTo(0, 6);
    expect(bb.maxY).toBeCloseTo(200, 6);
    // front faces +y at 0°, +x (east) at 90°
    close(frontPoint(it0, 10), { x: 100, y: 160 });
    close(frontPoint(it90, 10), { x: 160, y: 100 });
    close(frontPoint({ ...it0, rotation: 270 }, 0), { x: 50, y: 100 });
    expect(itemFootprint(item({ category: "bed", x: 0, y: 0, w: 10, d: 10, h: 1 }))).toHaveLength(4);
  });
});
