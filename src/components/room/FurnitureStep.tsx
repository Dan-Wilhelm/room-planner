"use client";

import { listInventory, listRooms, saveInventory, updateRoom, useLive } from "@/lib/db";
import { CATEGORY_LABEL } from "@/lib/categories";
import type { Room } from "@/lib/types";
import { InventoryEditor, newInventoryItem } from "../project/InventoryEditor";
import { Badge, Button, Card } from "../ui";

export function FurnitureStep({ room, onNext }: { room: Room; onNext: () => void }) {
  const { data: inventory } = useLive(() => listInventory(room.projectId), [room.projectId], []);
  const { data: rooms } = useLive(() => listRooms(room.projectId), [room.projectId], []);
  const spare = inventory.filter((i) => i.roomId === null);
  const suggestions = room.furnitureSuggestions ?? [];

  return (
    <div className="space-y-5">
      {suggestions.length > 0 && (
        <Card title="Furniture the AI recognized — confirm what you own">
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{CATEGORY_LABEL[s.category]}</Badge>
                <span className="font-medium">{s.name}</span>
                <span className="text-stone-500">
                  ≈ {s.w}×{s.d}×{s.h} cm {s.color && `· ${s.color}`} {s.material && `· ${s.material}`}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    await saveInventory(
                      newInventoryItem(room.projectId, room.id, { name: s.name, category: s.category, w: s.w, d: s.d, h: s.h, color: s.color, material: s.material, description: s.notes, flag: "keep" }),
                    );
                    await updateRoom(room.id, { furnitureSuggestions: suggestions.filter((_, j) => j !== i) });
                  }}
                >
                  Add (please check the size)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => updateRoom(room.id, { furnitureSuggestions: suggestions.filter((_, j) => j !== i) })}>
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={`Furniture in ${room.name}`} actions={<span className="text-xs text-stone-500">“Keep” = must stay in this room (can be moved); “Replaceable” = may be replaced or removed.</span>}>
        <InventoryEditor projectId={room.projectId} items={inventory} rooms={rooms} roomFilter={room.id} />
      </Card>
      {spare.length > 0 && (
        <Card title="Spare items from the project (designs may use them)">
          <ul className="space-y-1 text-sm">
            {spare.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-stone-500">
                  {s.w}×{s.d}×{s.h} cm
                </span>
                <Button size="sm" onClick={() => saveInventory({ ...s, roomId: room.id, removedFrom: undefined })}>
                  Move into this room
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Next: taste & idea →
        </Button>
      </div>
    </div>
  );
}
