/**
 * Length parsing and display formatting. All lengths are integer centimetres internally.
 */

export type LengthUnit = "cm" | "m";

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

const NUMBER_RE = /^(\d+(?:[.,]\d*)?|[.,]\d+)$/;

/**
 * Parses user input like "4,20" (m), "4.2" (m), "420" (cm), " 86,5 " (cm) into integer cm.
 * Comma or dot decimals are accepted; an explicit "cm"/"m" suffix overrides `unit`.
 */
export function parseLength(input: string, unit: LengthUnit, opts: { min?: number; max?: number } = {}): ParseResult {
  const min = opts.min ?? 0;
  const max = opts.max ?? 2000;
  let s = (input ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (s === "") return { ok: false, error: "Please enter a length." };
  let u: LengthUnit = unit;
  const suffix = /^(.*?)(cm|m)$/.exec(s);
  if (suffix) {
    s = suffix[1];
    u = suffix[2] as LengthUnit;
  }
  if (s.startsWith("-") || s.startsWith("−")) return { ok: false, error: "Length cannot be negative." };
  if (s.startsWith("+")) s = s.slice(1);
  if (!NUMBER_RE.test(s)) return { ok: false, error: `“${input.trim()}” is not a number — use digits like 4.20 or 420.` };
  // shift the decimal point in the string (avoids 2.155 * 100 = 215.4999…)
  const [intPart, frac = ""] = s.replace(",", ".").split(".");
  const cmText = u === "m" ? `${intPart || "0"}${frac.slice(0, 2).padEnd(2, "0")}.${frac.slice(2) || "0"}` : `${intPart || "0"}.${frac || "0"}`;
  const n = Number(cmText);
  if (!Number.isFinite(n)) return { ok: false, error: `“${input.trim()}” is not a number.` };
  const cm = Math.round(n);
  if (cm < min) return { ok: false, error: `Must be at least ${formatCm(min)}.` };
  if (cm > max) return { ok: false, error: `Must be at most ${formatCm(max)} (${formatM(max)}).` };
  return { ok: true, value: cm };
}

export function formatCm(cm: number): string {
  return `${Math.round(cm)} cm`;
}

export function formatM(cm: number): string {
  return `${(cm / 100).toFixed(2)} m`;
}

const EUR = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "€1,234.50" (en-US grouping, € prefix). */
export function formatEur(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? "-" : ""}€${EUR.format(Math.abs(v))}`;
}

/** "16.92 m²" */
export function formatArea(m2: number): string {
  return `${m2.toFixed(2)} m²`;
}
