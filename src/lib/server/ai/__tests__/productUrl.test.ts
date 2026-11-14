import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isAcceptableProductUrl } from "../products";

describe("isAcceptableProductUrl", () => {
  it("accepts German product pages", () => {
    expect(isAcceptableProductUrl("https://www.ikea.com/de/de/p/morum-teppich-flach-gewebt-drin-draussen-beige-20203563/")).toBe(true);
    expect(isAcceptableProductUrl("https://www.amazon.de/Paco-Home-Teppich/dp/B07XYZ1234/ref=sr_1_3")).toBe(true);
    expect(isAcceptableProductUrl("https://www.obi.de/p/4150678/teppich-vital-gruen-160-cm-x-230-cm")).toBe(true);
  });
  it("rejects listings, searches and foreign shops", () => {
    expect(isAcceptableProductUrl("https://www.amazon.de/gr%C3%BCner-teppich-Teppiche-Gegend-D%C3%A4mm-Schutzmatten")).toBe(false);
    expect(isAcceptableProductUrl("https://www.amazon.com/dp/B07XYZ1234")).toBe(false);
    expect(isAcceptableProductUrl("https://www.ikea.com/at/de/p/barlast-stehlampe-schwarz-weiss-10430368/")).toBe(false);
    expect(isAcceptableProductUrl("https://www.ikea.com/de/de/cat/teppiche-10653/")).toBe(false);
    expect(isAcceptableProductUrl("https://www.otto.de/suche/teppich/?q=gruen")).toBe(false);
  });
});
