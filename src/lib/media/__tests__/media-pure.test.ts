import { describe, expect, it } from "vitest";
import { blobToBase64, blobToDataUrl, estimateBase64Bytes } from "../encode";
import { isHeic } from "../image";
import { clampFrameCount, computeFrameTimestamps } from "../video";
import { MediaError, VideoDecodeError } from "../errors";

describe("computeFrameTimestamps", () => {
  it("spreads frames evenly and avoids 0 and the very end", () => {
    const t = computeFrameTimestamps(20, 10);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(1);
    expect(t[9]).toBe(19);
    expect(t.every((x) => x > 0 && x < 20)).toBe(true);
  });

  it("respects from/to and clamps them into the duration", () => {
    const t = computeFrameTimestamps(60, 8, 10, 18);
    expect(t[0]).toBe(10.5);
    expect(t[7]).toBe(17.5);
    const c = computeFrameTimestamps(5, 8, -3, 99);
    expect(Math.min(...c)).toBeGreaterThan(0);
    expect(Math.max(...c)).toBeLessThan(5);
  });

  it("handles zero-length ranges and unknown durations", () => {
    expect(computeFrameTimestamps(10, 8, 0, 0).every((x) => x === 0.05)).toBe(true);
    expect(computeFrameTimestamps(NaN, 8)).toEqual(new Array(8).fill(0));
  });
});

describe("clampFrameCount", () => {
  it("clamps to 8–12 with default 10", () => {
    expect(clampFrameCount(undefined)).toBe(10);
    expect(clampFrameCount(3)).toBe(8);
    expect(clampFrameCount(50)).toBe(12);
    expect(clampFrameCount(11)).toBe(11);
  });
});

describe("base64 helpers", () => {
  it("encodes without and with the data: prefix", async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 250, 255])], { type: "image/jpeg" });
    expect(await blobToBase64(blob)).toBe(Buffer.from([0, 1, 2, 250, 255]).toString("base64"));
    expect(await blobToDataUrl(blob)).toBe(`data:image/jpeg;base64,${Buffer.from([0, 1, 2, 250, 255]).toString("base64")}`);
  });

  it("handles large blobs (chunked)", async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(await blobToBase64(new Blob([bytes]))).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("estimates encoded size with per-image overhead", () => {
    const a = new Blob([new Uint8Array(3000)]);
    expect(estimateBase64Bytes([a, a])).toBe(2 * (4000 + 200));
    expect(estimateBase64Bytes([])).toBe(0);
  });
});

describe("isHeic", () => {
  const ftyp = (brand: string, compat: string[] = []) => {
    const size = 16 + compat.length * 4;
    const buf = Buffer.alloc(size);
    buf.writeUInt32BE(size, 0);
    buf.write("ftyp", 4, "ascii");
    buf.write(brand, 8, "ascii");
    compat.forEach((c, i) => buf.write(c, 16 + i * 4, "ascii"));
    return new Uint8Array(buf);
  };

  it("detects by MIME type, extension and magic bytes", async () => {
    expect(await isHeic(new Blob([], { type: "image/heic" }))).toBe(true);
    expect(await isHeic(new File([new Uint8Array(4)], "IMG_0001.HEIC"))).toBe(true);
    expect(await isHeic(new Blob([ftyp("heic", ["mif1", "heic"])]))).toBe(true);
    expect(await isHeic(new Blob([ftyp("heix")]))).toBe(true);
    expect(await isHeic(new Blob([ftyp("mif1", ["heic"])]))).toBe(true);
  });

  it("does not treat AVIF/MP4/JPEG as HEIC", async () => {
    expect(await isHeic(new Blob([ftyp("avif", ["mif1"])]))).toBe(false);
    expect(await isHeic(new Blob([ftyp("mif1", ["avif"])]))).toBe(false);
    expect(await isHeic(new Blob([ftyp("isom", ["mp41"])]))).toBe(false);
    expect(await isHeic(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: "image/jpeg" }))).toBe(false);
  });
});

describe("errors", () => {
  it("VideoDecodeError is a MediaError with the friendly message", () => {
    const e = new VideoDecodeError();
    expect(e).toBeInstanceOf(MediaError);
    expect(e.userMessage).toMatch(/can't be decoded in this browser/);
  });
});
