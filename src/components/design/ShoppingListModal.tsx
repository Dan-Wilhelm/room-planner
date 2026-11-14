"use client";

import { updateDesign } from "@/lib/db";
import type { Design, Tier } from "@/lib/types";
import { Badge, Button, downloadBlob, ExternalLink, Modal } from "../ui";
import { shoppingRows, toCsv } from "./shopping";

export function ShoppingListModal({ design, tier, open, onClose }: { design: Design; tier: Tier; open: boolean; onClose: () => void }) {
  const rows = shoppingRows(design, tier);
  const byShop = new Map<string, typeof rows>();
  for (const r of rows) byShop.set(r.shop, [...(byShop.get(r.shop) ?? []), r]);
  const total = rows.reduce((s, r) => s + r.lineTotal, 0);
  const open_ = rows.filter((r) => !r.bought).reduce((s, r) => s + r.lineTotal, 0);
  return (
    <Modal open={open} onClose={onClose} title={`Shopping list — ${design.name} (${tier === "budget" ? "Budget" : "A bit nicer"})`} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          Total €{total.toFixed(2)} · still to buy €{open_.toFixed(2)} · shipping not included
        </span>
        <div className="ml-auto flex gap-2 print:hidden">
          <Button size="sm" onClick={() => navigator.clipboard.writeText(rows.map((r) => `${r.shop}\t${r.item}\t${r.name}\t${r.qty}×\t€${r.lineTotal.toFixed(2)}\t${r.url}`).join("\n"))}>
            Copy
          </Button>
          <Button size="sm" onClick={() => downloadBlob(new Blob([toCsv(rows)], { type: "text/csv" }), `${design.name}-${tier}.csv`)}>
            CSV
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        {[...byShop.entries()].map(([shop, list]) => (
          <div key={shop}>
            <h4 className="mb-1 font-semibold">
              {shop} <span className="text-sm font-normal text-stone-500">€{list.reduce((s, r) => s + r.lineTotal, 0).toFixed(2)}</span>
            </h4>
            <table className="w-full text-sm">
              <tbody>
                {list.map((r) => (
                  <tr key={r.slotId} className="border-t border-stone-100 align-top">
                    <td className="py-1 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`Bought ${r.name}`}
                        checked={r.bought}
                        onChange={(e) => updateDesign(design.id, (d) => ({ bought: { ...d.bought, [r.slotId]: e.target.checked } }))}
                      />
                    </td>
                    <td className={`py-1 pr-2 ${r.bought ? "text-stone-400 line-through" : ""}`}>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-stone-500">
                        for: {r.item}
                        {r.notes && ` · ${r.notes}`}
                      </div>
                    </td>
                    <td className="py-1 pr-2 tabular-nums">
                      {r.qty > 1 ? `${r.qty} × €${r.priceEur.toFixed(2)} = ` : ""}€{r.lineTotal.toFixed(2)}
                    </td>
                    <td className="py-1 pr-2">
                      <Badge tone={r.linkStatus === "verified" ? "green" : r.linkStatus === "unchecked" ? "stone" : "amber"}>{r.linkStatus}</Badge>
                      <div className="text-[11px] text-stone-400">found on {r.foundOn}</div>
                    </td>
                    <td className="py-1">
                      <ExternalLink href={r.url}>open</ExternalLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Modal>
  );
}
