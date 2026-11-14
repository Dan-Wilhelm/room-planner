"use client";

import { useState } from "react";
import TopView2D from "@/components/plan/TopView2D";
import { validatePolygon } from "@/lib/geometry";
import { updateRoom } from "@/lib/db";
import type { Room } from "@/lib/types";
import { Badge, Button, Card, Notice } from "../ui";
import { estimatedPaths, RoomModelEditor } from "./RoomModelEditor";
import { Scene3D } from "./Scene3D";

export function RoomReview({ room, onConfirmed }: { room: Room; onConfirmed: () => void }) {
  const model = room.model!;
  const [view, setView] = useState<"2d" | "3d">("2d");
  const est = Object.entries(model.estimates).filter(([, e]) => e.source === "estimated");
  const poly = validatePolygon(model.corners);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_560px]">
      <div className="space-y-5">
        {room.analysisSummary && <Notice tone="info">{room.analysisSummary}</Notice>}
        {room.analysisWarnings?.map((w, i) => (
          <Notice key={i} tone="warn">
            {w}
          </Notice>
        ))}
        {est.length > 0 && (
          <Card title={`Estimated values (${est.length}) — please check`}>
            <ul className="space-y-1 text-sm">
              {est.map(([path, e]) => (
                <li key={path} className="flex flex-wrap items-center gap-2">
                  <Badge tone="amber">{e.confidence ?? "low"}</Badge>
                  <code className="text-xs text-stone-500">{path}</code>
                  <span className="text-stone-700">{e.reason}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Room model (edit any value)">
          <RoomModelEditor model={model} onChange={(m) => updateRoom(room.id, { model: m, modelConfirmed: false })} />
        </Card>
      </div>
      <div className="space-y-5 xl:sticky xl:top-20 xl:self-start">
        <Card
          title="Preview"
          actions={
            <div className="flex gap-1">
              <Button size="sm" variant={view === "2d" ? "primary" : "secondary"} onClick={() => setView("2d")}>
                2D
              </Button>
              <Button size="sm" variant={view === "3d" ? "primary" : "secondary"} onClick={() => setView("3d")}>
                3D
              </Button>
            </div>
          }
        >
          <div className="h-[420px]">{view === "2d" ? <TopView2D room={model} highlightPaths={estimatedPaths(model)} className="h-full w-full" /> : <Scene3D room={model} items={[]} className="h-full w-full" />}</div>
        </Card>
        <Card>
          {!poly.ok && <Notice tone="error">The outline is invalid: {poly.errors.join(" ")}</Notice>}
          {room.modelConfirmed ? (
            <Notice tone="ok">Room confirmed (version {model.version}).</Notice>
          ) : (
            <Button
              variant="primary"
              disabled={!poly.ok}
              onClick={async () => {
                await updateRoom(room.id, { modelConfirmed: true });
                onConfirmed();
              }}
            >
              Confirm room model
            </Button>
          )}
          <p className="mt-2 text-xs text-stone-500">Editing the room later marks existing designs as outdated (you can re-check them for free).</p>
        </Card>
      </div>
    </div>
  );
}
