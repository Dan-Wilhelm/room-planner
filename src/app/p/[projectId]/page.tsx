"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { InspirationsTab } from "@/components/project/InspirationsTab";
import { InventoryEditor } from "@/components/project/InventoryEditor";
import { OverviewTab } from "@/components/project/OverviewTab";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, Empty, Tabs, TextInput } from "@/components/ui";
import { createRoom, deleteRoom, duplicateRoom, getProject, listInventory, listProjectDesigns, listRooms, renameProject, updateRoom, useLive } from "@/lib/db";

type Tab = "rooms" | "inventory" | "inspirations" | "overview";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useLive(() => getProject(projectId), [projectId], undefined);
  const { data: rooms } = useLive(() => listRooms(projectId), [projectId], []);
  const { data: inventory } = useLive(() => listInventory(projectId), [projectId], []);
  const { data: designs } = useLive(() => listProjectDesigns(projectId), [projectId], []);
  const [tab, setTab] = useState<Tab>("rooms");
  const [newRoom, setNewRoom] = useState("");

  if (!project) return <Shell>Loading…</Shell>;

  return (
    <Shell crumbs={[{ label: project.name }]}>
      <div className="mb-4 flex items-center gap-3">
        <input
          aria-label="Project name"
          defaultValue={project.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== project.name && renameProject(project.id, e.target.value.trim())}
          className="rounded-md bg-transparent px-1 text-2xl font-semibold outline-none hover:bg-white focus:bg-white focus:ring-1 focus:ring-stone-300"
        />
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "rooms", label: `Rooms (${rooms.length})` },
          { value: "inventory", label: `Furniture inventory (${inventory.length})` },
          { value: "inspirations", label: "Inspiration board" },
          { value: "overview", label: "Overview & shopping list" },
        ]}
      />
      <div className="mt-5">
        {tab === "rooms" && (
          <div>
            <Card className="mb-5">
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await createRoom(project.id, newRoom.trim() || `Room ${rooms.length + 1}`);
                  setNewRoom("");
                  window.location.href = `/p/${project.id}/r/${r.id}`;
                }}
              >
                <TextInput placeholder="New room, e.g. “Attic bedroom”" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} />
                <Button variant="primary" type="submit">
                  Add room
                </Button>
              </form>
            </Card>
            {rooms.length === 0 && <Empty title="No rooms yet">Add a room, then capture it with a description, photos/video and the dimensions you know.</Empty>}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map((r) => {
                const count = designs.filter((d) => d.roomId === r.id).length;
                const chosen = designs.find((d) => d.id === r.chosenDesignId);
                return (
                  <Card key={r.id}>
                    <div className="flex items-start justify-between gap-2">
                      <input
                        aria-label="Room name"
                        defaultValue={r.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && updateRoom(r.id, { name: e.target.value.trim() })}
                        className="w-full rounded bg-transparent text-lg font-semibold outline-none hover:bg-stone-50 focus:bg-stone-50"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.model ? <Badge tone={r.modelConfirmed ? "green" : "amber"}>{r.modelConfirmed ? "room confirmed" : "room not confirmed"}</Badge> : <Badge>not captured</Badge>}
                      <Badge>{count} design(s)</Badge>
                      {chosen && <Badge tone="violet">chosen: {chosen.name}</Badge>}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href={`/p/${project.id}/r/${r.id}`} className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white">
                        Open
                      </Link>
                      <Button size="sm" onClick={() => duplicateRoom(r.id)}>
                        Duplicate
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => confirm(`Delete room "${r.name}" with its designs? Its furniture becomes spare.`) && deleteRoom(r.id)}>
                        Delete
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
        {tab === "inventory" && (
          <Card title="Furniture you already own" actions={<span className="text-xs text-stone-500">Assign each item to a room or keep it as spare. Designs for any room may use spare items.</span>}>
            <InventoryEditor projectId={project.id} items={inventory} rooms={rooms} />
          </Card>
        )}
        {tab === "inspirations" && <InspirationsTab projectId={project.id} />}
        {tab === "overview" && <OverviewTab projectId={project.id} rooms={rooms} designs={designs} inventory={inventory} />}
      </div>
    </Shell>
  );
}
