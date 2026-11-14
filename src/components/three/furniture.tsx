"use client";

/**
 * Procedural low-poly furniture for the 3D room view.
 *
 * Local frame of every piece (metres): origin = centre of the footprint at the item's bottom,
 * x = width (item's local x), y = up, z = depth with the FRONT at −z and the back at +z.
 * At rotation 0 the front therefore faces −z in world = +y (north) in plan, as in types.ts.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { ItemCategory, PlacedItem } from "@/lib/types";
import { kelvinToHex, mixHex, normalizeHex } from "@/lib/color";
import { seededRandom } from "./roomGeometry";
import { getRugTexture } from "./textures";

export const HIGHLIGHT_HEX = "#3b82f6";
export const LIGHT_CATEGORIES: ItemCategory[] = ["floorLamp", "tableLamp", "pendantLamp", "wallLight", "ledStrip"];

const SelectedCtx = createContext(false);

type V3 = [number, number, number];

interface MatProps {
  color: string;
  rough?: number;
  metal?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  side?: THREE.Side;
  map?: THREE.Texture;
  flat?: boolean;
}

function Mat({ color, rough = 0.8, metal = 0, emissive, emissiveIntensity = 1, opacity, side, map, flat }: MatProps) {
  const selected = useContext(SelectedCtx);
  const em = emissive ?? (selected ? HIGHLIGHT_HEX : "#000000");
  const ei = emissive ? emissiveIntensity : selected ? 0.35 : 0;
  return (
    <meshStandardMaterial
      color={color}
      roughness={rough}
      metalness={metal}
      emissive={em}
      emissiveIntensity={ei}
      transparent={opacity !== undefined && opacity < 1}
      opacity={opacity ?? 1}
      side={side ?? THREE.FrontSide}
      map={map ?? null}
      flatShading={flat ?? false}
    />
  );
}

/** Box given its size [w, h, d] and CENTRE position. */
function Bx({ s, p, rot, ...m }: { s: V3; p: V3; rot?: V3 } & MatProps) {
  const size: V3 = [Math.max(s[0], 0.002), Math.max(s[1], 0.002), Math.max(s[2], 0.002)];
  return (
    <mesh position={p} rotation={rot} castShadow receiveShadow>
      <boxGeometry args={size} />
      <Mat {...m} />
    </mesh>
  );
}

/** Vertical cylinder with bottom at p[1]. */
function Cyl({
  rt,
  rb,
  h,
  p,
  seg = 16,
  open = false,
  rot,
  ...m
}: { rt: number; rb: number; h: number; p: V3; seg?: number; open?: boolean; rot?: V3 } & MatProps) {
  return (
    <mesh position={[p[0], p[1] + h / 2, p[2]]} rotation={rot} castShadow receiveShadow>
      <cylinderGeometry args={[Math.max(rt, 0.001), Math.max(rb, 0.001), Math.max(h, 0.002), seg, 1, open]} />
      <Mat {...m} />
    </mesh>
  );
}

function Soft({ s, p, r, ...m }: { s: V3; p: V3; r?: number } & MatProps) {
  const radius = Math.min(r ?? 0.04, s[0] / 2.2, s[1] / 2.2, s[2] / 2.2);
  return (
    <RoundedBox args={s} radius={Math.max(radius, 0.001)} smoothness={2} position={p} castShadow receiveShadow>
      <Mat {...m} />
    </RoundedBox>
  );
}

const WOOD_RE = /oak|wood|walnut|pine|birch|beech|teak|ash|maple|bamboo|veneer|timber|eiche|holz/;

function woodTone(material: string): string | null {
  const m = material.toLowerCase();
  if (/walnut|nuss|dark wood/.test(m)) return "#6b4a32";
  if (/teak/.test(m)) return "#9a6b3f";
  if (/pine|birch|beech|bamboo|light wood|ash|maple/.test(m)) return "#d6b483";
  if (WOOD_RE.test(m)) return "#c49a6c";
  return null;
}

