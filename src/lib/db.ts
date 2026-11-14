"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { useEffect, useState } from "react";
import type { Design, ID, Inspiration, InventoryItem, MediaRecord, Project, Room, Taste } from "./types";

interface RPDB extends DBSchema {
  projects: { key: string; value: Project };
  rooms: { key: string; value: Room; indexes: { byProject: string } };
  inventory: { key: string; value: InventoryItem; indexes: { byProject: string } };
  inspirations: { key: string; value: Inspiration; indexes: { byProject: string } };
  designs: { key: string; value: Design; indexes: { byRoom: string; byProject: string } };
  media: { key: string; value: MediaRecord; indexes: { byOwner: string } };
}

let dbPromise: Promise<IDBPDatabase<RPDB>> | null = null;

export function db(): Promise<IDBPDatabase<RPDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RPDB>("room-planner", 1, {
      upgrade(d) {
        d.createObjectStore("projects", { keyPath: "id" });
        d.createObjectStore("rooms", { keyPath: "id" }).createIndex("byProject", "projectId");
        d.createObjectStore("inventory", { keyPath: "id" }).createIndex("byProject", "projectId");
        d.createObjectStore("inspirations", { keyPath: "id" }).createIndex("byProject", "projectId");
        const ds = d.createObjectStore("designs", { keyPath: "id" });
        ds.createIndex("byRoom", "roomId");
        ds.createIndex("byProject", "projectId");
        d.createObjectStore("media", { keyPath: "id" }).createIndex("byOwner", "ownerId");
      },
    });
    // Ask the browser not to evict our data under storage pressure.
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => undefined);
    }
  }
  return dbPromise;
}

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---------------------------------------------------------------------------
// Change notification → live queries
// ---------------------------------------------------------------------------
type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
export function notify() {
  version++;
  listeners.forEach((l) => l());
}

