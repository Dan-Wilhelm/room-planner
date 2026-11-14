"use client";

import { useRef, useState } from "react";
import TopView2D from "@/components/plan/TopView2D";
import { addMedia, deleteMedia, listMedia, updateRoom, useLive } from "@/lib/db";
import { extractVideoFrames, MAX_IMAGES_PER_REQUEST, processImageFile } from "@/lib/media";
import { runAnalysis } from "@/lib/pipeline";
import { formatUsd } from "@/lib/pricing";
import type { MediaRecord, Room, RoomModel } from "@/lib/types";
import { Button, Card, Notice, Spinner, TextArea, useObjectUrl } from "../ui";
import { emptyModel, estimatedPaths, hasRealMeasurement, RoomModelEditor } from "./RoomModelEditor";

function Frame({ m }: { m: MediaRecord }) {
  const url = useObjectUrl(m.blob);
  return (
    <div className="group relative">
      {url && <img src={url} alt="" className="h-24 w-32 rounded object-cover ring-1 ring-stone-200" />}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{m.kind === "frame" ? `${(m.timeSec ?? 0).toFixed(1)} s` : "photo"}</span>
      <button onClick={() => deleteMedia(m.id)} className="absolute right-1 top-1 hidden rounded bg-white/90 px-1 text-xs text-red-700 group-hover:block" aria-label="Remove">
        ✕
      </button>
    </div>
  );
}

export function RoomCapture({ room, onAnalysed }: { room: Room; onAnalysed: () => void }) {
  const { data: media } = useLive(() => listMedia(room.id), [room.id], []);
  const images = media.filter((m) => m.kind === "frame" || m.kind === "photo");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const model: RoomModel | null = room.model;

  async function onFiles(files: File[]) {
    setErr(null);
    try {
      for (const f of files) {
        if (f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(f.name)) {
          setVideo(f);
          setBusy("Extracting frames from the video (it stays on your computer)…");
          const frames = await extractVideoFrames(f, { count: 10, onProgress: (d, t) => setBusy(`Extracting frames ${d}/${t}…`) });
          for (const fr of frames) await addMedia({ ownerId: room.id, kind: "frame", blob: fr.blob, width: fr.width, height: fr.height, timeSec: fr.timeSec });
          const last = frames[frames.length - 1]?.timeSec ?? 0;
          setRange({ from: 0, to: Math.ceil(last + 1) });
        } else {
          setBusy(`Processing ${f.name}…`);
          const img = await processImageFile(f);
          await addMedia({ ownerId: room.id, kind: "photo", blob: img.blob, width: img.width, height: img.height, label: f.name });
        }
      }
    } catch (e) {
      setErr((e as { userMessage?: string }).userMessage ?? (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function moreFrames() {
    if (!video) return;
    setBusy("Grabbing more frames…");
    try {
      const frames = await extractVideoFrames(video, { count: 8, from: range.from, to: range.to || undefined });
      for (const fr of frames) await addMedia({ ownerId: room.id, kind: "frame", blob: fr.blob, width: fr.width, height: fr.height, timeSec: fr.timeSec });
    } catch (e) {
      setErr((e as { userMessage?: string }).userMessage ?? (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function analyse() {
    setErr(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAnalysing(true);
    setBusy("Starting analysis…");
    try {
      const out = await runAnalysis(room.id, { onProgress: (_, m) => setBusy(m), signal: ctrl.signal });
      setBusy(null);
      setErr(null);
      if (out.cost) console.info("analysis cost", formatUsd(out.cost));
      onAnalysed();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
      setAnalysing(false);
      abortRef.current = null;
    }
  }

  async function useAsIs() {
    if (!model) return;
    await updateRoom(room.id, { modelConfirmed: false });
    onAnalysed();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_480px]">
      <div className="space-y-5">
        <Card title="Describe the room">
          <TextArea
            placeholder="What is the room used for, how is the light, what bothers you? Any measurements you know can go here too (e.g. “ceiling 2.50 m, slope on the north side from a 1 m knee wall”)."
            value={room.description}
            onChange={(e) => updateRoom(room.id, { description: e.target.value })}
          />
        </Card>

        <Card title="Photos & video" actions={<span className="text-xs text-stone-500">{images.length}/{MAX_IMAGES_PER_REQUEST} images are sent to the AI</span>}>
          <p className="mb-3 text-sm text-stone-600">Upload photos and/or a walkthrough video. The video never leaves your computer — only 8–12 downscaled still frames are used.</p>
          <div className="flex flex-wrap gap-2">
            {images.map((m) => (
              <Frame key={m.id} m={m} />
            ))}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,video/*,.heic,.heif,.mov"
              className="hidden"
              onChange={(e) => {
                const f = [...(e.target.files ?? [])];
                e.target.value = "";
                void onFiles(f);
              }}
            />
            <button onClick={() => fileRef.current?.click()} className="flex h-24 w-32 items-center justify-center rounded border border-dashed border-stone-300 text-xs text-stone-500 hover:bg-stone-50">
              + photos / video
            </button>
          </div>
          {video && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-stone-600">Grab more frames from {video.name} between</span>
              <input className="w-16 rounded border border-stone-300 px-1" value={range.from} onChange={(e) => setRange({ ...range, from: Number(e.target.value) || 0 })} aria-label="from second" />
              and
              <input className="w-16 rounded border border-stone-300 px-1" value={range.to} onChange={(e) => setRange({ ...range, to: Number(e.target.value) || 0 })} aria-label="to second" />
              s
              <Button size="sm" onClick={moreFrames} disabled={!!busy}>
                Grab 8 frames
              </Button>
            </div>
          )}
          {images.length > MAX_IMAGES_PER_REQUEST && <Notice tone="warn">Only the first {MAX_IMAGES_PER_REQUEST} images are sent — remove the least useful ones.</Notice>}
        </Card>

        <Card
          title="Dimensions you know"
          actions={
            !model && (
              <Button size="sm" onClick={() => updateRoom(room.id, { model: emptyModel() })}>
                Enter dimensions
              </Button>
            )
          }
        >
          {!model ? (
            <p className="text-sm text-stone-600">No dimensions entered — the AI will estimate everything from the description and images. For better results, measure at least the door width or the ceiling height.</p>
          ) : (
            <RoomModelEditor model={model} onChange={(m) => updateRoom(room.id, { model: m, modelConfirmed: false })} />
          )}
        </Card>
      </div>

      <div className="space-y-5 xl:sticky xl:top-20 xl:self-start">
        {model && (
          <Card title="Top view">
            <TopView2D room={model} highlightPaths={estimatedPaths(model)} className="h-[360px] w-full" />
          </Card>
        )}
        <Card title="Next: build the room model">
          {!hasRealMeasurement(model) && <Notice tone="warn">No real measurement yet — the AI estimates will be rough. Please add at least one reference (door width or ceiling height).</Notice>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={analyse} disabled={!!busy || (images.length === 0 && !room.description.trim() && !model)}>
              Analyse with AI
            </Button>
            {model && (
              <Button onClick={useAsIs} disabled={!!busy}>
                Use my values only (no AI)
              </Button>
            )}
            {analysing && (
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-stone-500">Values you entered are never overwritten. Estimated values are marked and can be corrected in the next step.</p>
          {busy && (
            <p className="mt-3 flex items-center gap-2 text-sm text-stone-700">
              <Spinner /> {busy}
            </p>
          )}
          {err && (
            <div className="mt-3">
              <Notice tone="error">{err}</Notice>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