const CATEGORY_FALLBACK: Partial<Record<ItemCategory, string>> = {
  bed: "#b9b2a7",
  sofa: "#8d8a84",
  armchair: "#8d8a84",
  chair: "#c49a6c",
  deskChair: "#3a3a3a",
  desk: "#e9e6df",
  table: "#c49a6c",
  sideTable: "#c49a6c",
  nightstand: "#c49a6c",
  wardrobe: "#ecebe6",
  dresser: "#ecebe6",
  shelf: "#e5e1d8",
  tvUnit: "#e5e1d8",
  floorLamp: "#2d2d2d",
  tableLamp: "#e8e3d8",
  pendantLamp: "#2d2d2d",
  wallLight: "#2d2d2d",
  ledStrip: "#ffffff",
  rug: "#bdb3a2",
  curtain: "#ece6da",
  blind: "#e9e4da",
  plant: "#b46a4c",
  decor: "#c9b9a4",
  mirror: "#c9a54c",
  art: "#2f2f2f",
  cushion: "#b8a78f",
  throw: "#a89a86",
  other: "#a3a09a",
};

/** Base colour of an item: colorHex, else wood tone from material, else a category default. */
export function itemBaseColor(item: PlacedItem): string {
  const hex = normalizeHex(item.colorHex);
  if (hex) return hex;
  const wood = item.material ? woodTone(item.material) : null;
  if (wood) return wood;
  return CATEGORY_FALLBACK[item.category] ?? "#8a8a8a";
}

function isWoody(item: PlacedItem) {
  return !!item.material && WOOD_RE.test(item.material.toLowerCase());
}

export interface FurnitureMeshProps {
  item: PlacedItem;
  selected?: boolean;
  /** Called on click; propagation is already stopped. Drag-clicks (orbiting) are ignored. */
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  /** Ceiling height (cm) at the item's position — used by pendant lamps. Default 250. */
  ceilingHeight?: number;
  /** Resolved bottom height in cm (overrides item.z). */
  baseZ?: number;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Bottom height (cm) of an item according to z and mount. */
export function itemBaseZ(item: PlacedItem, ceilingHeight: number): number {
  const z = num(item.z, NaN);
  if (Number.isFinite(z)) return z;
  if (item.mount === "ceiling") return Math.max(0, ceilingHeight - num(item.h, 0));
  if (item.mount === "wall") return item.category === "wallLight" ? 170 : item.category === "ledStrip" ? 200 : 140;
  return 0;
}

export function FurnitureMesh({ item, selected = false, onClick, ceilingHeight = 250, baseZ }: FurnitureMeshProps) {
  const W = Math.max(num(item.w, 50), 1) / 100;
  const D = Math.max(num(item.d, 50), 1) / 100;
  const H = Math.max(num(item.h, 50), 0.5) / 100;
  const x = num(item.x, 0) / 100;
  const y = num(item.y, 0) / 100;
  const rot = num(item.rotation, 0);
  const z0 = (baseZ ?? itemBaseZ(item, ceilingHeight)) / 100;
  const color = itemBaseColor(item);

  const outline = useMemo(() => {
    const box = new THREE.BoxGeometry(W + 0.02, H + 0.02, D + 0.02);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [W, H, D]);
  useEffect(() => () => outline.dispose(), [outline]);

  const body = renderCategory(item, { W, D, H, color, ceil: ceilingHeight / 100, z0 });

  return (
    <SelectedCtx.Provider value={selected}>
      <group
        position={[x, z0, -y]}
        rotation={[0, (-rot * Math.PI) / 180, 0]}
        onClick={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          if (e.delta > 4) return;
          onClick(e);
        }}
        onPointerOver={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          if (onClick) document.body.style.cursor = "";
        }}
        userData={{ itemId: item.id }}
      >
        {body}
        {selected && (
          <lineSegments geometry={outline} position={[0, H / 2, 0]} raycast={() => null}>
            <lineBasicMaterial color={HIGHLIGHT_HEX} depthTest={false} transparent opacity={0.9} />
          </lineSegments>
        )}
      </group>
    </SelectedCtx.Provider>
  );
}

interface Dims {
  W: number;
  D: number;
  H: number;
  color: string;
  ceil: number; // metres
  z0: number; // metres
}

function legs(W: number, D: number, h: number, t: number, color: string, inset = 0.02): ReactNode[] {
  const xs = [-W / 2 + inset + t / 2, W / 2 - inset - t / 2];
  const zs = [-D / 2 + inset + t / 2, D / 2 - inset - t / 2];
  const out: ReactNode[] = [];
  for (const lx of xs) for (const lz of zs) out.push(<Bx key={`${lx}-${lz}`} s={[t, h, t]} p={[lx, h / 2, lz]} color={color} />);
  return out;
}

