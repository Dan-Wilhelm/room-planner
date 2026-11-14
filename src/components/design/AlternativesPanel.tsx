"use client";

import { useState } from "react";
import { selectedProduct } from "@/lib/designConvert";
import { ensureSlotForItem, findAlternatives, replaceInventoryItem, swapProduct } from "@/lib/pipeline";
import { formatUsd } from "@/lib/pricing";
import type { Design, ID, ProductCandidate, Tier } from "@/lib/types";
import { Badge, Button, ExternalLink, Notice, Spinner, TextInput } from "../ui";
import { ProductCard } from "./ProductCard";

export function AlternativesPanel({
  design,
  itemId,
  slotId: slotIdProp,
  tier,
  keep,
  onClose,
}: {
  design: Design;
  itemId?: ID | null;
  slotId?: ID | null;
  tier: Tier;
  keep?: boolean; // existing inventory item flagged "keep" → only moving is allowed
  onClose: () => void;
}) {
  const item = itemId ? design.items.find((i) => i.id === itemId) : undefined;
  const slot = slotIdProp ? design.slots.find((s) => s.id === slotIdProp) : item?.ref.type === "slot" ? design.slots.find((s) => s.id === (item.ref as { slotId: ID }).slotId) : undefined;
  const inventoryKeep = item?.ref.type === "inventory" ? item : undefined;
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [alts, setAlts] = useState<ProductCandidate[] | null>(null);
  const [cost, setCost] = useState(0);
  const current = slot ? selectedProduct(design, slot.id, tier) : null;

  async function search() {
    setErr(null);
    setBusy("Searching…");
    setCost(0);
    try {
      let sid = slot?.id ?? null;
      if (!sid && item) sid = await ensureSlotForItem(design.id, item.id);
      if (!sid) throw new Error("This item can't be replaced.");
      const res = await findAlternatives(design.id, sid, wish, { onProgress: (_, m) => setBusy(m), onCost: (e) => setCost((c) => c + e.usd) });
      setAlts(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function swap(c: ProductCandidate, mode: "auto-adjust" | "keep anyway") {
    let sid = slot?.id ?? null;
    if (!sid && item) sid = await ensureSlotForItem(design.id, item.id);
    if (!sid) return;
    if (item && item.ref.type === "inventory") await replaceInventoryItem(design.id, item.id, sid);
    await swapProduct(design.id, sid, tier, c, mode);
    setAlts(null);
  }

  const isKeep = !!inventoryKeep && !slot && !!keep;

  return (
    <aside className="rounded-xl bg-white p-4 shadow-lg ring-1 ring-stone-200">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">Selected</p>
          <h3 className="font-semibold">{slot?.label ?? item?.label}</h3>
          {item && (
            <p className="text-xs text-stone-500">
              {item.w}×{item.d}×{item.h} cm at ({item.x}, {item.y}) · {item.rotation}°
            </p>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-stone-500 hover:bg-stone-100" aria-label="Close panel">
          ✕
        </button>
      </div>
      {current ? (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-stone-500">Current ({tier === "budget" ? "Budget" : "A bit nicer"})</p>
          <ProductCard p={current} compact />
        </div>
      ) : inventoryKeep ? (
        <Notice tone="info">This is furniture you already own.{isKeep ? " It is marked “keep” — you can only move it (drag it in the 2D view)." : " It is replaceable — you can search for a replacement."}</Notice>
      ) : null}
      {!isKeep && (
        <>
          <div className="mt-3 flex gap-2">
            <TextInput placeholder={slot?.category === "paint" ? "e.g. a warmer colour" : "e.g. cheaper, in green, 10 cm narrower"} value={wish} onChange={(e) => setWish(e.target.value)} />
            <Button variant="primary" onClick={search} disabled={!!busy}>
              Find alternatives
            </Button>
          </div>
          {busy && (
            <p className="mt-2 flex items-center gap-2 text-sm text-stone-600">
              <Spinner /> {busy}
            </p>
          )}
          {cost > 0 && <p className="mt-1 text-xs text-stone-500">cost {formatUsd(cost)}</p>}
          {err && (
            <div className="mt-2">
              <Notice tone="error">{err}</Notice>
            </div>
          )}
          {alts && alts.length === 0 && <p className="mt-3 text-sm text-stone-500">No verified alternatives found — try a different wish.</p>}
          {alts && (
            <div className="mt-3 space-y-2">
              {alts.map((c) => (
                <div key={c.id} className="rounded-lg border border-stone-200 p-2">
                  <ProductCard p={c} compact />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {c.fit && <Badge tone={c.fit === "fits" ? "green" : c.fit === "fits if moved" ? "amber" : "red"}>{c.fit}</Badge>}
                    {c.fitReason && c.fit !== "fits" && <span className="text-xs text-stone-500">{c.fitReason}</span>}
                    <div className="ml-auto flex gap-1">
                      {c.fit !== "fits" && c.fit !== undefined ? (
                        <>
                          <Button size="sm" onClick={() => swap(c, "auto-adjust")}>
                            Swap & auto-adjust
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => swap(c, "keep anyway")}>
                            Keep anyway
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => swap(c, "auto-adjust")}>
                          Swap in
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {current && (
        <p className="mt-3 text-xs text-stone-500">
          Shop page: <ExternalLink href={current.url} />
        </p>
      )}
    </aside>
  );
}
