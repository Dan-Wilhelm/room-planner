"use client";

import { useRef, useState } from "react";
import { addMedia, deleteInspiration, deleteMedia, listInspirations, listMedia, newId, saveInspiration, useLive } from "@/lib/db";
import { extractVideoFrames, processImageFile } from "@/lib/media";
import { runInspiration } from "@/lib/pipeline";
import { formatUsd } from "@/lib/pricing";
import type { DesignDNA, ID, Inspiration, MediaRecord } from "@/lib/types";
import { Badge, Button, Card, Empty, ExternalLink, Field, Notice, Spinner, Swatch, TextArea, TextInput, useObjectUrl } from "../ui";

interface PreviewResponse {
  platform: Inspiration["platform"];
  status: Inspiration["previewStatus"];
  title?: string;
  caption?: string;
  author?: string;
  notes: string[];
  images: string[];
  video?: string;
  booster?: { oembed: boolean; businessDiscovery: boolean; expiresAt?: string; expiresSoon: boolean };
}

async function addFiles(ownerId: ID, files: File[], onProgress: (m: string) => void) {
  for (const f of files) {
    if (f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(f.name)) {
      onProgress(`Extracting frames from ${f.name}…`);
      const frames = await extractVideoFrames(f, { count: 10, onProgress: (d, t) => onProgress(`Extracting frames ${d}/${t}…`) });
      for (const fr of frames) await addMedia({ ownerId, kind: "inspiration", blob: fr.blob, width: fr.width, height: fr.height, timeSec: fr.timeSec });
    } else {
      onProgress(`Processing ${f.name}…`);
      const img = await processImageFile(f);
      await addMedia({ ownerId, kind: "inspiration", blob: img.blob, width: img.width, height: img.height, label: "screenshot" });
    }
  }
}

function Thumb({ m, onRemove }: { m: MediaRecord; onRemove: () => void }) {
  const url = useObjectUrl(m.blob);
  return (
    <div className="group relative">
      {url && <img src={url} alt="" className="h-20 w-28 rounded object-cover ring-1 ring-stone-200" />}
      {m.timeSec != null && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{m.timeSec.toFixed(1)} s</span>}
      <button onClick={onRemove} className="absolute right-1 top-1 hidden rounded bg-white/90 px-1 text-xs text-red-700 group-hover:block" aria-label="Remove image">
        ✕
      </button>
    </div>
  );
}

function ListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label} hint="one per line">
      <TextArea className="min-h-[70px]" value={values.join("\n")} onChange={(e) => onChange(e.target.value.split("\n").filter((x) => x.trim() !== ""))} />
    </Field>
  );
}

function DnaCard({ insp }: { insp: Inspiration }) {
  const dna = insp.dna!;
  const set = (patch: Partial<DesignDNA>) => saveInspiration({ ...insp, dna: { ...dna, ...patch } });
  return (
    <div className="mt-4 rounded-lg bg-stone-50 p-4 ring-1 ring-stone-200">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Design DNA</span>
        {dna.palette.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs ring-1 ring-stone-200">
            <Swatch hex={c.hex} size={12} /> {c.name}
            <button className="text-stone-400 hover:text-red-600" onClick={() => set({ palette: dna.palette.filter((_, j) => j !== i) })} aria-label={`Remove ${c.name}`}>
              ×
            </button>
          </span>
        ))}
        <Button size="sm" variant="ghost" onClick={() => set({ palette: [...dna.palette, { name: "new colour", hex: "#cccccc" }] })}>
          + colour
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Feel">
          <TextInput value={dna.feel} onChange={(e) => set({ feel: e.target.value })} />
        </Field>
        <Field label="Lighting mood">
          <TextInput value={dna.lightingMood + (dna.kelvin ? ` (${dna.kelvin} K)` : "")} onChange={(e) => set({ lightingMood: e.target.value.replace(/\s*\(\d+ K\)$/, "") })} />
        </Field>
        <ListEditor label="Materials" values={dna.materials} onChange={(v) => set({ materials: v })} />
        <ListEditor label="Shapes" values={dna.shapes} onChange={(v) => set({ shapes: v })} />
        <ListEditor
          label="Signature pieces (name: description)"
          values={dna.signaturePieces.map((p) => `${p.name}: ${p.description}`)}
          onChange={(v) => set({ signaturePieces: v.map((l) => ({ name: l.split(":")[0].trim(), description: l.split(":").slice(1).join(":").trim() })) })}
        />
        <ListEditor label="Textiles & patterns" values={dna.textiles} onChange={(v) => set({ textiles: v })} />
        <ListEditor label="Plants & decor" values={dna.plantsDecor} onChange={(v) => set({ plantsDecor: v })} />
        <ListEditor label="Layout ideas" values={dna.layoutIdeas} onChange={(v) => set({ layoutIdeas: v })} />
        <ListEditor label="What doesn't transfer" values={dna.doesNotTransfer} onChange={(v) => set({ doesNotTransfer: v })} />
      </div>
    </div>
  );
}