function renderCategory(item: PlacedItem, d: Dims): ReactNode {
  const { W, D, H, color } = d;
  const dark = mixHex(color, "#000000", 0.45);
  const light = mixHex(color, "#ffffff", 0.55);
  const rand = seededRandom(item.id || item.label || "x");
  const woody = isWoody(item);

  switch (item.category) {
    case "bed": {
      const frameH = Math.min(0.28, H * 0.35);
      const mattH = Math.min(0.22, Math.max(H * 0.3, 0.12));
      const headT = Math.min(0.08, D * 0.06);
      const headH = Math.max(H, frameH + mattH + 0.3);
      const mattD = D - headT - 0.04;
      const mattZ = -D / 2 + 0.02 + mattD / 2;
      const top = frameH + mattH;
      const pillows = W > 1.1 ? 2 : 1;
      const pw = (W - 0.15) / pillows - 0.06;
      return (
        <>
          <Bx s={[W, frameH - 0.06, D]} p={[0, 0.06 + (frameH - 0.06) / 2, 0]} color={color} />
          {legs(W, D, 0.06, 0.06, dark, 0.04)}
          <Soft s={[W - 0.06, mattH, mattD]} p={[0, frameH + mattH / 2, mattZ]} color="#f2f0ea" r={0.05} />
          <Bx s={[W, headH, headT]} p={[0, headH / 2, D / 2 - headT / 2]} color={color} />
          {Array.from({ length: pillows }, (_, i) => (
            <Soft
              key={i}
              s={[pw, 0.12, Math.min(0.4, mattD * 0.22)]}
              p={[-W / 2 + 0.075 + (pw + 0.06) * i + pw / 2 + 0.03, top + 0.06, mattZ + mattD / 2 - Math.min(0.4, mattD * 0.22) / 2 - 0.04]}
              color="#ffffff"
              r={0.05}
            />
          ))}
          <Soft
            s={[W - 0.02, 0.06, mattD * 0.68]}
            p={[0, top + 0.02, mattZ - mattD / 2 + (mattD * 0.68) / 2 - 0.01]}
            color={light}
            r={0.03}
          />
        </>
      );
    }
    case "sofa":
    case "armchair": {
      const seatH = Math.min(0.45, H * 0.55);
      const legH = 0.08;
      const armW = Math.min(0.18, W * (item.category === "armchair" ? 0.16 : 0.1));
      const armH = Math.min(H * 0.78, 0.68);
      const backT = Math.min(0.22, D * 0.25);
      const n = item.category === "armchair" ? 1 : Math.max(2, Math.min(4, Math.round((W - 2 * armW) / 0.7)));
      const cw = (W - 2 * armW) / n;
      const cushionH = Math.min(0.14, seatH * 0.35);
      const baseH = seatH - cushionH - legH;
      return (
        <>
          {legs(W, D, legH, 0.05, dark, 0.05)}
          <Bx s={[W, baseH, D]} p={[0, legH + baseH / 2, 0]} color={color} />
          <Soft s={[W, H - legH, backT]} p={[0, legH + (H - legH) / 2, D / 2 - backT / 2]} color={color} r={0.05} />
          <Soft s={[armW, armH - legH, D]} p={[-W / 2 + armW / 2, legH + (armH - legH) / 2, 0]} color={color} r={0.05} />
          <Soft s={[armW, armH - legH, D]} p={[W / 2 - armW / 2, legH + (armH - legH) / 2, 0]} color={color} r={0.05} />
          {Array.from({ length: n }, (_, i) => (
            <Soft
              key={i}
              s={[cw - 0.01, cushionH, D - backT - 0.02]}
              p={[-W / 2 + armW + cw * i + cw / 2, seatH - cushionH / 2, -D / 2 + (D - backT) / 2]}
              color={mixHex(color, "#ffffff", 0.06)}
              r={0.04}
            />
          ))}
        </>
      );
    }
    case "chair": {
      const seatY = Math.min(0.46, H * 0.55);
      const t = 0.035;
      return (
        <>
          {legs(W, D, seatY - 0.03, t, woody ? color : dark, 0.02)}
          <Bx s={[W, 0.03, D]} p={[0, seatY - 0.015, 0]} color={color} />
          <Bx s={[W, Math.max(H - seatY - 0.15, 0.05), 0.03]} p={[0, seatY + 0.15 + (H - seatY - 0.15) / 2, D / 2 - 0.03]} color={color} />
          <Bx s={[t, H - seatY, t]} p={[-W / 2 + 0.02 + t / 2, seatY + (H - seatY) / 2, D / 2 - 0.035]} color={woody ? color : dark} />
          <Bx s={[t, H - seatY, t]} p={[W / 2 - 0.02 - t / 2, seatY + (H - seatY) / 2, D / 2 - 0.035]} color={woody ? color : dark} />
        </>
      );
    }
    case "deskChair": {
      const seatY = Math.min(0.48, H * 0.45);
      const r = Math.min(W, D) / 2;
      const legLen = r * 0.95;
      return (
        <>
          {Array.from({ length: 5 }, (_, i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <group key={i} rotation={[0, a, 0]}>
                <Bx s={[0.04, 0.03, legLen]} p={[0, 0.06, legLen / 2]} color="#2b2b2b" metal={0.3} rough={0.5} />
                <Cyl rt={0.025} rb={0.025} h={0.04} p={[0, 0, legLen - 0.03]} color="#111111" seg={8} />
              </group>
            );
          })}
          <Cyl rt={0.025} rb={0.03} h={seatY - 0.12} p={[0, 0.07, 0]} color="#777777" metal={0.6} rough={0.3} seg={10} />
          <Soft s={[W * 0.85, 0.08, D * 0.8]} p={[0, seatY - 0.04, -D * 0.04]} color={color} r={0.03} />
          <Soft
            s={[W * 0.8, Math.max(H - seatY - 0.08, 0.1), 0.06]}
            p={[0, seatY + 0.05 + (H - seatY - 0.08) / 2, D * 0.36]}
            color={color}
            r={0.03}
          />
          <Bx s={[0.05, 0.03, D * 0.4]} p={[-W * 0.42, seatY + 0.2, -D * 0.05]} color="#2b2b2b" />
          <Bx s={[0.05, 0.03, D * 0.4]} p={[W * 0.42, seatY + 0.2, -D * 0.05]} color="#2b2b2b" />
          <Bx s={[0.03, 0.2, 0.03]} p={[-W * 0.42, seatY + 0.1, -D * 0.05]} color="#2b2b2b" />
          <Bx s={[0.03, 0.2, 0.03]} p={[W * 0.42, seatY + 0.1, -D * 0.05]} color="#2b2b2b" />
        </>
      );
    }
    case "desk": {
      const topT = Math.min(0.03, H * 0.1);
      const legC = woody ? mixHex(color, "#000000", 0.15) : "#2f2f2f";
      return (
        <>
          <Bx s={[W, topT, D]} p={[0, H - topT / 2, 0]} color={color} rough={0.6} />
          {legs(W, D, H - topT, 0.04, legC, 0.03)}
          <Bx s={[W - 0.12, 0.08, 0.02]} p={[0, H - topT - 0.04, D / 2 - 0.05]} color={legC} />
        </>
      );
    }
    case "table": {
      const round = /round|rund|circle|oval/i.test(item.label ?? "");
      const topT = Math.min(0.035, H * 0.1);
      if (round) {
        return (
          <>
            <Cyl rt={W / 2} rb={W / 2} h={topT} p={[0, H - topT, 0]} color={color} seg={32} rough={0.6} />
            <Cyl rt={0.05} rb={0.05} h={H - topT} p={[0, 0, 0]} color={dark} seg={12} />
            <Cyl rt={W * 0.22} rb={W * 0.24} h={0.03} p={[0, 0, 0]} color={dark} seg={24} />
          </>
        );
      }
      return (
        <>
          <Bx s={[W, topT, D]} p={[0, H - topT / 2, 0]} color={color} rough={0.6} />
          {legs(W, D, H - topT, 0.05, woody ? color : dark, 0.05)}
        </>
      );
    }
    case "sideTable":
    case "nightstand": {
      const legH = Math.min(0.12, H * 0.2);
      const bodyH = H - legH;
      const drawerH = item.category === "nightstand" ? bodyH * 0.4 : 0;
      return (
        <>
          {legs(W, D, legH, 0.03, woody ? color : dark, 0.02)}
          <Bx s={[W, bodyH, D]} p={[0, legH + bodyH / 2, 0]} color={color} />
          {drawerH > 0 && (
            <>
              <Bx s={[W - 0.03, 0.004, 0.004]} p={[0, H - drawerH, -D / 2 - 0.002]} color={dark} />
              <Bx s={[0.08, 0.015, 0.015]} p={[0, H - drawerH / 2, -D / 2 - 0.008]} color="#9a9a9a" metal={0.6} rough={0.3} />
            </>
          )}
          {item.category === "sideTable" && <Bx s={[W - 0.02, 0.02, D - 0.02]} p={[0, legH + bodyH * 0.25, 0]} color={dark} />}
        </>
      );
    }
    case "wardrobe": {
      const doors = Math.max(1, Math.min(6, Math.round(W / 0.5)));
      const dw = W / doors;
      return (
        <>
          <Bx s={[W, H - 0.05, D]} p={[0, 0.05 + (H - 0.05) / 2, 0]} color={color} />
          <Bx s={[W - 0.04, 0.05, D - 0.04]} p={[0, 0.025, 0]} color={dark} />
          {Array.from({ length: doors - 1 }, (_, i) => (
            <Bx
              key={`l${i}`}
              s={[0.004, H - 0.08, 0.004]}
              p={[-W / 2 + dw * (i + 1), 0.05 + (H - 0.05) / 2, -D / 2 - 0.002]}
              color={dark}
            />
          ))}
          {Array.from({ length: doors }, (_, i) => {
            const right = i % 2 === 0;
            const hx = -W / 2 + dw * i + (right ? dw - 0.04 : 0.04);
            return (
              <Bx
                key={`h${i}`}
                s={[0.015, 0.22, 0.02]}
                p={[hx, Math.min(1.05, H * 0.55), -D / 2 - 0.012]}
                color="#8f8f8f"
                metal={0.6}
                rough={0.3}
              />
            );
          })}
        </>
      );
    }
    case "dresser": {
      const legH = Math.min(0.1, H * 0.12);
      const bodyH = H - legH;
      const rows = Math.max(2, Math.min(6, Math.round(bodyH / 0.25)));
      const cols = W > 1.0 ? 2 : 1;
      const rh = bodyH / rows;
      const cw = W / cols;
      const fronts: ReactNode[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const fx = -W / 2 + cw * c + cw / 2;
          const fy = legH + rh * r + rh / 2;
          fronts.push(
            <Bx
              key={`f${r}-${c}`}
              s={[cw - 0.012, rh - 0.012, 0.012]}
              p={[fx, fy, -D / 2 - 0.006]}
              color={mixHex(color, "#ffffff", 0.05)}
            />,
          );
          fronts.push(
            <Bx
              key={`k${r}-${c}`}
              s={[0.1, 0.012, 0.015]}
              p={[fx, fy + rh * 0.15, -D / 2 - 0.018]}
              color="#8f8f8f"
              metal={0.6}
              rough={0.3}
            />,
          );
        }
      return (
        <>
          {legs(W, D, legH, 0.035, woody ? color : dark, 0.03)}
          <Bx s={[W, bodyH, D]} p={[0, legH + bodyH / 2, 0]} color={color} />
          {fronts}
        </>
      );
    }
    case "shelf": {
      const t = 0.022;
      const n = Math.max(2, Math.min(8, Math.round(H / 0.35)));
      const gap = (H - t) / n;
      const books: ReactNode[] = [];
      const bookColors = ["#7a4e3a", "#2f4f6f", "#c9b27c", "#5f7a5a", "#a33f3f", "#d8d2c4", "#3a3a3a"];
      for (let i = 0; i < n; i++) {
        if (rand() < 0.35) continue;
        let bx = -W / 2 + t + 0.02 + rand() * 0.1;
        const count = 3 + Math.floor(rand() * 8);
        for (let k = 0; k < count; k++) {
          const bw = 0.02 + rand() * 0.025;
          const bh = Math.min(gap - 0.03, 0.16 + rand() * 0.12);
          if (bx + bw > W / 2 - t - 0.02 || bh <= 0.02) break;
          books.push(
            <Bx
              key={`b${i}-${k}`}
              s={[bw, bh, Math.min(D - 0.04, 0.2)]}
              p={[bx + bw / 2, t + gap * i + bh / 2 + t / 2, 0]}
              color={bookColors[Math.floor(rand() * bookColors.length)]}
            />,
          );
          bx += bw + 0.002;
        }
      }
      return (
        <>
          <Bx s={[t, H, D]} p={[-W / 2 + t / 2, H / 2, 0]} color={color} />
          <Bx s={[t, H, D]} p={[W / 2 - t / 2, H / 2, 0]} color={color} />
          <Bx s={[W, H, 0.008]} p={[0, H / 2, D / 2 - 0.004]} color={mixHex(color, "#000000", 0.08)} />
          {Array.from({ length: n + 1 }, (_, i) => (
            <Bx key={i} s={[W - 2 * t, t, D]} p={[0, t / 2 + gap * i, 0]} color={color} />
          ))}
          {books}
        </>
      );
    }
    case "tvUnit": {
      const legH = Math.min(0.12, H * 0.25);
      const bodyH = H - legH;
      const n = Math.max(2, Math.min(4, Math.round(W / 0.6)));
      const cw = W / n;
      return (
        <>
          {legs(W, D, legH, 0.03, woody ? color : dark, 0.05)}
          <Bx s={[W, bodyH, D]} p={[0, legH + bodyH / 2, 0]} color={color} />
          {Array.from({ length: n - 1 }, (_, i) => (
            <Bx key={i} s={[0.004, bodyH - 0.02, 0.004]} p={[-W / 2 + cw * (i + 1), legH + bodyH / 2, -D / 2 - 0.002]} color={dark} />
          ))}
        </>
      );
    }
    case "floorLamp": {
      const kel = kelvinToHex(item.kelvin ?? 2700);
      const shadeH = Math.min(0.32, H * 0.2);
      const shadeR = Math.min(W, D) / 2;
      const poleH = H - shadeH * 0.6;
      return (
        <>
          <Cyl
            rt={Math.min(0.14, shadeR * 0.8)}
            rb={Math.min(0.15, shadeR * 0.85)}
            h={0.03}
            p={[0, 0, 0]}
            color={color}
            metal={0.3}
            rough={0.5}
            seg={24}
          />
          <Cyl rt={0.012} rb={0.012} h={poleH} p={[0, 0.03, 0]} color={color} metal={0.4} rough={0.4} seg={8} />
          <Cyl
            rt={shadeR * 0.7}
            rb={shadeR}
            h={shadeH}
            p={[0, H - shadeH, 0]}
            color={mixHex("#f3eee2", kel, 0.3)}
            emissive={kel}
            emissiveIntensity={0.6}
            open
            side={THREE.DoubleSide}
            seg={24}
          />
          <mesh position={[0, H - shadeH * 0.6, 0]}>
            <sphereGeometry args={[0.04, 12, 8]} />
            <meshBasicMaterial color={kel} toneMapped={false} />
          </mesh>
        </>
      );
    }
    case "tableLamp": {
      const kel = kelvinToHex(item.kelvin ?? 2700);
      const shadeH = H * 0.45;
      const r = Math.min(W, D) / 2;
      return (
        <>
          <Cyl rt={r * 0.45} rb={r * 0.55} h={H * 0.35} p={[0, 0, 0]} color={color} rough={0.4} seg={16} />
          <Cyl rt={0.008} rb={0.008} h={H * 0.25} p={[0, H * 0.35, 0]} color="#888888" seg={6} />
          <Cyl
            rt={r * 0.7}
            rb={r}
            h={shadeH}
            p={[0, H - shadeH, 0]}
            color={mixHex("#f3eee2", kel, 0.3)}
            emissive={kel}
            emissiveIntensity={0.7}
            open
            side={THREE.DoubleSide}
            seg={20}
          />
        </>
      );
    }
    case "pendantLamp": {
      const kel = kelvinToHex(item.kelvin ?? 2700);
      const shadeH = Math.min(0.3, Math.max(H * 0.5, 0.12));
      const r = Math.min(W, D) / 2;
      const cord = Math.max(d.ceil - d.z0 - shadeH, 0.02);
      return (
        <>
          <Cyl
            rt={r * 0.25}
            rb={r}
            h={shadeH}
            p={[0, 0, 0]}
            color={color}
            emissive={kel}
            emissiveIntensity={0.15}
            open
            side={THREE.DoubleSide}
            seg={24}
            rough={0.5}
          />
          <mesh position={[0, shadeH * 0.25, 0]}>
            <sphereGeometry args={[Math.min(0.05, r * 0.3), 12, 8]} />
            <meshBasicMaterial color={kel} toneMapped={false} />
          </mesh>
          <Cyl rt={0.004} rb={0.004} h={cord} p={[0, shadeH, 0]} color="#222222" seg={6} />
          <Cyl rt={0.05} rb={0.05} h={0.02} p={[0, shadeH + cord - 0.02, 0]} color={color} seg={12} />
        </>
      );
    }
    case "wallLight": {
      const kel = kelvinToHex(item.kelvin ?? 2700);
      return (
        <>
          <Bx s={[Math.min(W, 0.12), Math.min(H, 0.12), 0.02]} p={[0, H / 2, D / 2 - 0.01]} color={color} />
          <Cyl
            rt={Math.min(W, H) * 0.35}
            rb={Math.min(W, H) * 0.45}
            h={H * 0.6}
            p={[0, H * 0.2, 0]}
            color={mixHex(color, kel, 0.4)}
            emissive={kel}
            emissiveIntensity={0.7}
            open
            side={THREE.DoubleSide}
            seg={16}
          />
        </>
      );
    }
    case "ledStrip": {
      const kel = kelvinToHex(item.kelvin ?? 2700);
      return (
        <mesh position={[0, Math.min(H, 0.02) / 2, 0]}>
          <boxGeometry args={[W, Math.min(H, 0.015), Math.min(D, 0.015)]} />
          <meshBasicMaterial color={kel} toneMapped={false} />
        </mesh>
      );
    }
    case "rug":
      return <Rug item={item} W={W} D={D} color={color} />;
    case "curtain":
      return <Curtain W={W} D={D} H={H} color={color} />;
    case "blind": {
      const ph = H * 0.5;
      return (
        <>
          <Bx s={[W, 0.05, 0.05]} p={[0, H - 0.025, 0]} color={dark} />
          <Bx s={[W - 0.02, ph, 0.01]} p={[0, H - 0.05 - ph / 2, 0]} color={color} rough={0.95} />
          <Bx s={[W - 0.02, 0.025, 0.02]} p={[0, H - 0.05 - ph, 0]} color={dark} />
        </>
      );
    }
    case "plant": {
      const r = Math.min(W, D) / 2;
      const potH = Math.min(0.4, H * 0.3);
      const blobs: ReactNode[] = [];
      const greens = ["#4f7a43", "#5d8c4c", "#3f6b3a", "#6a9a55"];
      const n = 6 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const rr = rand() * r * 0.55;
        const br = Math.max(0.05, Math.min(r * 0.6, (H - potH) * 0.3) * (0.6 + rand() * 0.5));
        const by = potH + br * 0.6 + rand() * Math.max(H - potH - br * 1.6, 0.01);
        blobs.push(
          <mesh
            key={i}
            position={[Math.cos(a) * rr, by, Math.sin(a) * rr]}
            rotation={[rand(), rand(), rand()]}
            scale={[1, 1.25, 1]}
            castShadow
            receiveShadow
          >
            <icosahedronGeometry args={[br, 0]} />
            <Mat color={greens[i % greens.length]} flat rough={0.85} />
          </mesh>,
        );
      }
      return (
        <>
          <Cyl rt={r * 0.75} rb={r * 0.55} h={potH} p={[0, 0, 0]} color={color} rough={0.9} seg={14} />
          <Cyl rt={r * 0.7} rb={r * 0.7} h={0.01} p={[0, potH - 0.03, 0]} color="#4a3626" seg={14} />
          <Cyl rt={0.012} rb={0.015} h={Math.max(H - potH - 0.1, 0.05)} p={[0, potH - 0.02, 0]} color="#5a4632" seg={5} />
          {blobs}
        </>
      );
    }
    case "art": {
      const fT = Math.min(D, 0.03);
      const inner = mixHex(color, "#ffffff", 0.75);
      return (
        <>
          <Bx s={[W, H, fT]} p={[0, H / 2, D / 2 - fT / 2]} color={color} />
          <Bx s={[W * 0.86, H * 0.86, 0.004]} p={[0, H / 2, D / 2 - fT - 0.002]} color={inner} />
          <Bx s={[W * 0.4, H * 0.3, 0.003]} p={[-W * 0.12, H * 0.58, D / 2 - fT - 0.006]} color={mixHex("#c46a4b", color, 0.2)} />
          <Bx s={[W * 0.3, H * 0.35, 0.003]} p={[W * 0.15, H * 0.38, D / 2 - fT - 0.006]} color={mixHex("#4a6fa5", color, 0.2)} />
        </>
      );
    }
    case "mirror": {
      const fT = Math.min(D, 0.03);
      return (
        <>
          <Bx s={[W, H, fT]} p={[0, H / 2, D / 2 - fT / 2]} color={color} metal={0.3} rough={0.4} />
          <Bx s={[W * 0.9, H * 0.94, 0.004]} p={[0, H / 2, D / 2 - fT - 0.002]} color="#dfe8ee" metal={0.9} rough={0.05} />
        </>
      );
    }
    case "decor": {
      const r = Math.min(W, D) / 2;
      return (
        <>
          <Cyl rt={r * 0.45} rb={r * 0.6} h={H} p={[-W * 0.15, 0, 0]} color={color} rough={0.4} seg={16} />
          <Bx s={[W * 0.35, H * 0.3, D * 0.5]} p={[W * 0.28, H * 0.15, 0]} color={mixHex(color, "#ffffff", 0.4)} />
        </>
      );
    }
    case "cushion":
      return <Soft s={[W, H, D]} p={[0, H / 2, 0]} color={color} r={Math.min(W, H, D) * 0.4} rough={1} />;
    case "throw":
      return <Soft s={[W, Math.min(H, 0.04), D]} p={[0, Math.min(H, 0.04) / 2, 0]} color={color} r={0.015} rough={1} />;
    case "paint":
    case "material":
      return <Cyl rt={Math.min(W, D) / 2} rb={Math.min(W, D) / 2} h={H} p={[0, 0, 0]} color={color} metal={0.4} rough={0.4} seg={16} />;
    default:
      return <Soft s={[W, H, D]} p={[0, H / 2, 0]} color={color} r={0.04} />;
  }
}

