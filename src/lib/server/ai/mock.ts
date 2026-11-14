import "server-only";
import type { DesignDNA, InventoryItem, RoomModel } from "@/lib/types";
import type { BriefsOut, ConceptsOut, DesignOut, RepairOut, RoomAnalysis, SubmitProducts } from "./schemas";
import type { Emitter } from "./ndjson";
import { sleep } from "./ndjson";
import type { SlotRequest } from "./products";

// Mock mode: realistic fixtures + simulated streaming, so UI work and tests cost nothing.

const MOCK_COST = (step: string, usd: number, searches = 0) => ({
  step,
  model: "mock",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  searches,
  fetches: 0,
  images: 0,
  usd,
  at: Date.now(),
  note: "mock",
});

async function simulate(emit: Emitter, label: string, steps = 4, ms = 250) {
  for (let i = 1; i <= steps; i++) {
    emit.progress(`${label} (mock ${i}/${steps})`, i, steps);
    await sleep(ms);
  }
}

export const TEST_ROOM: RoomModel = {
  version: 1,
  corners: [
    { x: 0, y: 0 },
    { x: 0, y: 360 },
    { x: 420, y: 360 },
    { x: 420, y: 150 },
    { x: 540, y: 150 },
    { x: 540, y: 0 },
  ],
  northAngle: 0,
  ceilingHeight: 250,
  slopes: [{ id: "s1", wallIndex: 2, kneeWallHeight: 100, fullHeightDistance: 160 }],
  wallFeatures: [
    { id: "f-door", kind: "door", wallIndex: 6, offset: 400, width: 80, z: 0, height: 200, hinge: "end", opens: "inward" },
    { id: "f-win", kind: "window", wallIndex: 5, offset: 25, width: 100, z: 90, height: 120, opening: "tilt-turn" },
    { id: "f-rad", kind: "radiator", wallIndex: 5, offset: 25, width: 100, z: 15, height: 60 },
    { id: "f-s1", kind: "socket", wallIndex: 3, offset: 20, width: 8, z: 30, height: 8 },
    { id: "f-s2", kind: "socket", wallIndex: 3, offset: 190, width: 8, z: 30, height: 8 },
    { id: "f-s3", kind: "socket", wallIndex: 6, offset: 485, width: 8, z: 30, height: 8 },
    { id: "f-sw", kind: "switch", wallIndex: 6, offset: 490, width: 8, z: 105, height: 8 },
  ],
  ceilingFeatures: [
    { id: "c-rw", kind: "roofWindow", x: 210, y: 296, width: 78, length: 118, lowerEdgeZ: 120, typeCode: "GGL MK06" },
    { id: "c-light", kind: "ceilingLight", x: 210, y: 180 },
  ],
  wallColor: "white",
  floorType: "oak-look laminate",
  estimates: {},
};

export async function mockAnalysis(emit: Emitter, known: RoomModel | null): Promise<RoomAnalysis> {
  await simulate(emit, "Analysing room photos");
  emit.cost(MOCK_COST("analysis", 0.05));
  const base = known && known.corners.length >= 3 ? known : TEST_ROOM;
  const userGaveNothing = !known || known.corners.length < 3;
  return {
    corners: base.corners,
    northAngle: base.northAngle,
    ceilingHeight: base.ceilingHeight || 250,
    slopes: base.slopes.map((s) => ({ wallIndex: s.wallIndex, kneeWallHeight: s.kneeWallHeight, fullHeightDistance: s.fullHeightDistance })),
    wallFeatures: (base.wallFeatures.length ? base.wallFeatures : TEST_ROOM.wallFeatures).map((f) => ({
      kind: f.kind,
      wallIndex: f.wallIndex,
      offset: f.offset,
      width: f.width,
      z: f.z,
      height: f.height,
      hinge: f.hinge ?? "none",
      opens: f.opens ?? "none",
      opening: f.opening ?? "none",
      depth: f.depth ?? 0,
      label: f.label ?? "",
    })),
    ceilingFeatures: (base.ceilingFeatures.length ? base.ceilingFeatures : TEST_ROOM.ceilingFeatures).map((c) => ({
      kind: c.kind,
      x: c.x,
      y: c.y,
      width: c.width ?? 0,
      length: c.length ?? 0,
      lowerEdgeZ: c.lowerEdgeZ ?? 0,
      typeCode: c.typeCode ?? "",
    })),
    wallColor: base.wallColor ?? "white",
    floorType: base.floorType ?? "oak-look laminate",
    estimates: userGaveNothing
      ? [
          { path: "corners.2.x", confidence: "low", reason: "Room length estimated from the photos (mock)." },
          { path: "wallFeatures.0.width", confidence: "high", reason: "Standard German interior door leaf 86 cm, opening ≈ 80 cm (mock)." },
          { path: "floorType", confidence: "medium", reason: "Looks like laminate in the photos (mock)." },
        ]
      : [],
    recognizedFurniture: [
      { name: "Double bed", category: "bed", w: 140, d: 200, h: 90, color: "white", material: "wood", notes: "with headboard (mock)" },
      { name: "Desk", category: "desk", w: 120, d: 60, h: 75, color: "white", material: "laminate", notes: "(mock)" },
    ],
    warnings: userGaveNothing ? ["No real measurement given — all dimensions are rough estimates. Please measure at least the door width or ceiling height."] : [],
    summary: "Attic bedroom with a niche and a sloped ceiling on the north side (mock analysis).",
  };
}

