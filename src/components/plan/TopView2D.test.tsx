import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TopView2D from "./TopView2D";
import { checkDesign } from "@/lib/geometry";
import { item, testRoom } from "@/lib/geometry/__tests__/testRoom";

describe("TopView2D", () => {
  it("renders the test room with walls, features, items and warning outlines", () => {
    const wardrobe = item({ id: "wr", category: "wardrobe", label: "Wardrobe", x: 200, y: 320, w: 100, d: 60, h: 200 });
    const bed = item({ id: "bed", category: "bed", label: "Bed", x: 105, y: 200, w: 140, d: 200, h: 45, rotation: 90 });
    const items = [wardrobe, bed];
    const html = renderToStaticMarkup(
      <TopView2D
        room={testRoom}
        items={items}
        warnings={checkDesign(testRoom, items)}
        selectedId="bed"
        movableIds={["bed"]}
        highlightPaths={["corners.2.x", "wallFeatures.door.width"]}
      />,
    );
    for (let i = 1; i <= 6; i++) expect(html).toContain(`>W${i}<`);
    expect(html).toContain("16.92 m²");
    expect(html).toContain("GGL MK06");
    expect(html).toContain("knee wall 100 cm");
    expect(html).toContain("#dc2626"); // wardrobe headroom error outline
    expect(html).toContain("(est.)");
    expect(html).toContain("Wardrobe");
  });

  it("shows a placeholder for an empty outline", () => {
    const html = renderToStaticMarkup(<TopView2D room={{ ...testRoom, corners: [] }} />);
    expect(html).toContain("No room outline yet");
  });
});
