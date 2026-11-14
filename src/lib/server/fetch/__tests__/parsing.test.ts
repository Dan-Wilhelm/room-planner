import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decodeHtmlEntities, parseOpenGraph } from "../opengraph";
import { detectPlatform, parseInstagramUrl } from "../platform";
import { captionFromOEmbedHtml } from "../preview";

describe("parseOpenGraph", () => {
  it("reads property= tags in the usual order", () => {
    const html = `<html><head>
      <meta property="og:title" content="Sofa KIVIK">
      <meta property="og:description" content="Ein bequemes Sofa">
      <meta property="og:image" content="https://cdn.example.com/a.jpg">
      <meta property="og:site_name" content="IKEA">
      <title>Fallback</title></head></html>`;
    const og = parseOpenGraph(html, "https://www.example.com/p/1");
    expect(og.title).toBe("Sofa KIVIK");
    expect(og.description).toBe("Ein bequemes Sofa");
    expect(og.image).toBe("https://cdn.example.com/a.jpg");
    expect(og.siteName).toBe("IKEA");
    expect(og.images).toEqual(["https://cdn.example.com/a.jpg"]);
  });

  it("accepts content before property, name=, single quotes and unquoted values", () => {
    const html = `<meta content='Titel &amp; mehr' property='og:title'/>
      <META CONTENT=https://x.example/img.png?w=1&h=2 NAME=og:image>
      <meta name="twitter:image" content="/rel/b.jpg" />`;
    const og = parseOpenGraph(html, "https://shop.example/de/item/9");
    expect(og.title).toBe("Titel & mehr");
    expect(og.images).toEqual(["https://x.example/img.png?w=1&h=2", "https://shop.example/rel/b.jpg"]);
  });

  it("resolves relative images against the base URL and dedupes", () => {
    const html = `<meta property="og:image" content="../img/x.jpg">
      <meta property="og:image:secure_url" content="https://s.example/img/x.jpg">
      <meta property="og:image" content="//s.example/img/y.jpg">
      <meta property="og:image" content="data:image/png;base64,AAA">
      <meta property="og:image" content="javascript:alert(1)">`;
    const og = parseOpenGraph(html, "https://s.example/a/b/page.html");
    expect(og.images).toEqual(["https://s.example/a/img/x.jpg", "https://s.example/img/x.jpg", "https://s.example/img/y.jpg"]);
  });

  it("decodes entities and falls back to <title>", () => {
    const html = `<head><title> Sch&ouml;ner Stuhl &#8211; Holz &#x2764; </title>
      <meta name="description" content="Gr&uuml;n &quot;matt&quot;"></head>`;
    const og = parseOpenGraph(html, "https://a.example/");
    expect(og.title).toBe("Schöner Stuhl – Holz ❤");
    expect(og.description).toBe('Grün "matt"');
    expect(og.images).toEqual([]);
    expect(og.image).toBeUndefined();
  });

  it("reads og:video and og:type", () => {
    const html = `<meta property="og:type" content="video.other"><meta property="og:video:secure_url" content="https://v.example/v.mp4">`;
    const og = parseOpenGraph(html, "https://v.example/");
    expect(og.type).toBe("video.other");
    expect(og.video).toBe("https://v.example/v.mp4");
  });

  it("handles empty / garbage input", () => {
    expect(parseOpenGraph("", "https://a.example/").images).toEqual([]);
    expect(parseOpenGraph("<meta <meta property=", "https://a.example/").images).toEqual([]);
  });
});

describe("decodeHtmlEntities", () => {
  it("leaves unknown entities and bare ampersands alone", () => {
    expect(decodeHtmlEntities("a &unknown; b & c &copy=1")).toBe("a &unknown; b & c &copy=1");
    expect(decodeHtmlEntities("&lt;b&gt; &#39;x&#39; &euro;")).toBe("<b> 'x' €");
  });
});

describe("detectPlatform", () => {
  it.each([
    ["https://www.instagram.com/p/ABC123xyz/", "instagram"],
    ["https://instagram.com/reel/ABC123xyz", "instagram"],
    ["https://instagr.am/p/ABC123xyz", "instagram"],
    ["https://www.pinterest.de/pin/123456/", "pinterest"],
    ["https://de.pinterest.com/pin/123/", "pinterest"],
    ["https://pinterest.co.uk/pin/1/", "pinterest"],
    ["https://pin.it/abcDEF", "pinterest"],
    ["https://www.tiktok.com/@user/video/123", "tiktok"],
    ["https://vm.tiktok.com/ZMabc/", "tiktok"],
    ["https://www.ikea.com/de/de/p/x-123/", "web"],
    ["https://notinstagram.com/p/x", "web"],
    ["https://instagram.com.evil.example/p/x", "web"],
    ["https://pinterest-clone.example/", "web"],
    ["not a url", "web"],
  ])("%s → %s", (url, platform) => {
    expect(detectPlatform(url)).toBe(platform);
  });
});

describe("parseInstagramUrl", () => {
  it.each([
    ["https://www.instagram.com/p/C1a2B3c4D5e/", { shortcode: "C1a2B3c4D5e", kind: "p" }],
    ["https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=abc123", { shortcode: "C1a2B3c4D5e", kind: "reel" }],
    ["https://instagram.com/reels/C1a2B3c4D5e", { shortcode: "C1a2B3c4D5e", kind: "reel" }],
    ["https://www.instagram.com/tv/C1a2B3c4D5e/", { shortcode: "C1a2B3c4D5e", kind: "tv" }],
    ["https://www.instagram.com/some.user_1/p/C1a2B3c4D5e/?img_index=2", { username: "some.user_1", shortcode: "C1a2B3c4D5e", kind: "p" }],
    ["https://www.instagram.com/some.user_1/reel/C1a2B3c4D5e/", { username: "some.user_1", shortcode: "C1a2B3c4D5e", kind: "reel" }],
    ["https://www.instagram.com/some.user_1/", { username: "some.user_1" }],
    ["https://www.instagram.com/stories/some.user_1/123456/", { username: "some.user_1" }],
    ["https://www.instagram.com/explore/", {}],
    ["https://www.instagram.com/", {}],
    ["https://www.example.com/p/C1a2B3c4D5e/", {}],
    ["garbage", {}],
  ])("%s", (url, expected) => {
    expect(parseInstagramUrl(url)).toEqual(expected);
  });
});

describe("captionFromOEmbedHtml", () => {
  it("extracts caption and drops Instagram boilerplate", () => {
    const html = `<blockquote class="instagram-media"><div><a href="x">View this post on Instagram</a></div>
      <p style="m"><a href="x">Cozy reading nook &amp; warm light<br>#interior</a></p>
      <p style="m"><a href="x">A post shared by Jane (@jane.doe)</a></p></blockquote>`;
    expect(captionFromOEmbedHtml(html)).toEqual({ caption: "Cozy reading nook & warm light\n#interior", sharedBy: "jane.doe" });
  });
});
