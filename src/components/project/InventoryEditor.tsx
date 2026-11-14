"use client";

import { useRef } from "react";
import { addMedia, deleteInventory, getMedia, newId, saveInventory, useLive } from "@/lib/db";
import { CATEGORY_LABEL, PLACEABLE } from "@/lib/categories";
import { processImageFile } from "@/lib/media";
import type { ID, InventoryItem, ItemCategory, Room } from "@/lib/types";
import { Badge, Button, CmInput, Empty, Select, TextInput, useObjectUrl } from "../ui";

function Photo({ item }: { item: InventoryItem }) {
  const { data: rec } = useLive(async () => (item.photoId ? ((await getMedia(item.photoId)) ?? null) : null), [item.photoId], null);
  const url = useObjectUrl(rec?.blob);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1">
      {url ? <img src={url} alt="" className="h-9 w-9 rounded object-cover ring-1 ring-stone-200" /> : <span className="h-9 w-9 rounded bg-stone-100" />}
      <input
        ref={ref}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const img = await processImageFile(f);
            const rec = await addMedia({ ownerId: item.id, kind: "furniturePhoto", blob: img.blob, width: img.width, height: img.height });
            await saveInventory({ ...item, photoId: rec.id });
          } catch (err) {
            alert((err as { userMessage?: string }).userMessage ?? (err as Error).message);
          }
        }}
      />
      <Button size="sm" variant="ghost" onClick={() => ref.current?.click()}>
        {url ? "Change" : "Photo"}
      </Button>
    </div>
  );
}

export function newInventoryItem(projectId: ID, roomId: ID | null, patch: Partial<InventoryItem> = {}): InventoryItem {
  return { id: newId(), projectId, roomId, name: "New item", category: "other", w: 100, d: 50, h: 75, flag: "replaceable", ...patch };
}

export function InventoryEditor({ projectId, items, rooms, roomFilter }: { projectId: ID; items: InventoryItem[]; rooms: Room[]; roomFilter?: ID }) {
  const list = roomFilter ? items.filter((i) => i.roomId === roomFilter) : items;
  const save = (it: InventoryItem, patch: Partial<InventoryItem>) => saveInventory({ ...it, ...patch });
  const roomOptions = [{ value: "", label: "Spare (no room)" }, ...rooms.map((r) => ({ value: r.id, label: r.name }))];
  return (
    <div>
      {list.length === 0 ? (
        <Empty title={roomFilter ? "No furniture assigned to this room yet" : "No furniture yet"}>Add the furniture you already own — with its real dimensions.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-2">Name / description</th>
                <th className="pr-2">Category</th>
                <th className="pr-2">W × D × H</th>
                <th className="pr-2">Colour / material / shape</th>
                <th className="pr-2">Flag</th>
                <th className="pr-2">Room</th>
                <th className="pr-2">Photo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.id} className="border-t border-stone-100 align-top">
                  <td className="py-2 pr-2">
                    <TextInput aria-label="Name" value={it.name} onChange={(e) => save(it, { name: e.target.value })} />
                    <TextInput aria-label="Description" className="mt-1" placeholder="description" value={it.description ?? ""} onChange={(e) => save(it, { description: e.target.value })} />
                    {it.removedFrom && <Badge tone="violet">removed by a design — now spare</Badge>}
                  </td>
                  <td className="py-2 pr-2">
                    <Select<ItemCategory> value={it.category} onChange={(v) => save(it, { category: v })} options={PLACEABLE.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-col gap-1">
                      <CmInput ariaLabel="Width" value={it.w} min={1} max={1000} onChange={(v) => save(it, { w: v })} />
                      <CmInput ariaLabel="Depth" value={it.d} min={1} max={1000} onChange={(v) => save(it, { d: v })} />
                      <CmInput ariaLabel="Height" value={it.h} min={1} max={400} onChange={(v) => save(it, { h: v })} />
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <TextInput aria-label="Colour" placeholder="colour" value={it.color ?? ""} onChange={(e) => save(it, { color: e.target.value })} />
                    <TextInput aria-label="Material" className="mt-1" placeholder="material" value={it.material ?? ""} onChange={(e) => save(it, { material: e.target.value })} />
                    <TextInput aria-label="Shape" className="mt-1" placeholder='shape, e.g. "bed with headboard"' value={it.shapeHint ?? ""} onChange={(e) => save(it, { shapeHint: e.target.value })} />
                  </td>
                  <td className="py-2 pr-2">
                    <Select
                      value={it.flag}
                      onChange={(v) => save(it, { flag: v })}
                      options={[
                        { value: "keep", label: "Keep (only move)" },
                        { value: "replaceable", label: "Replaceable" },
                      ]}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Select value={it.roomId ?? ""} onChange={(v) => save(it, { roomId: v || null, removedFrom: undefined })} options={roomOptions} />
                  </td>
                  <td className="py-2 pr-2">
                    <Photo item={it} />
                  </td>
                  <td className="py-2">
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Delete "${it.name}"?`) && deleteInventory(it.id)}>
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3">
        <Button onClick={() => saveInventory(newInventoryItem(projectId, roomFilter ?? null))}>+ Add furniture</Button>
      </div>
    </div>
  );
}