// --- Concepts ----------------------------------------------------------------

function bbox(room: RoomModel) {
  const xs = room.corners.map((c) => c.x);
  const ys = room.corners.map((c) => c.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

interface MockItem {
  key: string;
  cat: DesignOut["items"][number]["category"];
  label: string;
  x: number;
  y: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  mount?: DesignOut["items"][number]["mount"];
  inv?: "bed" | "desk" | "wardrobe";
  kelvin?: number;
  lumens?: number;
  color: string;
  material: string;
  price?: [number, number];
  stackedOn?: string;
}

const BASE_LAYOUT: MockItem[] = [
  { key: "bed", cat: "bed", label: "Bed", x: 108, y: 175, rot: 90, w: 140, d: 200, h: 90, inv: "bed", color: "#e8e4dc", material: "wood" },
  { key: "desk", cat: "desk", label: "Desk", x: 485, y: 75, rot: 270, w: 120, d: 60, h: 75, inv: "desk", color: "#f2f0eb", material: "laminate" },
  { key: "wardrobe", cat: "wardrobe", label: "Wardrobe", x: 385, y: 200, rot: 270, w: 100, d: 60, h: 200, inv: "wardrobe", color: "#f5f3ee", material: "laminate" },
  { key: "chair", cat: "deskChair", label: "Desk chair", x: 430, y: 75, rot: 90, w: 50, d: 50, h: 90, color: "#3a3a3a", material: "fabric", price: [49, 129] },
  { key: "ns1", cat: "nightstand", label: "Nightstand", x: 25, y: 268, rot: 90, w: 40, d: 35, h: 50, color: "#c9a77c", material: "oak", price: [25, 79] },
  { key: "rug", cat: "rug", label: "Rug 160×230", x: 150, y: 175, rot: 90, w: 160, d: 230, h: 1, color: "#d9cfc1", material: "wool blend", price: [39, 119] },
  { key: "shelf", cat: "shelf", label: "Low shelf", x: 300, y: 330, rot: 180, w: 120, d: 30, h: 70, color: "#c9a77c", material: "oak veneer", price: [45, 129] },
  { key: "floorlamp", cat: "floorLamp", label: "Floor lamp", x: 330, y: 240, rot: 0, w: 35, d: 35, h: 150, color: "#2b2b2b", material: "metal", kelvin: 2700, lumens: 800, price: [29, 89] },
  { key: "pendant", cat: "pendantLamp", label: "Pendant lamp", x: 210, y: 180, rot: 0, w: 40, d: 40, h: 30, z: 190, mount: "ceiling", color: "#e9dcc5", material: "paper", kelvin: 2700, lumens: 1000, price: [19, 69] },
  { key: "led", cat: "ledStrip", label: "LED strip (knee wall)", x: 210, y: 356, rot: 180, w: 300, d: 2, h: 1, z: 95, mount: "wall", color: "#fff1d6", material: "LED", kelvin: 2700, lumens: 600, price: [19, 49] },
  { key: "curtain", cat: "curtain", label: "Curtain (niche window)", x: 533, y: 75, rot: 270, w: 140, d: 5, h: 125, z: 92, mount: "wall", color: "#ece6da", material: "linen-look", price: [19, 59] },
  { key: "plant", cat: "plant", label: "Pothos in pot", x: 390, y: 320, rot: 0, w: 35, d: 35, h: 60, color: "#4f7a4a", material: "plant", price: [15, 39] },
];

const VARIANTS: { name: string; style: string; summary: string; palette: [string, string, string]; paint: [string, string, string]; accents: { name: string; hex: string }[] }[] = [
  {
    name: "Calm sleep & focus nook",
    style: "light wood, white walls, soft linen, simple shapes",
    summary: "The bed stays on the west wall out of the door's swing; the niche becomes a bright desk corner facing the window; low storage uses the space under the slope.",
    palette: ["#e8e4dc", "#c9a77c", "#ece6da"],
    paint: ["Alpina Feine Farben", "Sanfter Morgen", "#dfe3d6"],
    accents: [
      { name: "sage", hex: "#a9b8a0" },
      { name: "oat", hex: "#e3d8c6" },
    ],
  },
  {
    name: "Warm earthy retreat",
    style: "warm terracotta accents, dark wood, cosy textured fabrics",
    summary: "A warm, cocooning bedroom: terracotta accent wall behind the bed, darker wood furniture and layered warm light.",
    palette: ["#b5654a", "#6b4a33", "#e9d6c0"],
    paint: ["Schöner Wohnen Trendfarbe", "Terracotta", "#c7795d"],
    accents: [
      { name: "terracotta", hex: "#c7795d" },
      { name: "sand", hex: "#e9d6c0" },
    ],
  },
  {
    name: "Bright minimal studio",
    style: "white and light grey, black metal details, very few things",
    summary: "Maximum calm and space: everything light, black metal lamps as accents, closed storage only.",
    palette: ["#f4f4f2", "#2b2b2b", "#d0d3d4"],
    paint: ["Hornbach Colours", "Cloud White", "#f2f2ee"],
    accents: [
      { name: "graphite", hex: "#3b3d40" },
      { name: "stone", hex: "#c9c7c1" },
    ],
  },
];

function mapInventory(inventory: InventoryItem[]) {
  const find = (cat: string) => inventory.find((i) => i.category === cat);
  return { bed: find("bed"), desk: find("desk"), wardrobe: find("wardrobe") };
}

export function mockDesign(room: RoomModel, inventory: InventoryItem[], v: number, budget: number | null, approach: DesignOut["approach"] = "none"): DesignOut {
  const b = bbox(room);
  const sx = b.w / 540;
  const sy = b.h / 360;
  const inv = mapInventory(inventory);
  const variant = VARIANTS[v % VARIANTS.length];
  const items: DesignOut["items"] = [];
  const slots: DesignOut["slots"] = [];
  for (const m of BASE_LAYOUT) {
    const invItem = m.inv ? inv[m.inv] : undefined;
    const isSlot = !invItem;
    const color = m.key === "bed" || m.key === "wardrobe" ? variant.palette[0] : m.key === "ns1" || m.key === "shelf" ? variant.palette[1] : m.key === "curtain" || m.key === "rug" ? variant.palette[2] : m.color;
    items.push({
      key: m.key,
      ref: isSlot ? "slot" : "inventory",
      inventoryId: invItem?.id ?? "",
      slotKey: isSlot ? `s-${m.key}` : "",
      category: m.cat,
      label: invItem?.name ?? m.label,
      x: Math.round(b.minX + m.x * sx),
      y: Math.round(b.minY + m.y * sy),
      rotation: m.rot,
      w: invItem?.w ?? m.w,
      d: invItem?.d ?? m.d,
      h: invItem?.h ?? m.h,
      z: m.z ?? 0,
      mount: m.mount ?? "floor",
      stackedOnKey: m.stackedOn ?? "",
      colorHex: color,
      material: m.material,
      kelvin: m.kelvin ?? 0,
      lumens: m.lumens ?? 0,
    });
    if (isSlot) {
      const [pb, pn] = m.price ?? [99, 249];
      slots.push({
        key: `s-${m.key}`,
        placedKey: m.key,
        category: m.cat,
        label: m.label,
        maxW: m.w + 10,
        maxD: m.d + 5,
        maxH: m.h + 10,
        color,
        material: m.material,
        styleTags: variant.style.split(", ").slice(0, 3),
        targetBudget: pb,
        targetNicer: pn,
        quantity: 1,
        lookAlike: approach !== "none" && m.key === "pendant" ? "large round paper/rattan pendant, warm light" : "",
        notes: "",
      });
    }
  }
  slots.push(
    {
      key: "s-paint",
      placedKey: "",
      category: "paint",
      label: `Wall paint ${variant.paint[1]}`,
      maxW: 0,
      maxD: 0,
      maxH: 0,
      color: variant.paint[2],
      material: "interior wall paint, matt",
      styleTags: [],
      targetBudget: 35,
      targetNicer: 60,
      quantity: 1,
      lookAlike: "",
      notes: "accent wall W1 behind the bed",
    },
    {
      key: "s-materials",
      placedKey: "",
      category: "material",
      label: "Painter's tape + roller kit",
      maxW: 0,
      maxD: 0,
      maxH: 0,
      color: "",
      material: "",
      styleTags: [],
      targetBudget: 15,
      targetNicer: 25,
      quantity: 1,
      lookAlike: "",
      notes: "",
    },
    {
      key: "s-blind",
      placedKey: "",
      category: "blind",
      label: "Roof window blackout blind (GGL MK06)",
      maxW: 78,
      maxD: 0,
      maxH: 118,
      color: variant.palette[2],
      material: "blackout fabric",
      styleTags: [],
      targetBudget: 45,
      targetNicer: 89,
      quantity: 1,
      lookAlike: "",
      notes: "matching type code MK06",
    },
  );
  // Respect budget roughly: scale budget targets if needed.
  const total = slots.reduce((s, x) => s + x.targetBudget, 0);
  if (budget && total > budget) {
    const f = budget / total;
    slots.forEach((s) => (s.targetBudget = Math.max(5, Math.floor(s.targetBudget * f))));
  }
  return {
    name: variant.name,
    summary: variant.summary,
    style: variant.style,
    inspirationUse: approach !== "none" ? "Took over the warm palette and the big pendant lamp as a look-alike (mock)." : "",
    approach,
    items,
    removed: [],
    slots,
    lighting: {
      zones: [
        { name: "Ambient", kind: "ambient", description: "Pendant in the room centre, dimmable." },
        { name: "Desk", kind: "task", description: "Daylight from the east window, desk lamp 4000 K for evenings." },
        { name: "Cosy accent", kind: "accent", description: "Indirect LED strip along the knee wall + floor lamp." },
      ],
      lights: [
        { label: "Pendant lamp", placedKey: "pendant", zone: "ambient", lumens: 1000, kelvin: 2700, dimmable: true, base: "E27", bulbIncluded: false, indirect: false },
        { label: "LED strip (knee wall)", placedKey: "led", zone: "accent", lumens: 600, kelvin: 2700, dimmable: true, base: "integrated LED", bulbIncluded: true, indirect: true },
        { label: "Floor lamp", placedKey: "floorlamp", zone: "accent", lumens: 800, kelvin: 2700, dimmable: false, base: "E27", bulbIncluded: false, indirect: true },
      ],
      daylight: "Morning sun through the east window lights the desk; the roof window brings top light over the bed — blackout blind for sleep.",
    },
    paint: { use: true, brand: variant.paint[0], colorName: variant.paint[1], colorCode: "N/A (mock)", hex: variant.paint[2], surfaces: ["W1"] },
    accents: variant.accents,
    textiles: [
      { item: "Curtain", detail: "Rod 130 cm (15 cm wider each side), 2 panels à 140 cm, ending at the sill above the radiator." },
      { item: "Rug", detail: "160×230 cm under the lower two thirds of the bed, extends 50+ cm beside it." },
    ],
    plantsDecor: [{ item: "Pothos", detail: "Tolerates the bright-indirect light near the east window." }],
    whyBetter: "Clear 90 cm path from the door, desk with daylight in the niche, storage moved to full-height wall, the low slope area used for low furniture.",
  };
}

export async function mockConcepts(
  emit: Emitter,
  room: RoomModel,
  inventory: InventoryItem[],
  count: number,
  budget: number | null,
  inspiration: boolean,
  startIdx = 0,
): Promise<ConceptsOut> {
  await simulate(emit, "Designing", 4, 250);
  emit.cost(MOCK_COST("concepts", 0.06 * count));
  const approaches: DesignOut["approach"][] = inspiration
    ? ["close to the inspiration", "inspiration on a budget", "loose interpretation, adapted to this room"]
    : ["none", "none", "none"];
  return { designs: Array.from({ length: count }, (_, i) => mockDesign(room, inventory, startIdx + i, budget, approaches[(startIdx + i) % 3])) };
}

export async function mockBriefs(emit: Emitter, _room: RoomModel, count: number, inspiration: boolean): Promise<BriefsOut> {
  void _room;
  await simulate(emit, "Choosing design directions", 2, 200);
  emit.cost(MOCK_COST("briefs", 0.01));
  const approaches = ["close to the inspiration", "inspiration on a budget", "loose interpretation, adapted to this room"];
  return {
    briefs: Array.from({ length: count }, (_, i) => ({
      index: i,
      name: VARIANTS[i % 3].name,
      style: VARIANTS[i % 3].style,
      approach: inspiration ? approaches[i % 3] : "none",
      layoutIdea: "Bed on the west wall out of the door swing, desk in the niche by the window (mock).",
      palette: [...VARIANTS[i % 3].palette],
      keyPieces: ["bed", "desk", "pendant"],
    })),
  } as BriefsOut;
}

export async function mockRepair(emit: Emitter): Promise<RepairOut> {
  await simulate(emit, "Repairing layout", 2);
  emit.cost(MOCK_COST("repair", 0.02));
  return { moves: [], removeItemIds: [], explanation: "No changes (mock)." };
}

const SHOPS = ["IKEA", "Amazon.de", "Otto", "Hornbach", "Dehner"];

export async function mockProducts(emit: Emitter, slots: SlotRequest[], mode: "tiers" | "alternatives"): Promise<SubmitProducts> {
  await simulate(emit, mode === "alternatives" ? "Finding alternatives" : "Finding products", 3, 300);
  emit.cost(MOCK_COST(mode === "alternatives" ? "alternatives" : "products", mode === "alternatives" ? 0.03 : 0.12, mode === "alternatives" ? 2 : 8));
  const products: SubmitProducts["products"] = [];
  for (const s of slots) {
    const tiers: ("budget" | "nicer" | "alternative")[] = mode === "alternatives" ? ["alternative"] : ["budget", "nicer"];
    for (const tier of tiers) {
      const n = tier === "alternative" ? 5 : 2;
      for (let r = 1; r <= n; r++) {
        const base = tier === "nicer" ? s.targetNicer : s.targetBudget;
        const shop = s.category === "paint" || s.category === "material" ? "Hornbach" : s.category === "plant" ? "Dehner" : SHOPS[(r + s.key.length) % 3];
        const price = Math.max(4.99, Math.round((base * (0.85 + r * 0.08)) * 100) / 100 - 0.01);
        const shrink = tier === "alternative" ? r * 3 : 0;
        products.push({
          slotKey: s.key,
          tier,
          rank: r,
          name: `${s.label} ${tier === "nicer" ? "Premium" : tier === "alternative" ? `Alt ${r}` : "Basic"} (mock)`,
          shop,
          priceEur: price,
          url: `https://example.com/mock/${encodeURIComponent(s.key)}/${tier}/${r}`,
          w: s.maxW ? Math.max(1, s.maxW - 10 - shrink) : 0,
          d: s.maxD ? Math.max(1, s.maxD - 5) : 0,
          h: s.maxH ? Math.max(1, s.maxH - 10) : 0,
          dimsVerified: s.maxW > 0,
          why: `Fits the ${s.color || "planned"} look at a fair price (mock).`,
          assembly: ["wardrobe", "shelf", "desk", "nightstand", "bed"].includes(s.category),
          bulky: ["wardrobe", "bed", "sofa"].includes(s.category),
          pickup: shop === "IKEA",
          similarity: s.lookAlike ? "Similar round shape and warm light (mock)." : "",
        });
      }
    }
  }
  return { products, notes: "Mock products — no real search was performed." };
}

export async function mockDna(emit: Emitter): Promise<DesignDNA> {
  await simulate(emit, "Reading the inspiration", 3);
  emit.cost(MOCK_COST("inspiration", 0.04));
  return {
    palette: [
      { name: "warm white", hex: "#f3ede3" },
      { name: "sand", hex: "#dccbb2" },
      { name: "terracotta", hex: "#c47a58" },
      { name: "olive", hex: "#7d8458" },
      { name: "dark oak", hex: "#5b4330" },
    ],
    materials: ["rattan", "linen", "dark oak", "ceramic"],
    shapes: ["rounded edges", "low furniture", "arched mirror"],
    signaturePieces: [
      { name: "Rattan pendant lamp", description: "large round rattan shade, ~50 cm, warm light" },
      { name: "Low oak bench", description: "simple low bench in dark oak at the foot of the bed" },
    ],
    lightingMood: "Warm, dim evening light from several low sources",
    kelvin: 2700,
    textiles: ["washed linen bedding", "chunky knit throw", "jute rug"],
    plantsDecor: ["olive tree in terracotta pot", "ceramic vases"],
    layoutIdeas: ["bed centred on the wall with symmetric nightstands"],
    feel: "Warm, relaxed, Mediterranean-holiday calm",
    doesNotTransfer: ["very high ceiling", "large arched window"],
  };
}
