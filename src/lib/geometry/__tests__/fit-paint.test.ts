import { describe, expect, it } from "vitest";
import { chooseBuckets, fitProduct, paintCalc, slopeAreaCm2, wallAreaCm2 } from "..";
import { item, makeTestRoom, testRoom } from "./testRoom";

describe("fitProduct", () => {
  const dresser = item({ id: "dr", category: "dresser", label: "Dresser", x: 300, y: 150, w: 100, d: 50, h: 80 });
  const table = item({ id: "st", category: "sideTable", label: "Side table", x: 230, y: 150, w: 40, d: 40, h: 50 }); // x 210..250, touching the dresser

  it("fits when the new size creates no new problem", () => {
    const r = fitProduct(testRoom, [dresser, table], "st", { d: 45 });
    expect(r.label).toBe("fits");
    expect(r.moved).toBeUndefined();
  });

  it("fits if moved when nudging resolves an overlap", () => {
    const r = fitProduct(testRoom, [dresser, table], "st", { w: 60 });
    expect(r.label).toBe("fits if moved");
    expect(r.moved).toBeDefined();
    expect(r.moved!.w).toBe(60);
    expect(r.moved!.x).toBeLessThanOrEqual(220); // slid west out of the dresser
    expect(r.reason).toMatch(/overlap/);
  });

  it("doesn't fit when it is too tall for the room", () => {
    const r = fitProduct(testRoom, [dresser, table], "st", { h: 260 });
    expect(r.label).toBe("doesn't fit");
    expect(r.reason).toMatch(/ceiling/);
  });

  it("keeps current dims when none are given", () => {
    expect(fitProduct(testRoom, [dresser, table], "st", {}).label).toBe("fits");
  });
});

describe("paintCalc", () => {
  it("wall areas follow the slope (trapezoids) and the slope wall uses the knee height", () => {
    expect(wallAreaCm2(testRoom, 1)).toBeCloseTo(200 * 250 + 160 * 175, 0); // 78 000 cm²
    expect(wallAreaCm2(testRoom, 2)).toBeCloseTo(420 * 100, 0);
    expect(wallAreaCm2(testRoom, 3)).toBeCloseTo(50 * 250 + 160 * 175, 0);
    expect(slopeAreaCm2(testRoom, testRoom.slopes[0])).toBeCloseTo(420 * Math.hypot(160, 150), 0);
  });

  it("W1 + W3", () => {
    const p = paintCalc(testRoom, ["W1", "W3"]);
    expect(p.areaM2).toBeCloseTo(11.85, 2);
    expect(p.coats).toBe(2);
    expect(p.coverageM2PerL).toBe(8);
    expect(p.litersNeeded).toBe(3);
    expect(p.buckets).toEqual([5]);
    expect(p.extras).toHaveLength(3);
  });

  it("subtracts door and window openings", () => {
    const p = paintCalc(testRoom, ["W5", "W6"]);
    // W5: 150 × 250 − window 100 × 120 ; W6: 540 × 250 − door 80 × 200
    expect(p.areaM2).toBeCloseTo((150 * 250 - 12000 + 540 * 250 - 16000) / 10000, 2);
  });

  it("slope surface minus the roof window", () => {
    const p = paintCalc(testRoom, ["slope:s1"], { coats: 2, coverageM2PerL: 8 });
    const expected = (420 * Math.hypot(160, 150) - 78 * 118) / 10000; // ≈ 8.29 m²
    expect(p.areaM2).toBeCloseTo(expected, 1);
    expect(p.litersNeeded).toBe(2.5);
    expect(p.buckets).toEqual([2.5]);
  });

  it("clips the slope to the room when the room is shallower than the slope", () => {
    const room = { ...makeTestRoom(), slopes: [{ id: "deep", wallIndex: 2, kneeWallHeight: 100, fullHeightDistance: 500 }] };
    const a = slopeAreaCm2(room, room.slopes[0]);
    // run limited to the 360 cm depth (main part) — far less than 420 × 500
    expect(a).toBeLessThan(420 * 360 * Math.sqrt(1 + (150 / 500) ** 2) + 1);
    expect(a).toBeGreaterThan(400 * 360);
  });

  it("ignores unknown surfaces and picks the least-waste buckets", () => {
    expect(paintCalc(testRoom, ["W99", "slope:nope"]).areaM2).toBe(0);
    expect(chooseBuckets(3)).toEqual([5]);
    expect(chooseBuckets(7.5)).toEqual([5, 2.5]);
    expect(chooseBuckets(12)).toEqual([10, 2.5]);
    expect(chooseBuckets(14.5)).toEqual([10, 5]);
    expect(chooseBuckets(0)).toEqual([]);
  });
});
