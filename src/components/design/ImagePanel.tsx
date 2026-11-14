"use client";

import { useState, type RefObject } from "react";
import { CATEGORY_LABEL } from "@/lib/categories";
import { itemsForTier } from "@/lib/designConvert";
import { addMedia, getMedia, listInspirations, listMedia, updateDesign, useLive } from "@/lib/db";
import { blobToBase64, processImageFile } from "@/lib/media";
import { formatUsd } from "@/lib/pricing";
import { postStream } from "@/lib/stream";
import type { CostEntry, Design, Room } from "@/lib/types";
import { Button, Card, downloadBlob, Notice, Spinner, useObjectUrl } from "../ui";

type Capture = { capture: (opts?: { width?: number }) => Promise<Blob> };

function buildPrompt(design: Design, room: Room): string {
  const items = itemsForTier(design, "budget");
  const lines = [
    "Create ONE photorealistic interior photograph of this room, furnished exactly as in reference 1 (same camera angle, same furniture positions and sizes, same room shape, sloped ceilings and windows).",
    `Style: ${design.style}.`,
    design.colors.paint ? `Wall paint: ${design.colors.paint.colorName} (${design.colors.paint.hex}) on ${design.colors.paint.surfaces.join(", ")}; other walls ${room.model?.wallColor ?? "white"}.` : `Walls: ${room.model?.wallColor ?? "white"}.`,
    `Floor: ${room.model?.floorType ?? "light wooden floor"}.`,
    `Lighting mood: ${design.lighting.zones.map((z) => z.description).join(" ")} Light colour around ${design.lighting.lights[0]?.kelvin ?? 2700} K.`,
    `Furniture and objects: ${items.map((i) => `${CATEGORY_LABEL[i.category]} "${i.label}"${i.colorHex ? ` in ${i.colorHex}` : ""}${i.material ? ` (${i.material})` : ""}`).join("; ")}.`,
    `Textiles: ${design.textiles.map((t) => t.item + " — " + t.detail).join("; ")}.`,
    `Plants & decor: ${design.plantsDecor.map((t) => t.item).join(", ")}.`,
    "Natural, realistic, eye-level, no people, no text or watermarks.",
  ];
  return lines.join("\n");
}

export function ImagePanel({ design, room, captureRef, ensure3D }: { design: Design; room: Room; captureRef: RefObject<Capture | null>; ensure3D: () => void }) {
  const { data: rec } = useLive(async () => (design.imageMediaId ? ((await getMedia(design.imageMediaId)) ?? null) : null), [design.imageMediaId], null);
  const url = useObjectUrl(rec?.blob);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setErr(null);
    if (!captureRef.current) {
      ensure3D();
      setErr("Switch to the 3D view and choose the camera angle you want, then click again.");
      return;
    }
    setBusy("Capturing the 3D view…");
    try {
      const layout = await blobToBase64(await captureRef.current.capture({ width: 1024 }));
      const photos = (await listMedia(room.id)).filter((m) => m.kind === "photo" || m.kind === "frame");
      const roomPhoto = photos[0] ? await blobToBase64(photos[0].blob) : undefined;
      let inspiration: string | undefined;
      if (room.styleSource.mode === "inspiration") {
        const insp = (await listInspirations(room.projectId)).find((i) => room.styleSource.mode === "inspiration" && room.styleSource.inspirationIds.includes(i.id));
        const m = insp ? (await listMedia(insp.id))[0] : undefined;
        if (m) inspiration = await blobToBase64(m.blob);
      }
      const costs: CostEntry[] = [];
      const res = await postStream<{ base64: string; mediaType: string; model: string }>(
        "/api/image",
        { prompt: buildPrompt(design, room), layout, roomPhoto, inspiration },
        { onProgress: setBusy, onCost: (e) => costs.push(e) },
      );
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const raw = new Blob([bytes], { type: res.mediaType });
      const img = await processImageFile(raw, { maxEdge: 1600, quality: 0.9 });
      const m = await addMedia({ ownerId: design.id, kind: "render", blob: img.blob, width: img.width, height: img.height, label: res.model });
      await updateDesign(design.id, (d) => ({ imageMediaId: m.id, costs: [...d.costs, ...costs] }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Photorealistic image" actions={<span className="text-xs text-stone-500">≈ {formatUsd(0.0336)} per image</span>}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Photorealistic render of ${design.name}`} className="w-full rounded-lg ring-1 ring-stone-200" />
      ) : (
        <p className="text-sm text-stone-600">Generated on demand from the current 3D view (camera angle you set){room.styleSource.mode === "inspiration" ? " and your inspiration" : ""}, plus a real room photo if available.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant={url ? "secondary" : "primary"} onClick={generate} disabled={!!busy}>
          {url ? "Generate again" : "Generate image"}
        </Button>
        {url && rec && (
          <Button size="sm" variant="ghost" onClick={() => downloadBlob(rec.blob, `${design.name}.jpg`)}>
            Download
          </Button>
        )}
        {busy && (
          <span className="flex items-center gap-2 text-sm text-stone-600">
            <Spinner /> {busy}
          </span>
        )}
      </div>
      {err && (
        <div className="mt-2">
          <Notice tone="error">{err}</Notice>
        </div>
      )}
    </Card>
  );
}
