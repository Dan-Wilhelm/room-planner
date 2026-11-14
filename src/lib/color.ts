/**
 * Small colour helpers shared by the 3D view and the UI.
 * All hex strings are "#rrggbb" (lower case) unless noted.
 */

export interface RGB {
  r: number; // 0–255
  g: number;
  b: number;
}

const FALLBACK_GREY = "#9e9e9e";

function clamp255(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

function toHex2(v: number): string {
  return clamp255(v).toString(16).padStart(2, "0");
}

export function rgbToHex({ r, g, b }: RGB): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

/** Parses "#rgb", "#rrggbb" (with or without "#"). Returns null for anything else. */
export function hexToRgb(hex: string): RGB | null {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h))
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Normalises a hex string to "#rrggbb"; returns null when it is not a valid hex colour. */
export function normalizeHex(hex: string | undefined | null): string | null {
  if (!hex) return null;
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
}

/**
 * Colour temperature (Kelvin) → approximate sRGB hex, Tanner Helland's approximation.
 * Input is clamped to 1000–12000 K. 2700 K ≈ warm white, 6500 K ≈ neutral white.
 */
export function kelvinToHex(k: number): string {
  const kelvin = Number.isFinite(k) ? Math.max(1000, Math.min(12000, k)) : 2700;
  const t = kelvin / 100;
  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return rgbToHex({ r, g, b });
}

/** Linear mix in sRGB space: t = 0 → a, t = 1 → b. Invalid inputs count as grey. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a) ?? hexToRgb(FALLBACK_GREY)!;
  const cb = hexToRgb(b) ?? hexToRgb(FALLBACK_GREY)!;
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

const NAMED: Record<string, string> = {
  white: "#f4f3ef",
  "pure white": "#ffffff",
  "off-white": "#efeadf",
  "off white": "#efeadf",
  "warm white": "#f1ebdd",
  "cool white": "#eef1f3",
  cream: "#f0e6cf",
  ivory: "#f3eedd",
  beige: "#d9c7a7",
  sand: "#d6c2a0",
  taupe: "#a39181",
  greige: "#bdb4a6",
  linen: "#e8e0d0",
  grey: "#9e9e9e",
  gray: "#9e9e9e",
  "light grey": "#c9c9c7",
  "light gray": "#c9c9c7",
  "dark grey": "#555555",
  "dark gray": "#555555",
  anthracite: "#3b3e42",
  charcoal: "#36383b",
  black: "#1c1c1c",
  oak: "#c49a6c",
  "light oak": "#d4b48c",
  wood: "#b8895a",
  pine: "#d8b47e",
  birch: "#dcc39a",
  beech: "#cfa477",
  walnut: "#6b4a32",
  teak: "#9a6b3f",
  rattan: "#c8a46b",
  bamboo: "#d3b77c",
  sage: "#9caf88",
  "sage green": "#9caf88",
  "olive green": "#6f7445",
  "dusty blue": "#7d95ab",
  olive: "#7a7d4a",
  green: "#5f8a5a",
  "forest green": "#2f5236",
  mint: "#bfe3cf",
  terracotta: "#c46a4b",
  rust: "#a8502e",
  ochre: "#c99a3b",
  mustard: "#d1a53a",
  yellow: "#e8cf5a",
  orange: "#e08a3c",
  red: "#b8433a",
  burgundy: "#6e2433",
  pink: "#e6b8b8",
  "dusty pink": "#d4a5a1",
  blush: "#e8c4bd",
  blue: "#4a6fa5",
  "light blue": "#a9c6e0",
  navy: "#22304d",
  "navy blue": "#22304d",
  petrol: "#2c5d63",
  teal: "#2f7a78",
  lavender: "#b9addb",
  purple: "#6d4c8a",
  brown: "#7a5538",
  "dark brown": "#4a3324",
  caramel: "#b07a45",
  cognac: "#9a5a2c",
  brass: "#b5964d",
  gold: "#c9a54c",
  copper: "#b06c45",
  silver: "#b8bcc0",
  chrome: "#c8ccd0",
  concrete: "#a7a6a1",
  stone: "#b3ada3",
  marble: "#e6e4df",
  "light grey wash": "#cfcfcc",
};

const NAMED_KEYS_BY_LENGTH = Object.keys(NAMED).sort((a, b) => b.length - a.length);

/**
 * Maps a free-text colour ("off-white", "sage green wall", "#aabbcc") to a hex colour.
 * Exact name → hex; otherwise the longest known name contained in the text; fallback grey.
 */
export function namedColorToHex(name: string | undefined | null): string {
  if (!name) return FALLBACK_GREY;
  const hex = normalizeHex(name);
  if (hex) return hex;
  const s = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (NAMED[s]) return NAMED[s];
  const g = s.replace(/gray/g, "grey");
  if (NAMED[g]) return NAMED[g];
  for (const key of NAMED_KEYS_BY_LENGTH) {
    const re = new RegExp(`(^|[^a-z])${key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z]|$)`);
    if (re.test(g)) return NAMED[key];
  }
  return FALLBACK_GREY;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance 0–1. */
export function relativeLuminance(hex: string): number {
  const c = hexToRgb(hex) ?? hexToRgb(FALLBACK_GREY)!;
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** Black-ish or white text, whichever has the higher contrast on the given background. */
export function readableTextColor(hex: string): "#111111" | "#ffffff" {
  const l = relativeLuminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const lDark = relativeLuminance("#111111");
  const contrastDark = (l + 0.05) / (lDark + 0.05);
  return contrastDark >= contrastWhite ? "#111111" : "#ffffff";
}
