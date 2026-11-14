/**
 * Procedural CanvasTextures (client only). Textures are cached per key and shared
 * between scenes; they are small, so they are intentionally never disposed.
 */
import * as THREE from "three";
import { mixHex, namedColorToHex } from "@/lib/color";
import { seededRandom } from "./roomGeometry";

export interface FloorTexture {
  texture: THREE.Texture;
  /** World size (metres) covered by one repeat of the texture. */
  tileMeters: number;
  roughness: number;
}

const floorCache = new Map<string, FloorTexture>();
const rugCache = new Map<string, THREE.Texture>();

type FloorKind = "planks" | "parquet" | "tiles" | "carpet" | "plain";

function classifyFloor(floorType: string | undefined): { kind: FloorKind; base: string } {
  const s = (floorType ?? "").toLowerCase();
  let base = "#c49a6c"; // oak
  if (/walnut|dark/.test(s)) base = "#6e4b33";
  else if (/grey|gray|ash/.test(s)) base = "#a59d92";
  else if (/white|whitewash|bleach|birch|light/.test(s)) base = "#d9c6a5";
  else if (/pine/.test(s)) base = "#d8b47e";

  if (/herringbone|parquet|chevron/.test(s)) return { kind: "parquet", base };
  if (/tile|ceramic|stone|marble|slate|terrazzo/.test(s)) {
    const tileBase = /marble|white/.test(s) ? "#e7e4de" : /slate|dark|black|anthracite/.test(s) ? "#55585b" : "#cfcac2";
    return { kind: "tiles", base: tileBase };
  }
  if (/carpet|rug|wool|sisal/.test(s)) {
    const c = /beige|sand|cream/.test(s) ? "#cbbba0" : /blue/.test(s) ? "#6c7f99" : "#9a958d";
    return { kind: "carpet", base: c };
  }
  if (/laminate|wood|oak|plank|vinyl|floorboard|parkett|dielen|timber|pine|walnut|birch|beech/.test(s))
    return { kind: "planks", base };
  if (/concrete|screed|cement|epoxy|linoleum|lino|pvc/.test(s)) return { kind: "plain", base: "#b7b3ab" };
  if (!s.trim()) return { kind: "plain", base: "#cdc7bd" };
  return { kind: "plain", base: namedColorToHex(s) };
}