function Rug({ item, W, D, color }: { item: PlacedItem; W: number; D: number; color: string }) {
  const tex = useMemo(() => getRugTexture(color, item.id || "rug"), [color, item.id]);
  const selected = useContext(SelectedCtx);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
      <planeGeometry args={[W, D]} />
      <meshStandardMaterial
        map={tex}
        roughness={1}
        emissive={selected ? HIGHLIGHT_HEX : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
      />
    </mesh>
  );
}

function foldedPanel(width: number, height: number, amp: number, foldW: number): THREE.BufferGeometry {
  const segX = Math.max(8, Math.round((width / foldW) * 8));
  const g = new THREE.PlaneGeometry(width, height, segX, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    pos.setZ(i, Math.sin(((px + width / 2) / foldW) * Math.PI * 2) * amp);
  }
  g.computeVertexNormals();
  return g;
}

function Curtain({ W, D, H, color }: { W: number; D: number; H: number; color: string }) {
  const panelW = W < 0.6 ? W : W * 0.3;
  const amp = Math.min(0.035, Math.max(D / 2 - 0.01, 0.01));
  const geo = useMemo(() => foldedPanel(panelW, H - 0.04, amp, 0.11), [panelW, H, amp]);
  useEffect(() => () => geo.dispose(), [geo]);
  const xs = W < 0.6 ? [0] : [-W / 2 + panelW / 2, W / 2 - panelW / 2];
  return (
    <>
      <mesh position={[0, H - 0.015, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, W + 0.1, 8]} />
        <Mat color="#3a3a3a" metal={0.5} rough={0.4} />
      </mesh>
      {xs.map((px) => (
        <mesh key={px} geometry={geo} position={[px, (H - 0.04) / 2, 0]} castShadow receiveShadow>
          <Mat color={color} rough={1} side={THREE.DoubleSide} opacity={0.95} />
        </mesh>
      ))}
    </>
  );
}
