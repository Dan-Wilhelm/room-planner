import { selectedProduct } from "@/lib/designConvert";
import type { Design, ID, LinkStatus, Tier } from "@/lib/types";

export interface ShoppingRow {
  slotId: ID;
  item: string;
  name: string;
  shop: string;
  qty: number;
  priceEur: number;
  lineTotal: number;
  url: string;
  linkStatus: LinkStatus;
  foundOn: string;
  bought: boolean;
  notes: string;
}

export function shoppingRows(d: Design, tier: Tier): ShoppingRow[] {
  const rows: ShoppingRow[] = [];
  for (const s of d.slots) {
    const p = selectedProduct(d, s.id, tier);
    if (!p) continue;
    const qty = s.category === "paint" ? 1 : s.quantity;
    const notes = [
      s.category === "paint" && d.paintCalc ? `${d.paintCalc.litersNeeded} L needed (${d.paintCalc.buckets.join(" + ")} L buckets)` : "",
      p.assembly ? "assembly needed" : "",
      p.bulky ? "bulky — car needed" : "",
      p.pickup ? "pickup possible" : "",
    ]
      .filter(Boolean)
      .join("; ");
    rows.push({
      slotId: s.id,
      item: s.label,
      name: p.name,
      shop: p.shop,
      qty,
      priceEur: p.priceEur,
      lineTotal: Math.round(p.priceEur * qty * 100) / 100,
      url: p.url,
      linkStatus: p.linkStatus,
      foundOn: p.foundOn,
      bought: !!d.bought[s.id],
      notes,
    });
  }
  return rows.sort((a, b) => a.shop.localeCompare(b.shop));
}

const esc = (v: string | number) => {
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: (ShoppingRow & { room?: string })[]): string {
  const head = ["Room", "Shop", "Item", "Product", "Qty", "Price EUR", "Line total EUR", "Link", "Link status", "Price found on", "Notes", "Bought"];
  const lines = rows.map((r) => [r.room ?? "", r.shop, r.item, r.name, r.qty, r.priceEur.toFixed(2), r.lineTotal.toFixed(2), r.url, r.linkStatus, r.foundOn, r.notes, r.bought ? "yes" : "no"].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}