function noise(ctx: CanvasRenderingContext2D, size: number, rand: () => number, alpha: number, count: number) {
  for (let i = 0; i < count; i++) {
    const v = rand() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function plankGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  rand: () => number,
  horizontal: boolean,
) {
  const shade = mixHex(base, rand() > 0.5 ? "#ffffff" : "#000000", rand() * 0.12);
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, h);
  // grain lines
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const lines = 6 + Math.floor(rand() * 6);
  for (let i = 0; i < lines; i++) {
    ctx.strokeStyle = `rgba(60,35,15,${0.05 + rand() * 0.08})`;
    ctx.lineWidth = 0.6 + rand() * 1.2;
    ctx.beginPath();
    if (horizontal) {
      const yy = y + rand() * h;
      ctx.moveTo(x, yy);
      ctx.bezierCurveTo(x + w * 0.3, yy + (rand() - 0.5) * 6, x + w * 0.7, yy + (rand() - 0.5) * 6, x + w, yy + (rand() - 0.5) * 4);
    } else {
      const xx = x + rand() * w;
      ctx.moveTo(xx, y);
      ctx.bezierCurveTo(xx + (rand() - 0.5) * 6, y + h * 0.3, xx + (rand() - 0.5) * 6, y + h * 0.7, xx + (rand() - 0.5) * 4, y + h);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(40,25,10,0.35)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function getFloorTexture(floorType: string | undefined): FloorTexture {
  const key = (floorType ?? "").toLowerCase().trim();
  const cached = floorCache.get(key);
  if (cached) return cached;
  const { kind, base } = classifyFloor(floorType);
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(key || "floor");
  let tileMeters = 2;
  let roughness = 0.7;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  if (kind === "planks") {
    // 2 m × 2 m: planks 20 cm × 125 cm (running east–west), staggered
    tileMeters = 2.5;
    const px = size / 250; // px per cm
    const plankW = 20 * px;
    const plankL = 125 * px;
    const rows = Math.round(size / plankW);
    for (let r = 0; r < rows; r++) {
      const shift = ((r * 37) % 100) / 100;
      for (let c = -1; c < 3; c++) {
        const x = (c + shift) * plankL;
        plankGrain(ctx, x, r * plankW, plankL, plankW, base, rand, true);
      }
    }
    roughness = 0.6;
  } else if (kind === "parquet") {
    // herringbone-like blocks: 7 × 35 cm strips in an alternating basket pattern
    tileMeters = 1.4;
    const px = size / 140;
    const sw = 7 * px;
    const sl = 35 * px;
    for (let by = 0; by < size; by += sl) {
      for (let bx = 0; bx < size; bx += sl) {
        const horiz = (Math.round(bx / sl) + Math.round(by / sl)) % 2 === 0;
        for (let k = 0; k < 5; k++) {
          if (horiz) plankGrain(ctx, bx, by + k * sw, sl, sw, base, rand, true);
          else plankGrain(ctx, bx + k * sw, by, sw, sl, base, rand, false);
        }
      }
    }
    roughness = 0.55;
  } else if (kind === "tiles") {
    tileMeters = 1.2; // 60 cm tiles
    const n = 2;
    const t = size / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = mixHex(base, rand() > 0.5 ? "#ffffff" : "#000000", rand() * 0.06);
        ctx.fillRect(i * t, j * t, t, t);
      }
    noise(ctx, size, rand, 0.08, 6000);
    ctx.strokeStyle = mixHex(base, "#555555", 0.45);
    ctx.lineWidth = 5;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * t, 0);
      ctx.lineTo(i * t, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * t);
      ctx.lineTo(size, i * t);
      ctx.stroke();
    }
    roughness = 0.35;
  } else if (kind === "carpet") {
    tileMeters = 1;
    noise(ctx, size, rand, 0.18, 60000);
    roughness = 1;
  } else {
    tileMeters = 2;
    noise(ctx, size, rand, 0.06, 20000);
    roughness = 0.8;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.repeat.set(1 / tileMeters, 1 / tileMeters);
  const result = { texture, tileMeters, roughness };
  floorCache.set(key, result);
  return result;
}

/** Simple rug pattern: border, inner field and a few stripes, derived from one colour. */
export function getRugTexture(colorHex: string, seed: string): THREE.Texture {
  const key = `${colorHex}|${seed}`;
  const cached = rugCache.get(key);
  if (cached) return cached;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);
  const dark = mixHex(colorHex, "#000000", 0.25);
  const light = mixHex(colorHex, "#ffffff", 0.35);
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = dark;
  const border = size * 0.06;
  ctx.fillRect(0, 0, size, border);
  ctx.fillRect(0, size - border, size, border);
  ctx.fillRect(0, 0, border, size);
  ctx.fillRect(size - border, 0, border, size);
  ctx.strokeStyle = light;
  ctx.lineWidth = size * 0.012;
  ctx.strokeRect(border * 1.5, border * 1.5, size - border * 3, size - border * 3);
  const style = Math.floor(rand() * 3);
  if (style === 0) {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? light : dark;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(border * 2, border * 2 + ((size - border * 4) / 6) * i, size - border * 4, size * 0.02);
    }
  } else if (style === 1) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = light;
    const cx = size / 2;
    for (let r = size * 0.32; r > 10; r -= size * 0.08) {
      ctx.beginPath();
      ctx.moveTo(cx, cx - r);
      ctx.lineTo(cx + r, cx);
      ctx.lineTo(cx, cx + r);
      ctx.lineTo(cx - r, cx);
      ctx.closePath();
      ctx.lineWidth = size * 0.012;
      ctx.strokeStyle = r % 2 ? light : dark;
      ctx.stroke();
    }
  } else {
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rand() > 0.5 ? light : dark;
      ctx.fillRect(border * 2 + rand() * (size - border * 5), border * 2 + rand() * (size - border * 5), size * 0.05, size * 0.05);
    }
  }
  ctx.globalAlpha = 1;
  noise(ctx, size, rand, 0.1, 15000);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  rugCache.set(key, texture);
  return texture;
}
