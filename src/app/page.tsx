"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { Button, Card, downloadBlob, Empty, Notice, TextInput } from "@/components/ui";
import { createProject, deleteProject, exportProject, importProject, listProjects, storageEstimate, useLive } from "@/lib/db";

export default function ProjectsPage() {
  const { data: projects, loading } = useLive(listProjects, [], []);
  const { data: storage } = useLive(storageEstimate, [], null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function create() {
    const p = await createProject(name.trim() || "My apartment");
    setName("");
    window.location.href = `/p/${p.id}`;
  }

  async function onImport(f: File | undefined) {
    if (!f) return;
    try {
      const p = await importProject(f);
      setMsg({ tone: "ok", text: `Imported "${p.name}".` });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
  }

  return (
    <Shell>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your projects</h1>
          <p className="mt-1 text-sm text-stone-500">A project is a home — an apartment, a house or several homes — with its rooms, furniture and inspirations. Everything is stored only in this browser.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
          <Button onClick={() => fileRef.current?.click()}>Import project file</Button>
        </div>
      </div>
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>
        </div>
      )}
      <Card className="mb-6">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <TextInput placeholder="New project name, e.g. “Apartment Karlsruhe”" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" type="submit">
            Create project
          </Button>
        </form>
      </Card>
      {!loading && projects.length === 0 && <Empty title="No projects yet">Create your first project above.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <Card key={p.id}>
            <Link href={`/p/${p.id}`} className="block text-lg font-semibold text-stone-900 hover:underline">
              {p.name}
            </Link>
            <p className="mt-1 text-xs text-stone-500">Updated {new Date(p.updatedAt).toLocaleString("en-GB")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/p/${p.id}`} className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white">
                Open
              </Link>
              <Button size="sm" onClick={async () => downloadBlob(await exportProject(p.id, false), `${p.name}.room-planner.json`)}>
                Export
              </Button>
              <Button size="sm" onClick={async () => downloadBlob(await exportProject(p.id, true), `${p.name}.with-media.room-planner.json`)}>
                Export with media
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (confirm(`Delete "${p.name}" with all rooms, designs and media? This cannot be undone.`)) await deleteProject(p.id);
                }}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {storage && (
        <p className="mt-8 text-xs text-stone-500">
          Browser storage used: {(storage.usage / 1024 / 1024).toFixed(1)} MB of {(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB available ·{" "}
          {storage.persisted ? "persistent (the browser won't evict it)" : "not marked persistent — export projects regularly as a backup"}
        </p>
      )}
    </Shell>
  );
}
