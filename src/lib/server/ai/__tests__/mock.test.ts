import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { designFromOut } from "@/lib/designConvert";
import { checkDesign, narrowestWalkway } from "@/lib/geometry";
import type { InventoryItem } from "@/lib/types";
import { mockDesign, TEST_ROOM } from "../mock";

const inventory: InventoryItem[] = [
  { id: "inv-bed", projectId: "p", roomId: "r", name: "Double bed", category: "bed", w: 140, d: 200, h: 90, flag: "keep" },
  { id: "inv-desk", projectId: "p", roomId: "r", name: "Desk", category: "desk", w: 120, d: 60, h: 75, flag: "keep" },
];

describe("mock designs on the test room", () => {
  it("produce a physically valid layout", () => {
    for (let v = 0; v < 3; v++) {
      const out = mockDesign(TEST_ROOM, inventory, v, 300);
      const d = designFromOut(out, { roomId: "r", projectId: "p", roomModelVersion: 1, runId: "run", inventory });
      const warnings = checkDesign(TEST_ROOM, d.items);
      const blocking = warnings.filter((w) => w.severity !== "hint");
      if (blocking.length) console.log(`variant ${v}:`, blocking.map((w) => `${w.code}: ${w.message}`));
      expect(blocking.filter((w) => w.severity === "error")).toEqual([]);
      const walk = narrowestWalkway(TEST_ROOM, d.items);
      expect(walk).not.toBeNull();
      expect(walk!).toBeGreaterThanOrEqual(80);
    }
  });
});
