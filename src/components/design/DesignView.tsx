"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopView2D from "@/components/plan/TopView2D";
import { Scene3D } from "@/components/room/Scene3D";
import { CATEGORY_LABEL } from "@/lib/categories";
import { itemsForTier, selectedProduct, tierTotal } from "@/lib/designConvert";
import { addMedia, listMedia, updateDesign } from "@/lib/db";
import { recheckDesign } from "@/lib/pipeline";
import { formatUsd } from "@/lib/pricing";
import type { Design, ID, InventoryItem, Room, Tier } from "@/lib/types";
import { Badge, Button, Card, Notice, Swatch } from "../ui";
import { AlternativesPanel } from "./AlternativesPanel";
import { CostPanel } from "./CostPanel";
import { ImagePanel } from "./ImagePanel";
import { ProductCard } from "./ProductCard";
import { ShoppingListModal } from "./ShoppingListModal";

export type CameraState = { position: [number, number, number]; target: [number, number, number] };
export type Capture = { capture: (opts?: { width?: number }) => Promise<Blob> };

export function DesignView({
  design,
  room,
  inventory,
  tier,
  setTier,
  camera,
  setCamera,
  onBuildOn,
  onChoose,
}: {
  design: Design;
  room: Room;
  inventory: InventoryItem[];
  tier: Tier;
  setTier: (t: Tier) => void;
  camera: CameraState | undefined;
  setCamera: (c: CameraState) => void;
  onBuildOn: () => void;
  onChoose: () => void;
}) {
  const model = room.model!;
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [preset, setPreset] = useState<"perspective" | "top">("perspective");
  const [labels, setLabels] = useState(false);
  const [selected, setSelected] = useState<ID | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<ID | null>(null);
  const [shopping, setShopping] = useState(false);
  const captureRef = useRef<Capture | null>(null);
  const items = useMemo(() => itemsForTier(design, tier), [design, tier]);
  const outdated = design.roomModelVersion !== model.version;
  const paintedWalls = design.colors.paint?.surfaces ?? [];
  const chosen = room.chosenDesignId === design.id;
  const total = tierTotal(design, tier);
  const invById = new Map(inventory.map((i) => [i.id, i]));
  const selItem = selected ? design.items.find((i) => i.id === selected) : undefined;
  const keep = selItem?.ref.type === "inventory" ? invById.get(selItem.ref.inventoryId)?.flag === "keep" : false;

  // Capture a 3D thumbnail once for the project overview.
  useEffect(() => {
    if (view !== "3d") return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled || !captureRef.current) return;
      const existing = (await listMedia(design.id)).some((m) => m.kind === "screenshot");
      if (existing) return;
      try {
        const blob = await captureRef.current.capture({ width: 480 });
        if (blob.size > 0) await addMedia({ ownerId: design.id, kind: "screenshot", blob, width: 480, height: 0 });
      } catch {
        /* thumbnail is optional */
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [design.id, view]);

  const errorsAndWarnings = design.warnings.filter((w) => w.severity !== "hint");
  const hints = design.warnings.filter((w) => w.severity === "hint");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{design.name}</h2>
            {chosen && <Badge tone="violet">chosen</Badge>}
            {design.approach && <Badge tone="blue">{design.approach}</Badge>}
            {design.status === "searching" && <Badge tone="amber">searching products…</Badge>}
            {design.status === "error" && <Badge tone="red">{design.errorMessage ?? "error"}</Badge>}
          </div>
          <p className="mt-1 text-sm text-stone-700">{design.summary}</p>
          <p className="mt-1 text-sm text-stone-500">Style: {design.style}</p>
          {design.inspirationUse && <p className="mt-1 text-sm text-violet-700">Inspiration: {design.inspirationUse}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={chosen ? "subtle" : "primary"} onClick={onChoose}>
            {chosen ? "Unmark as chosen" : "Mark as chosen"}
          </Button>
          <Button onClick={onBuildOn}>Build on this design</Button>
          <Button onClick={() => setShopping(true)}>Shopping list</Button>
        </div>
      </div>

      {outdated && (
        <Notice tone="warn">
          The room changed since this design was made.{" "}
          <button className="underline" onClick={() => recheckDesign(design.id)}>
            Re-check fit (free)
          </button>{" "}
          or create new designs.
        </Notice>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              <Button size="sm" variant={view === "3d" ? "primary" : "secondary"} onClick={() => setView("3d")}>
                3D
              </Button>
              <Button size="sm" variant={view === "2d" ? "primary" : "secondary"} onClick={() => setView("2d")}>
                2D plan
              </Button>
            </div>
            {view === "3d" && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setPreset(preset === "top" ? "perspective" : "top")}>
                  {preset === "top" ? "Perspective" : "Top view"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLabels(!labels)}>
                  {labels ? "Hide labels" : "Labels"}
                </Button>
              </>
            )}
            <div className="ml-auto flex items-center gap-1 text-sm">
              <Button size="sm" variant={tier === "budget" ? "primary" : "secondary"} onClick={() => setTier("budget")}>
                Budget €{tierTotal(design, "budget").toFixed(0)}
              </Button>
              <Button size="sm" variant={tier === "nicer" ? "primary" : "secondary"} onClick={() => setTier("nicer")}>
                A bit nicer €{tierTotal(design, "nicer").toFixed(0)}
              </Button>
            </div>
          </div>
          <div className="h-[520px] overflow-hidden rounded-lg">
            {view === "3d" ? (
              <Scene3D
                room={model}
                items={items}
                paintedWalls={paintedWalls}
                paintHex={design.colors.paint?.hex}
                floorType={model.floorType}
                selectedId={selected}
                onSelect={(id: string | null) => {
                  setSelected(id);
                  setSelectedSlot(null);
                }}
                cameraPreset={preset}
                camera={camera}
                onCameraChange={setCamera}
                captureRef={captureRef}
                showLabels={labels}
                className="h-full w-full"
              />
            ) : (
              <TopView2D
                room={model}
                items={items}
                warnings={design.warnings}
                selectedId={selected}
                onSelect={(id) => {
                  setSelected(id);
                  setSelectedSlot(null);
                }}
                movableIds={design.items.map((i) => i.id)}
                onMoveItem={async (id, x, y) => {
                  await updateDesign(design.id, (d) => ({ items: d.items.map((i) => (i.id === id ? { ...i, x, y } : i)) }));
                  await recheckDesign(design.id);
                }}
                className="h-full w-full"
              />
            )}
          </div>
          <p className="mt-2 text-xs text-stone-500">Click an item to see it and find alternatives. In the 2D plan you can drag items to move them (they are re-checked immediately).</p>
        </Card>
        <div className="space-y-4">
          {(selected || selectedSlot) && <AlternativesPanel key={(selected ?? "") + (selectedSlot ?? "")} design={design} itemId={selected} slotId={selectedSlot} tier={tier} keep={keep} onClose={() => (setSelected(null), setSelectedSlot(null))} />}
          <ImagePanel design={design} room={room} captureRef={captureRef} ensure3D={() => setView("3d")} />
          <Card title="Why this is better">
            <p className="text-sm text-stone-700">{design.whyBetter}</p>
          </Card>
          {(errorsAndWarnings.length > 0 || hints.length > 0) && (
            <Card title="Checks">
              <ul className="space-y-1 text-sm">
                {errorsAndWarnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <Badge tone={w.severity === "error" ? "red" : "amber"}>{w.severity}</Badge>
                    <span>{w.message}</span>
                  </li>
                ))}
                {hints.map((w, i) => (
                  <li key={`h${i}`} className="flex gap-2 text-stone-600">
                    <Badge>hint</Badge>
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card title={`Products — ${tier === "budget" ? "Budget" : "A bit nicer"}: €${total.toFixed(2)} (shipping not included)`}>
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {design.slots.map((s) => {
            const p = selectedProduct(design, s.id, tier);
            return (
              <div key={s.id} className="rounded-lg border border-stone-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {CATEGORY_LABEL[s.category]} · {s.label}
                    {s.quantity > 1 && ` ×${s.quantity}`}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelected(s.placedItemId);
                      setSelectedSlot(s.placedItemId ? null : s.id);
                    }}
                  >
                    Alternatives
                  </Button>
                </div>
                {p ? <ProductCard p={p} /> : <p className="text-sm text-stone-500">{design.status === "searching" ? "Searching…" : "No product found yet."}</p>}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Lighting plan">
          <ul className="space-y-1 text-sm">
            {design.lighting.zones.map((z, i) => (
              <li key={i}>
                <Badge tone={z.kind === "task" ? "blue" : z.kind === "accent" ? "violet" : "stone"}>{z.kind}</Badge> <span className="font-medium">{z.name}</span> — {z.description}
              </li>
            ))}
          </ul>
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="pr-2">Light</th>
                <th className="pr-2">lm</th>
                <th className="pr-2">K</th>
                <th className="pr-2">Dimmable</th>
                <th className="pr-2">Base</th>
                <th className="pr-2">Bulb incl.</th>
              </tr>
            </thead>
            <tbody>
              {design.lighting.lights.map((l, i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="pr-2">
                    {l.label}
                    {l.indirect && <span className="text-stone-400"> (indirect)</span>}
                  </td>
                  <td className="pr-2 tabular-nums">{l.lumens}</td>
                  <td className="pr-2 tabular-nums">{l.kelvin}</td>
                  <td className="pr-2">{l.dimmable ? "yes" : "no"}</td>
                  <td className="pr-2">{l.base}</td>
                  <td className="pr-2">{l.bulbIncluded ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-stone-700">Daylight: {design.lighting.daylight}</p>
        </Card>
        <Card title="Colours & paint">
          {design.colors.paint ? (
            <div className="text-sm">
              <div className="flex items-center gap-2">
                <Swatch hex={design.colors.paint.hex} size={28} />
                <div>
                  <div className="font-medium">
                    {design.colors.paint.brand} — {design.colors.paint.colorName}
                  </div>
                  <div className="text-xs text-stone-500">
                    code {design.colors.paint.colorCode} · {design.colors.paint.hex} · on {design.colors.paint.surfaces.join(", ")}
                  </div>
                </div>
              </div>
              {design.paintCalc && (
                <p className="mt-2 text-stone-700">
                  {design.paintCalc.areaM2.toFixed(1)} m² × {design.paintCalc.coats} coats ÷ {design.paintCalc.coverageM2PerL} m²/L = <strong>{design.paintCalc.litersNeeded} L</strong> → buckets {design.paintCalc.buckets.join(" + ")} L. Also: {design.paintCalc.extras.join(", ")}.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-500">No painting suggested.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {design.colors.accents.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs">
                <Swatch hex={a.hex} /> {a.name}
              </span>
            ))}
          </div>
        </Card>
        <Card title="Textiles">
          <ul className="space-y-1 text-sm">
            {design.textiles.map((t, i) => (
              <li key={i}>
                <span className="font-medium">{t.item}:</span> {t.detail}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Plants & decor">
          <ul className="space-y-1 text-sm">
            {design.plantsDecor.map((t, i) => (
              <li key={i}>
                <span className="font-medium">{t.item}:</span> {t.detail}
              </li>
            ))}
          </ul>
          {design.removed.length > 0 && (
            <div className="mt-3 border-t border-stone-100 pt-2 text-sm">
              <p className="font-medium">Removed from this room (becomes spare when you choose this design):</p>
              <ul className="list-disc pl-5 text-stone-700">
                {design.removed.map((r) => (
                  <li key={r.inventoryId}>
                    {invById.get(r.inventoryId)?.name ?? "item"} — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <CostPanel costs={design.costs} title={`Costs of this design (${formatUsd(design.costs.reduce((s, c) => s + c.usd, 0))})`} />
      </Card>
      <ShoppingListModal design={design} tier={tier} open={shopping} onClose={() => setShopping(false)} />
    </div>
  );
}
