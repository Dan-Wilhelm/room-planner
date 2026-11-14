import { describe, expect, it } from "vitest";
import { formatArea, formatCm, formatEur, formatM, parseLength } from "./units";

describe("parseLength", () => {
  it("accepts comma and dot decimals", () => {
    expect(parseLength("4,20", "m")).toEqual({ ok: true, value: 420 });
    expect(parseLength("4.2", "m")).toEqual({ ok: true, value: 420 });
    expect(parseLength("420", "cm")).toEqual({ ok: true, value: 420 });
    expect(parseLength(" 86,5 ", "cm")).toEqual({ ok: true, value: 87 });
    expect(parseLength("2.155", "m")).toEqual({ ok: true, value: 216 });
    expect(parseLength("0", "cm")).toEqual({ ok: true, value: 0 });
  });

  it("honours an explicit unit suffix", () => {
    expect(parseLength("4.2 m", "cm")).toEqual({ ok: true, value: 420 });
    expect(parseLength("86cm", "m")).toEqual({ ok: true, value: 86 });
  });

  it("rejects empty, non-numeric, negative and out-of-range values", () => {
    for (const bad of ["", "   ", "abc", "4,2,0", "1e3", "4.2.1"]) {
      const r = parseLength(bad, "cm");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
    const neg = parseLength("-5", "cm");
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.error).toMatch(/negative/);
    const big = parseLength("25", "m");
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/at most 2000 cm/);
    const small = parseLength("40", "cm", { min: 50 });
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.error).toMatch(/at least 50 cm/);
    expect(parseLength("3", "m", { max: 250 }).ok).toBe(false);
  });
});

describe("formatting", () => {
  it("formats lengths, money and areas", () => {
    expect(formatCm(420)).toBe("420 cm");
    expect(formatM(420)).toBe("4.20 m");
    expect(formatEur(1234.5)).toBe("€1,234.50");
    expect(formatEur(-5)).toBe("-€5.00");
    expect(formatArea(16.92)).toBe("16.92 m²");
  });
});