function InspirationCard({ insp, projectId }: { insp: Inspiration; projectId: ID }) {
  const { data: media } = useLive(() => listMedia(insp.id), [insp.id], []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const times = media.filter((m) => m.timeSec != null).map((m) => m.timeSec!);
  const maxT = times.length ? Math.ceil(Math.max(...times)) : 0;

  async function analyse() {
    setErr(null);
    setBusy("Starting…");
    try {
      const c = await runInspiration(insp.id, projectId, { onProgress: (_, m) => setBusy(m) });
      setLastCost(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{insp.platform}</Badge>
            <Badge tone={insp.previewStatus === "link preview ok" ? "green" : insp.previewStatus === "upload only" ? "stone" : "amber"}>{insp.previewStatus}</Badge>
            {insp.title && <span className="text-sm font-medium">{insp.title}</span>}
          </div>
          {insp.url && (
            <div className="mt-1 text-sm">
              <ExternalLink href={insp.url} />
            </div>
          )}
          {insp.author && <p className="text-xs text-stone-500">by {insp.author}</p>}
          {insp.caption && <p className="mt-1 line-clamp-3 max-w-2xl text-xs text-stone-600">{insp.caption}</p>}
        </div>
        <Button size="sm" variant="danger" onClick={() => confirm("Delete this inspiration?") && deleteInspiration(insp.id)}>
          Delete
        </Button>
      </div>
      {insp.previewStatus !== "link preview ok" && insp.previewStatus !== "upload only" && media.length === 0 && (
        <div className="mt-3">
          <Notice tone="warn">
            The link couldn&apos;t be read automatically{insp.previewStatus === "cover image only" ? " (only a cover image)" : ""}. On your phone: take 2–4 screenshots or a screen recording of the post and drop them here.
          </Notice>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {media.map((m) => (
          <Thumb key={m.id} m={m} onRemove={() => deleteMedia(m.id)} />
        ))}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*,.heic,.heif,.mov"
          className="hidden"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            setErr(null);
            try {
              await addFiles(insp.id, files, setBusy);
              if (insp.previewStatus === "failed → upload needed" || insp.previewStatus === "cover image only") await saveInspiration({ ...insp });
            } catch (er) {
              setErr((er as { userMessage?: string }).userMessage ?? (er as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        />
        <button onClick={() => fileRef.current?.click()} className="flex h-20 w-28 items-center justify-center rounded border border-dashed border-stone-300 text-xs text-stone-500 hover:bg-stone-50">
          + screenshots / recording
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <Field label="Which scene or element is meant?">
          <TextInput placeholder='e.g. "the reading corner at 0:12" or "only the colours and the lighting"' value={insp.note} onChange={(e) => saveInspiration({ ...insp, note: e.target.value })} />
        </Field>
        {maxT > 0 && (
          <Field label="Time range (s)">
            <div className="flex items-center gap-1">
              <TextInput
                className="w-16"
                aria-label="from"
                value={insp.timeRange?.from ?? 0}
                onChange={(e) => saveInspiration({ ...insp, timeRange: { from: Number(e.target.value) || 0, to: insp.timeRange?.to ?? maxT } })}
              />
              –
              <TextInput
                className="w-16"
                aria-label="to"
                value={insp.timeRange?.to ?? maxT}
                onChange={(e) => saveInspiration({ ...insp, timeRange: { from: insp.timeRange?.from ?? 0, to: Number(e.target.value) || maxT } })}
              />
            </div>
          </Field>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" disabled={!!busy || media.length === 0} onClick={analyse}>
          {insp.dna ? "Analyse again" : "Analyse design idea"}
        </Button>
        {busy && (
          <span className="flex items-center gap-2 text-sm text-stone-600">
            <Spinner /> {busy}
          </span>
        )}
        {lastCost != null && <span className="text-xs text-stone-500">cost {formatUsd(lastCost)}</span>}
      </div>
      {err && (
        <div className="mt-2">
          <Notice tone="error">{err}</Notice>
        </div>
      )}
      {insp.dna && <DnaCard insp={insp} />}
    </Card>
  );
}

export function InspirationsTab({ projectId }: { projectId: ID }) {
  const { data: list } = useLive(() => listInspirations(projectId), [projectId], []);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [booster, setBooster] = useState<PreviewResponse["booster"] | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  async function addLink() {
    if (!url.trim()) return;
    setBusy("Reading the link…");
    setInfo(null);
    const id = newId();
    try {
      const res = await fetch("/api/inspiration/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
      const data = (await res.json()) as PreviewResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not read the link.");
      setBooster(data.booster ?? null);
      const insp: Inspiration = {
        id,
        projectId,
        url: url.trim(),
        platform: data.platform,
        title: data.title,
        caption: data.caption,
        author: data.author,
        note,
        previewStatus: data.status,
        dna: null,
        createdAt: Date.now(),
      };
      await saveInspiration(insp);
      let added = 0;
      for (const src of data.images.slice(0, 8)) {
        try {
          const blob = await (await fetch(src)).blob();
          const img = await processImageFile(blob);
          await addMedia({ ownerId: id, kind: "inspiration", blob: img.blob, width: img.width, height: img.height, label: "link preview" });
          added++;
        } catch {
          /* skip broken image */
        }
      }
      if (data.video) {
        try {
          setBusy("Extracting frames from the video…");
          const vb = await (await fetch(data.video)).blob();
          const frames = await extractVideoFrames(new File([vb], "video.mp4", { type: vb.type || "video/mp4" }), { count: 10 });
          for (const fr of frames) await addMedia({ ownerId: id, kind: "inspiration", blob: fr.blob, width: fr.width, height: fr.height, timeSec: fr.timeSec });
          added += frames.length;
        } catch {
          /* fall back to screenshots */
        }
      }
      if (added === 0 && data.status !== "failed → upload needed") await saveInspiration({ ...insp, previewStatus: "failed → upload needed" });
      setInfo(
        added > 0
          ? { tone: "ok", text: `Added ${added} image(s) from the link.${data.notes.length ? " " + data.notes.join(" ") : ""}` }
          : { tone: "warn", text: `The link couldn't be read automatically. Please add 2–4 screenshots or a screen recording of the post.${data.notes.length ? " " + data.notes.join(" ") : ""}` },
      );
      setUrl("");
      setNote("");
    } catch (e) {
      setInfo({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function addUpload(files: File[]) {
    if (!files.length) return;
    const id = newId();
    await saveInspiration({ id, projectId, platform: "upload", note, previewStatus: "upload only", dna: null, createdAt: Date.now() });
    try {
      await addFiles(id, files, setBusy);
      setNote("");
    } catch (e) {
      setInfo({ tone: "error", text: (e as { userMessage?: string }).userMessage ?? (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card title="Add an inspiration">
        <p className="mb-3 text-sm text-stone-600">
          Paste an Instagram, Pinterest, TikTok or any web link — or upload screenshots / a screen recording of the post. Claude extracts the design idea behind it, and any room of this project can be designed after it.
        </p>
        <div className="grid gap-3 md:grid-cols-[2fr_2fr_auto]">
          <TextInput placeholder="https://www.pinterest.com/pin/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <TextInput placeholder="What is meant? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" disabled={!!busy || !url.trim()} onClick={addLink}>
            Add link
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input ref={uploadRef} type="file" multiple accept="image/*,video/*,.heic,.heif,.mov" className="hidden" onChange={(e) => addUpload([...(e.target.files ?? [])])} />
          <Button disabled={!!busy} onClick={() => uploadRef.current?.click()}>
            Upload screenshots / screen recording
          </Button>
          {busy && (
            <span className="flex items-center gap-2 text-sm text-stone-600">
              <Spinner /> {busy}
            </span>
          )}
        </div>
        {info && (
          <div className="mt-3">
            <Notice tone={info.tone === "ok" ? "ok" : info.tone === "warn" ? "warn" : "error"}>{info.text}</Notice>
          </div>
        )}
        {booster && (
          <p className="mt-2 text-xs text-stone-500">
            Instagram booster: oEmbed {booster.oembed ? "on" : "off"}, Business Discovery {booster.businessDiscovery ? "on" : "off"}
            {booster.expiresAt ? ` · token expires ${booster.expiresAt}` : ""}
            {booster.expiresSoon ? " — renew soon!" : ""}
          </p>
        )}
      </Card>
      {list.length === 0 && <Empty title="No inspirations yet" />}
      {list.map((i) => (
        <InspirationCard key={i.id} insp={i} projectId={projectId} />
      ))}
    </div>
  );
}
