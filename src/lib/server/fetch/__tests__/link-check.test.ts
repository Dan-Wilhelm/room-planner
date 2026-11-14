import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifyLinkResponse } from "../link-check";

const PRODUCT = "https://www.shop.example/de/p/sofa-kivik-12345678/";
const OK_BODY = `<html><head><title>KIVIK Sofa – Shop</title>
  <meta property="og:title" content="KIVIK Sofa"></head><body><h1>KIVIK Sofa</h1><p>Preis 499 €</p></body></html>`;

function classify(partial: Partial<Parameters<typeof classifyLinkResponse>[0]>) {
  return classifyLinkResponse({ status: 200, originalUrl: PRODUCT, finalUrl: PRODUCT, body: OK_BODY, ...partial }).status;
}

describe("classifyLinkResponse", () => {
  it("200 with a normal page → verified", () => {
    expect(classify({})).toBe("verified");
  });

  it("404 / 410 → dead", () => {
    expect(classify({ status: 404, body: "" })).toBe("dead");
    expect(classify({ status: 410, body: "" })).toBe("dead");
  });

  it.each([403, 429, 503, 500, 502, 401])("%i → could not verify", (status) => {
    expect(classify({ status, body: "" })).toBe("could not verify");
  });

  it.each(["timeout", "blocked", "network"] as const)("error %s → could not verify", (error) => {
    expect(classify({ status: 0, body: "", error })).toBe("could not verify");
  });

  it("invalid URL → dead", () => {
    expect(classify({ status: 0, body: "", error: "invalid-url" })).toBe("dead");
  });

  it.each([
    "https://www.shop.example/search?q=kivik",
    "https://www.shop.example/de/suche/?query=kivik",
    "https://www.amazon.example/s?k=sofa",
    "https://www.shop.example/category/sofas",
    "https://www.shop.example/de/kategorie/sofas/",
    "https://www.shop.example/de/c/sofas-123/",
    "https://www.shop.example/de/cat/sofas-fu003/",
    "https://www.shop.example/list?k=sofa",
  ])("redirect from product to search/category %s → dead", (finalUrl) => {
    expect(classify({ finalUrl })).toBe("dead");
  });

  it.each(["https://www.shop.example/", "https://shop.example", "https://www.shop.example/de/de/", "https://www.shop.example/de-de/"])(
    "redirect from product to homepage %s → dead",
    (finalUrl) => {
      expect(classify({ finalUrl })).toBe("dead");
    },
  );

  it("redirect to another product page (http→https, trailing slash, www) → verified", () => {
    expect(classify({ originalUrl: "http://shop.example/de/p/sofa-kivik-12345678", finalUrl: PRODUCT })).toBe("verified");
    expect(classify({ finalUrl: "https://www.shop.example/de/p/sofa-kivik-grau-12345678/" })).toBe("verified");
  });

  it("original URL already a category page → no soft-404 from URL rules", () => {
    expect(
      classify({ originalUrl: "https://www.shop.example/category/sofas", finalUrl: "https://www.shop.example/category/sofas-neu" }),
    ).toBe("verified");
  });

  it.each([
    "Dieser Artikel ist leider nicht mehr verfügbar.",
    "Seite nicht gefunden",
    "Oops — Page Not Found",
    "This product is no longer available",
    "Der Artikel ist leider nicht lieferbar",
    "Produkt nicht verfügbar",
  ])("body text %j → dead", (text) => {
    expect(classify({ body: `<html><head><title>Shop</title></head><body><main><p>${text}</p></main></body></html>` })).toBe("dead");
  });

  it("generic phrases count in the title/h1 only", () => {
    expect(classify({ body: `<title>Shop</title><h1>Seite existiert nicht</h1>` })).toBe("dead");
    expect(classify({ body: `<title>Nicht gefunden – Shop</title><p>x</p>` })).toBe("dead");
    expect(classify({ body: `<title>404 | Shop</title>` })).toBe("dead");
    expect(classify({ body: `${OK_BODY}<footer>Nicht gefunden, was du suchst? Frag uns!</footer>` })).toBe("verified");
  });

  it("phrases inside scripts are ignored", () => {
    expect(classify({ body: `${OK_BODY}<script>var msg = "Page not found";</script>` })).toBe("verified");
  });

  it("dead phrase but structured data says InStock → verified", () => {
    const body = `${OK_BODY}<p>Farbe Rot ist nicht mehr verfügbar</p>
      <script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/InStock"}}</script>`;
    expect(classify({ body })).toBe("verified");
  });

  it.each([
    `<html><head><title>Robot Check</title></head><body>Enter the characters you see below</body></html>`,
    `<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>`,
    `<html><body><form action="/errors/validateCaptcha"></form></body></html>`,
  ])("bot wall → could not verify", (body) => {
    expect(classify({ body })).toBe("could not verify");
  });

  it("a big product page that mentions reCAPTCHA in a script is still verified", () => {
    const body = `${OK_BODY}<script src="https://www.google.com/recaptcha/api.js"></script>`;
    expect(classify({ body })).toBe("verified");
  });
});