/** Re-runs `query` whenever the database changes (or deps change). */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): { data: T; loading: boolean } {
  const [state, setState] = useState<{ data: T; loading: boolean }>({ data: initial, loading: true });
  const [tick, setTick] = useState(version);
  useEffect(() => {
    const l = () => setTick(version);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    query()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => {
        console.error(e);
        if (alive) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return state;
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------
export const DEFAULT_TASTE: Taste = { colorsLike: "", colorsDislike: "", wood: null, light: null, feel: null, plants: null, dontKnow: false };

export async function listProjects(): Promise<Project[]> {
  return (await (await db()).getAll("projects")).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function getProject(id: ID) {
  return (await db()).get("projects", id);
}
export async function createProject(name: string): Promise<Project> {
  const p: Project = { id: newId(), name, createdAt: Date.now(), updatedAt: Date.now() };
  await (await db()).put("projects", p);
  notify();
  return p;
}
export async function touchProject(id: ID) {
  const d = await db();
  const p = await d.get("projects", id);
  if (p) await d.put("projects", { ...p, updatedAt: Date.now() });
}
export async function renameProject(id: ID, name: string) {
  const d = await db();
  const p = await d.get("projects", id);
  if (p) await d.put("projects", { ...p, name, updatedAt: Date.now() });
  notify();
}

export async function deleteProject(id: ID) {
  const d = await db();
  const rooms = await d.getAllFromIndex("rooms", "byProject", id);
  for (const r of rooms) await deleteRoom(r.id, false);
  for (const i of await d.getAllFromIndex("inventory", "byProject", id)) {
    await deleteMediaFor(i.id);
    await d.delete("inventory", i.id);
  }
  for (const i of await d.getAllFromIndex("inspirations", "byProject", id)) {
    await deleteMediaFor(i.id);
    await d.delete("inspirations", i.id);
  }
  await d.delete("projects", id);
  notify();
}

export async function listRooms(projectId: ID): Promise<Room[]> {
  return (await (await db()).getAllFromIndex("rooms", "byProject", projectId)).sort((a, b) => a.createdAt - b.createdAt);
}
export async function getRoom(id: ID) {
  return (await db()).get("rooms", id);
}
export async function createRoom(projectId: ID, name: string): Promise<Room> {
  const r: Room = {
    id: newId(),
    projectId,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    description: "",
    model: null,
    modelConfirmed: false,
    taste: { ...DEFAULT_TASTE },
    styleSource: { mode: "independent" },
    idea: "",
    budget: null,
    chosenDesignId: null,
  };
  await (await db()).put("rooms", r);
  await touchProject(projectId);
  notify();
  return r;
}
export async function saveRoom(room: Room) {
  await (await db()).put("rooms", { ...room, updatedAt: Date.now() });
  notify();
}
export async function updateRoom(id: ID, patch: Partial<Room> | ((r: Room) => Partial<Room>)) {
  const d = await db();
  const r = await d.get("rooms", id);
  if (!r) return;
  const p = typeof patch === "function" ? patch(r) : patch;
  await d.put("rooms", { ...r, ...p, updatedAt: Date.now() });
  notify();
}
export async function duplicateRoom(id: ID): Promise<Room | null> {
  const d = await db();
  const r = await d.get("rooms", id);
  if (!r) return null;
  const copy: Room = { ...structuredClone(r), id: newId(), name: `${r.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now(), chosenDesignId: null, pipeline: undefined };
  await d.put("rooms", copy);
  for (const m of await d.getAllFromIndex("media", "byOwner", id)) await d.put("media", { ...m, id: newId(), ownerId: copy.id });
  notify();
  return copy;
}
export async function deleteRoom(id: ID, doNotify = true) {
  const d = await db();
  for (const des of await d.getAllFromIndex("designs", "byRoom", id)) {
    await deleteMediaFor(des.id);
    await d.delete("designs", des.id);
  }
  for (const inv of await d.getAllFromIndex("inventory", "byProject", (await d.get("rooms", id))?.projectId ?? "")) {
    if (inv.roomId === id) await d.put("inventory", { ...inv, roomId: null });
  }
  await deleteMediaFor(id);
  await d.delete("rooms", id);
  if (doNotify) notify();
}

export async function listInventory(projectId: ID): Promise<InventoryItem[]> {
  return (await db()).getAllFromIndex("inventory", "byProject", projectId);
}
export async function saveInventory(item: InventoryItem) {
  await (await db()).put("inventory", item);
  notify();
}
export async function deleteInventory(id: ID) {
  await deleteMediaFor(id);
  await (await db()).delete("inventory", id);
  notify();
}

export async function listInspirations(projectId: ID): Promise<Inspiration[]> {
  return (await (await db()).getAllFromIndex("inspirations", "byProject", projectId)).sort((a, b) => b.createdAt - a.createdAt);
}
export async function saveInspiration(i: Inspiration) {
  await (await db()).put("inspirations", i);
  notify();
}
export async function deleteInspiration(id: ID) {
  await deleteMediaFor(id);
  await (await db()).delete("inspirations", id);
  notify();
}

export async function listDesigns(roomId: ID): Promise<Design[]> {
  return (await (await db()).getAllFromIndex("designs", "byRoom", roomId)).sort((a, b) => a.createdAt - b.createdAt);
}
export async function listProjectDesigns(projectId: ID): Promise<Design[]> {
  return (await db()).getAllFromIndex("designs", "byProject", projectId);
}
export async function getDesign(id: ID) {
  return (await db()).get("designs", id);
}
export async function saveDesign(d: Design, doNotify = true) {
  await (await db()).put("designs", d);
  if (doNotify) notify();
}
export async function updateDesign(id: ID, patch: Partial<Design> | ((d: Design) => Partial<Design>)) {
  const dbx = await db();
  const d = await dbx.get("designs", id);
  if (!d) return;
  const p = typeof patch === "function" ? patch(d) : patch;
  await dbx.put("designs", { ...d, ...p });
  notify();
}
export async function deleteDesign(id: ID) {
  await deleteMediaFor(id);
  await (await db()).delete("designs", id);
  notify();
}

export async function addMedia(m: Omit<MediaRecord, "id" | "createdAt">): Promise<MediaRecord> {
  const rec: MediaRecord = { ...m, id: newId(), createdAt: Date.now() };
  await (await db()).put("media", rec);
  notify();
  return rec;
}
export async function listMedia(ownerId: ID): Promise<MediaRecord[]> {
  return (await (await db()).getAllFromIndex("media", "byOwner", ownerId)).sort((a, b) => (a.timeSec ?? 0) - (b.timeSec ?? 0) || a.createdAt - b.createdAt);
}
export async function getMedia(id: ID) {
  return (await db()).get("media", id);
}
export async function deleteMedia(id: ID) {
  await (await db()).delete("media", id);
  notify();
}
export async function deleteMediaFor(ownerId: ID) {
  const d = await db();
  for (const m of await d.getAllFromIndex("media", "byOwner", ownerId)) await d.delete("media", m.id);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
}

// ---------------------------------------------------------------------------
// Export / import a project (media optional)
// ---------------------------------------------------------------------------
interface ExportFile {
  format: "room-planner-project";
  version: 1;
  exportedAt: string;
  project: Project;
  rooms: Room[];
  inventory: InventoryItem[];
  inspirations: Inspiration[];
  designs: Design[];
  media: (Omit<MediaRecord, "blob"> & { dataUrl: string })[];
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export async function exportProject(projectId: ID, includeMedia: boolean): Promise<Blob> {
  const d = await db();
  const project = await d.get("projects", projectId);
  if (!project) throw new Error("Project not found");
  const rooms = await d.getAllFromIndex("rooms", "byProject", projectId);
  const inventory = await d.getAllFromIndex("inventory", "byProject", projectId);
  const inspirations = await d.getAllFromIndex("inspirations", "byProject", projectId);
  const designs = await d.getAllFromIndex("designs", "byProject", projectId);
  const owners = [...rooms.map((r) => r.id), ...inventory.map((i) => i.id), ...inspirations.map((i) => i.id), ...designs.map((x) => x.id)];
  const media: ExportFile["media"] = [];
  if (includeMedia) {
    for (const o of owners) {
      for (const m of await d.getAllFromIndex("media", "byOwner", o)) {
        const { blob, ...rest } = m;
        media.push({ ...rest, dataUrl: await blobToDataUrl(blob) });
      }
    }
  }
  const file: ExportFile = { format: "room-planner-project", version: 1, exportedAt: new Date().toISOString(), project, rooms, inventory, inspirations, designs, media };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

export async function importProject(file: File): Promise<Project> {
  const data = JSON.parse(await file.text()) as ExportFile;
  if (data.format !== "room-planner-project") throw new Error("This is not a Room Planner project file.");
  const d = await db();
  // New ids so an import never overwrites existing data.
  const map = new Map<string, string>();
  const nid = (old: string) => {
    if (!map.has(old)) map.set(old, newId());
    return map.get(old)!;
  };
  const project: Project = { ...data.project, id: nid(data.project.id), name: `${data.project.name} (imported)`, updatedAt: Date.now() };
  await d.put("projects", project);
  for (const r of data.rooms) {
    await d.put("rooms", { ...r, id: nid(r.id), projectId: project.id, chosenDesignId: r.chosenDesignId ? nid(r.chosenDesignId) : null, pipeline: undefined });
  }
  for (const i of data.inventory) {
    await d.put("inventory", { ...i, id: nid(i.id), projectId: project.id, roomId: i.roomId ? nid(i.roomId) : null, photoId: i.photoId ? nid(i.photoId) : undefined });
  }
  for (const i of data.inspirations) await d.put("inspirations", { ...i, id: nid(i.id), projectId: project.id });
  for (const x of data.designs) {
    await d.put("designs", {
      ...x,
      id: nid(x.id),
      roomId: nid(x.roomId),
      projectId: project.id,
      parentDesignId: x.parentDesignId ? nid(x.parentDesignId) : undefined,
      imageMediaId: x.imageMediaId ? nid(x.imageMediaId) : undefined,
      items: x.items.map((it) => (it.ref.type === "inventory" ? { ...it, ref: { type: "inventory", inventoryId: nid(it.ref.inventoryId) } } : it)),
      removed: x.removed.map((rm) => ({ ...rm, inventoryId: nid(rm.inventoryId) })),
    });
  }
  for (const m of data.media) {
    const blob = await (await fetch(m.dataUrl)).blob();
    const { dataUrl: _omit, ...rest } = m;
    void _omit;
    await d.put("media", { ...rest, id: nid(m.id), ownerId: nid(m.ownerId), blob });
  }
  notify();
  return project;
}
