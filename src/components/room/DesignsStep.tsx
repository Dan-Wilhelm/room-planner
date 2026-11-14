"use client";

import { useMemo, useRef, useState } from "react";
import { narrowestWalkway } from "@/lib/geometry";
import { tierTotal } from "@/lib/designConvert";
import { deleteDesign, listInventory, useLive } from "@/lib/db";
import { chooseDesign, resumeRun, runDesigns } from "@/lib/pipeline";
import { formatUsd, ROOM_RUN_LIMIT_USD } from "@/lib/pricing";
import type { Design, ID, Room, Tier } from "@/lib/types";
import { BuildOnDialog } from "../design/BuildOnDialog";
import { DesignView, type CameraState } from "../design/DesignView";
import { Badge, Button, Card, Empty, Notice, Spinner, cx } from "../ui";

interface Progress {
  [scope: string]: string;
}

export function DesignsStep({ room, designs }: { room: Room; designs: Design[] }) {
  const { data: inventory } = useLive(() => listInventory(room.projectId), [room.projectId], []);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [tier, setTier] = useState<Tier>("budget");
  const [camera, setCamera] = useState<CameraState | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({});
  const [runCost, setRunCost] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [buildOn, setBuildOn] = useState<Design | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runs = useMemo(() => {
    const m = new Map<string, Design[]>();
    for (const d of designs) m.set(d.runId, [...(m.get(d.runId) ?? []), d]);
    return [...m.entries()].map(([runId, list]) => ({ runId, list, at: Math.min(...list.map((x) => x.createdAt)) })).sort((a, b) => b.at - a.at);
  }, [designs]);
  const latestRun = runs[0];
  const selected = designs.find((d) => d.id === selectedId) ?? latestRun?.list[0] ?? null;
  const cp = room.pipeline;
  const interrupted = !running && cp && cp.step !== "done" && (cp.designIds.length > 0 || !!cp.request);

  const callbacks = () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({});
    setRunCost(0);
    setErr(null);
    return {
      signal: ctrl.signal,
      onProgress: (scope: string, message: string) => setProgress((p) => ({ ...p, [scope]: message })),
      onCost: (e: { usd: number }) => setRunCost((c) => c + e.usd),
    };
  };

  async function start(opts: Parameters<typeof runDesigns>[1]) {
    setRunning(true);
    try {
      const ids = await runDesigns(room.id, opts, callbacks());
      if (ids[0]) setSelectedId(ids[0]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function resume() {
    setRunning(true);
    try {
      await resumeRun(room.id, callbacks());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const designName = (id: string) =>
    designs.find((d) => d.id === id)?.name ?? (id === "concepts" ? "Designs" : id === "done" ? "Status" : id.startsWith("concept-") ? `Design ${Number(id.slice(8)) + 1}` : id);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={running || !room.modelConfirmed} onClick={() => start({ kind: "new" })}>
            {designs.length ? "Start over: 3 new designs" : "Create 3 designs"}
          </Button>
          {interrupted && (
            <Button onClick={resume} disabled={running}>
              Resume last run ({cp!.step})
            </Button>
          )}
          {running && (
            <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          )}
          <span className="text-sm text-stone-600">
            Each run: designs + real products for all 3 · limit {formatUsd(ROOM_RUN_LIMIT_USD)} · {room.idea ? `idea: “${room.idea}”` : "no idea given"} · {room.budget != null ? `budget €${room.budget}` : "no budget"}
          </span>
        </div>
        {!room.modelConfirmed && (
          <div className="mt-3">
            <Notice tone="warn">Please confirm the room model first (step 2).</Notice>
          </div>
        )}
        {(running || Object.keys(progress).length > 0) && (
          <div className="mt-4 space-y-1 rounded-lg bg-stone-50 p-3 text-sm">
            {Object.entries(progress).map(([scope, msg]) => (
              <div key={scope} className="flex items-center gap-2">
                {running && scope !== "done" && <Spinner className="h-3 w-3" />}
                <span className="font-medium">{designName(scope)}:</span> <span className="text-stone-700">{msg}</span>
              </div>
            ))}
            <div className="pt-1 text-xs text-stone-500">
              Cost of this run so far: {formatUsd(runCost)} of {formatUsd(ROOM_RUN_LIMIT_USD)}
              {cp?.stoppedForBudget && " — product search stopped early to stay within the limit"}
            </div>
          </div>
        )}
        {err && (
          <div className="mt-3">
            <Notice tone="error">
              {err}
              {interrupted && " — use “Resume last run” to continue where it stopped."}
            </Notice>
          </div>
        )}
      </Card>

      {designs.length === 0 && !running && <Empty title="No designs yet">Click “Create 3 designs”. It takes a few minutes: concepts first, then real products are searched for each design.</Empty>}

      {latestRun && (
        <Card title="Compare">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-1 pr-3">Design</th>
                  <th className="pr-3">Style</th>
                  <th className="pr-3">Budget</th>
                  <th className="pr-3">A bit nicer</th>
                  <th className="pr-3">Warnings</th>
                  <th className="pr-3">Narrowest walkway</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {latestRun.list.map((d) => {
                  let walk: number | null = null;
                  try {
                    walk = room.model ? narrowestWalkway(room.model, d.items) : null;
                  } catch {
                    walk = null;
                  }
                  const warn = d.warnings.filter((w) => w.severity !== "hint").length;
                  return (
                    <tr key={d.id} className={cx("border-t border-stone-100", selected?.id === d.id && "bg-stone-50")}>
                      <td className="py-2 pr-3">
                        <button className="font-medium hover:underline" onClick={() => setSelectedId(d.id)}>
                          {d.name}
                        </button>
                        {room.chosenDesignId === d.id && (
                          <span className="ml-1">
                            <Badge tone="violet">chosen</Badge>
                          </span>
                        )}
                        {d.status !== "ready" && (
                          <span className="ml-1">
                            <Badge tone={d.status === "error" ? "red" : "amber"}>{d.status}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="pr-3 text-stone-600">{d.style}</td>
                      <td className="pr-3 tabular-nums">€{tierTotal(d, "budget").toFixed(0)}</td>
                      <td className="pr-3 tabular-nums">€{tierTotal(d, "nicer").toFixed(0)}</td>
                      <td className="pr-3">{warn ? <Badge tone="amber">{warn}</Badge> : <Badge tone="green">0</Badge>}</td>
                      <td className="pr-3 tabular-nums">{walk != null ? `${Math.round(walk)} cm` : "—"}</td>
                      <td>
                        <Button size="sm" variant={selected?.id === d.id ? "primary" : "secondary"} onClick={() => setSelectedId(d.id)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {runs.length > 1 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-stone-600">History ({runs.length - 1} earlier run(s))</summary>
              <div className="mt-2 space-y-2">
                {runs.slice(1).map((r) => (
                  <div key={r.runId} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-stone-500">{new Date(r.at).toLocaleString("en-GB")}</span>
                    {r.list.map((d) => (
                      <span key={d.id} className="inline-flex items-center gap-1">
                        <Button size="sm" variant={selected?.id === d.id ? "primary" : "secondary"} onClick={() => setSelectedId(d.id)}>
                          {d.name}
                          {d.parentDesignId ? " (variation)" : ""}
                        </Button>
                        <button className="text-xs text-stone-400 hover:text-red-600" onClick={() => confirm(`Delete “${d.name}”?`) && deleteDesign(d.id)} aria-label={`Delete ${d.name}`}>
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
        </Card>
      )}

      {selected && room.model && (
        <DesignView
          key={selected.id}
          design={selected}
          room={room}
          inventory={inventory}
          tier={tier}
          setTier={setTier}
          camera={camera}
          setCamera={setCamera}
          onBuildOn={() => setBuildOn(selected)}
          onChoose={() => chooseDesign(room.id, room.chosenDesignId === selected.id ? null : selected.id)}
        />
      )}
      {buildOn && (
        <BuildOnDialog
          design={buildOn}
          open={!!buildOn}
          onClose={() => setBuildOn(null)}
          onStart={(feedback, count, locked) => start({ kind: "buildOn", parentId: buildOn.id, feedback, count, lockedIds: locked })}
        />
      )}
    </div>
  );
}
