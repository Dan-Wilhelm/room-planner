import type { DesignOut } from "@/lib/server/ai/schemas";
import { newId } from "./db";
import type { Design, ID, InventoryItem, PlacedItem, Slot, Tier } from "./types";

const MAX_SLOTS = 20;
const num = (v: number, min = 0) => (Number.isFinite(v) ? Math.max(min, Math.round(v)) : min);
const rot = (v: number) => ((Math.round(v) % 360) + 360) % 360;
const hex = (v: string, fallback = "#bbbbbb") => (/^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : fallback);

export interface ConvertCtx {
  roomId: ID;
  projectId: ID;
  roomModelVersion: number;
  runId: ID;
  inventory: InventoryItem[];
  parent?: Design; // build-on
  lockedIds?: ID[]; // slot/item ids from the parent that must be kept
}

/** Converts an AI design (keys) into an app Design (ids). Locked parent slots keep their id + products. */
export function designFromOut(out: DesignOut, ctx: ConvertCtx): Design {
  const invIds = new Set(ctx.inventory.map((i) => i.id));
  const locked = new Set(ctx.lockedIds ?? []);
  const parentSlots = new Map((ctx.parent?.slots ?? []).map((s) => [s.id, s]));
  const parentItems = new Map((ctx.parent?.items ?? []).map((i) => [i.id, i]));

  const itemId = new Map<string, ID>();
  const slotId = new Map<string, ID>();
  for (const it of out.items) itemId.set(it.key, locked.has(it.key) && parentItems.has(it.key) ? it.key : newId());
  for (const s of out.slots.slice(0, MAX_SLOTS)) slotId.set(s.key, locked.has(s.key) && parentSlots.has(s.key) ? s.key : newId());

  const items: PlacedItem[] = [];
  for (const it of out.items) {
    const id = itemId.get(it.key)!;
    let ref: PlacedItem["ref"] | null = null;
    if (it.ref === "inventory" && invIds.has(it.inventoryId)) ref = { type: "inventory", inventoryId: it.inventoryId };
    else if (it.slotKey && slotId.has(it.slotKey)) ref = { type: "slot", slotId: slotId.get(it.slotKey)! };
    if (!ref) continue; // dangling reference (unknown inventory id or slot beyond the limit)
    const parentItem = parentItems.get(id);
    if (parentItem && locked.has(id)) {
      items.push(parentItem);
      continue;
    }
    items.push({
      id,
      ref,
      category: it.category,
      label: it.label,
      x: num(it.x, -10000),
      y: num(it.y, -10000),
      rotation: rot(it.rotation),
      w: num(it.w, 1),
      d: num(it.d, 1),
      h: num(it.h, 1),
      z: it.z > 0 ? num(it.z) : undefined,
      mount: it.mount,
      stackedOn: it.stackedOnKey ? itemId.get(it.stackedOnKey) : undefined,
      colorHex: hex(it.colorHex),
      material: it.material || undefined,
      kelvin: it.kelvin > 0 ? num(it.kelvin) : undefined,
      lumens: it.lumens > 0 ? num(it.lumens) : undefined,
    });
  }

  const products: Design["products"] = {};
  const slots: Slot[] = [];
  for (const s of out.slots.slice(0, MAX_SLOTS)) {
    const id = slotId.get(s.key)!;
    const parentSlot = parentSlots.get(id);
    if (parentSlot && locked.has(id)) {
      slots.push(parentSlot);
      if (ctx.parent?.products[id]) products[id] = structuredClone(ctx.parent.products[id]);
      continue;
    }
    slots.push({
      id,
      placedItemId: s.placedKey ? (itemId.get(s.placedKey) ?? null) : null,
      category: s.category,
      label: s.label,
      maxW: num(s.maxW),
      maxD: num(s.maxD),
      maxH: num(s.maxH),
      color: s.color,
      material: s.material,
      styleTags: s.styleTags.slice(0, 6),
      targetPrice: { budget: Math.max(0, s.targetBudget), nicer: Math.max(0, s.targetNicer) },
      quantity: Math.max(1, Math.round(s.quantity) || 1),
      lookAlike: s.lookAlike || undefined,
      notes: s.notes || undefined,
    });
  }

  return {
    id: newId(),
    roomId: ctx.roomId,
    projectId: ctx.projectId,
    roomModelVersion: ctx.roomModelVersion,
    createdAt: Date.now(),
    parentDesignId: ctx.parent?.id,
    runId: ctx.runId,
    name: out.name,
    summary: out.summary,
    style: out.style,
    inspirationUse: out.inspirationUse || undefined,
    approach: out.approach === "none" ? undefined : out.approach,
    items,
    removed: out.removed.filter((r) => invIds.has(r.inventoryId)),
    slots,
    products,
    lighting: {
      zones: out.lighting.zones,
      lights: out.lighting.lights.map((l) => ({
        label: l.label,
        placedItemId: l.placedKey ? itemId.get(l.placedKey) : undefined,
        zone: l.zone,
        lumens: num(l.lumens),
        kelvin: num(l.kelvin),
        dimmable: l.dimmable,
        base: l.base,
        bulbIncluded: l.bulbIncluded,
        indirect: l.indirect,
      })),
      daylight: out.lighting.daylight,
    },
    colors: {
      paint: out.paint.use ? { brand: out.paint.brand, colorName: out.paint.colorName, colorCode: out.paint.colorCode, hex: hex(out.paint.hex, "#eeeeee"), surfaces: out.paint.surfaces } : null,
      accents: out.accents.map((a) => ({ name: a.name, hex: hex(a.hex) })),
    },
    paintCalc: null,
    textiles: out.textiles,
    plantsDecor: out.plantsDecor,
    whyBetter: out.whyBetter,
    warnings: [],
    status: "concept",
    locked: [...locked].filter((id) => itemId.has(id) || slotId.has(id) || [...itemId.values()].includes(id) || [...slotId.values()].includes(id)),
    bought: {},
    costs: [],
  };
}

