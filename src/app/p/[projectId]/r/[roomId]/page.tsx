"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { DesignsStep } from "@/components/room/DesignsStep";
import { FurnitureStep } from "@/components/room/FurnitureStep";
import { RoomCapture } from "@/components/room/RoomCapture";
import { RoomReview } from "@/components/room/RoomReview";
import { TasteStep } from "@/components/room/TasteStep";
import { Shell } from "@/components/Shell";
import { Badge, Tabs } from "@/components/ui";
import { getProject, getRoom, listDesigns, useLive } from "@/lib/db";

type Step = "capture" | "review" | "furniture" | "taste" | "designs";

export default function RoomPage() {
  const { projectId, roomId } = useParams<{ projectId: string; roomId: string }>();
  const { data: project } = useLive(() => getProject(projectId), [projectId], undefined);
  const { data: room, loading } = useLive(() => getRoom(roomId), [roomId], undefined);
  const { data: designs } = useLive(() => listDesigns(roomId), [roomId], []);
  const [step, setStep] = useState<Step | null>(null);

  if (loading && !room) return <Shell>Loading…</Shell>;
  if (!room || !project) return <Shell>Room not found.</Shell>;

  const current: Step = step ?? (designs.length ? "designs" : room.modelConfirmed ? "furniture" : room.model ? "review" : "capture");

  return (
    <Shell crumbs={[{ label: project.name, href: `/p/${project.id}` }, { label: room.name }]}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{room.name}</h1>
        {room.model && <Badge tone={room.modelConfirmed ? "green" : "amber"}>{room.modelConfirmed ? "room confirmed" : "please review the room"}</Badge>}
      </div>
      <Tabs<Step>
        value={current}
        onChange={setStep}
        tabs={[
          { value: "capture", label: "1 · Capture" },
          { value: "review", label: "2 · Review", disabled: !room.model },
          { value: "furniture", label: "3 · Furniture" },
          { value: "taste", label: "4 · Taste & idea" },
          { value: "designs", label: `5 · Designs${designs.length ? ` (${designs.length})` : ""}`, disabled: !room.modelConfirmed && designs.length === 0 },
        ]}
      />
      <div className="mt-5">
        {current === "capture" && <RoomCapture room={room} onAnalysed={() => setStep("review")} />}
        {current === "review" && room.model && <RoomReview room={room} onConfirmed={() => setStep("furniture")} />}
        {current === "furniture" && <FurnitureStep room={room} onNext={() => setStep("taste")} />}
        {current === "taste" && <TasteStep room={room} onNext={() => setStep("designs")} />}
        {current === "designs" && <DesignsStep room={room} designs={designs} />}
      </div>
    </Shell>
  );
}