/** Compact representation of a design for prompts (build-on, match another room). */
export function compactDesign(d: Design) {
  return {
    name: d.name,
    style: d.style,
    summary: d.summary,
    items: d.items.map((i) => ({
      key: i.id,
      ref: i.ref.type,
      inventoryId: i.ref.type === "inventory" ? i.ref.inventoryId : "",
      slotKey: i.ref.type === "slot" ? i.ref.slotId : "",
      category: i.category,
      label: i.label,
      x: i.x,
      y: i.y,
      rotation: i.rotation,
      w: i.w,
      d: i.d,
      h: i.h,
      z: i.z ?? 0,
      mount: i.mount ?? "floor",
      colorHex: i.colorHex ?? "",
      material: i.material ?? "",
    })),
    slots: d.slots.map((s) => ({ key: s.id, placedKey: s.placedItemId ?? "", category: s.category, label: s.label, maxW: s.maxW, maxD: s.maxD, maxH: s.maxH, color: s.color, material: s.material, targetBudget: s.targetPrice.budget, targetNicer: s.targetPrice.nicer })),
    paint: d.colors.paint,
    accents: d.colors.accents,
    lighting: d.lighting.zones,
  };
}

/** Product currently selected for a slot and tier (or null). */
export function selectedProduct(d: Design, slotId: ID, tier: Tier) {
  const sp = d.products[slotId];
  if (!sp) return null;
  const list = tier === "budget" ? sp.budget : sp.nicer;
  return list[sp.selected[tier]] ?? null;
}

/** Items with dimensions of the selected products for the given tier (for 3D / checks). */
export function itemsForTier(d: Design, tier: Tier): PlacedItem[] {
  const bySlot = new Map(d.slots.filter((s) => s.placedItemId).map((s) => [s.placedItemId!, s.id]));
  return d.items.map((it) => {
    const slot = bySlot.get(it.id);
    if (!slot) return it;
    const p = selectedProduct(d, slot, tier);
    if (!p || !p.dimsVerified) return it;
    return { ...it, w: p.w || it.w, d: p.d || it.d, h: p.h || it.h };
  });
}

export function tierTotal(d: Design, tier: Tier): number {
  let sum = 0;
  for (const s of d.slots) {
    const p = selectedProduct(d, s.id, tier);
    if (p) sum += p.priceEur * (s.category === "paint" ? 1 : s.quantity);
  }
  return Math.round(sum * 100) / 100;
}
