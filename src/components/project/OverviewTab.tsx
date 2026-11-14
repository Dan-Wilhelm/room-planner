"use client";

import Link from "next/link";
import { useState } from "react";
import { tierTotal } from "@/lib/designConvert";
import { getMedia, listMedia, useLive } from "@/lib/db";
import type { Design, ID, InventoryItem, Room, Tier } from "@/lib/types";
import { Badge, Button, Card, downloadBlob, Empty, ExternalLink, Select, useObjectUrl } from "../ui";
import { shoppingRows, toCsv } from "../design/shopping";

function Thumbnail({ design }: { design: Design }) {
  const { data } = useLive(
    async () => {
      if (design.imageMediaId) return (await getMedia(design.imageMediaId)) ?? null;
      const shots = (await listMedia(design.id)).filter((m) => m.kind === "screenshot");
      return shots[shots.length - 1] ?? null;
    },
    [design.id, design.imageMediaId],
    null,
  );
  const url = useObjectUrl(data?.blob);
  return url ? <img src={url} alt={design.name} className="h-32 w-48 rounded object-cover ring-1 ring-stone-200" /> : <div className="flex h-32 w-48 items-center justify-center rounded bg-stone-100 text-xs text-stone-400">open the design once for a 3D thumbnail</div>;
}

export function OverviewTab({ projectId, rooms, designs, inventory }: { projectId: ID; rooms: Room[]; designs: Design[]; inventory: InventoryItem[] }) {
  const [tiers, setTiers] = useState<Record<ID, Tier>>({});
  const chosen = rooms.map((r) => ({ room: r, design: designs.find((d) => d.id === r.chosenDesignId) ?? null }));
  const withDesign = chosen.filter((c) => c.design) as { room: Room; design: Design }[];
  const rows = withDesign.flatMap(({ room, design }) => shoppingRows(design, tiers[room.id] ?? "budget").map((r) => ({ ...r, room: room.name })));
  const byShop = new Map<string, typeof rows>();
  for (const r of rows) byShop.set(r.shop, [...(byShop.get(r.shop) ?? []), r]);
  const total = rows.reduce((s, r) => s + r.lineTotal, 0);
  const spare = inventory.filter((i) => i.roomId === null);

  return (
    <div className="space-y-5">
      <Card title="Rooms and chosen designs">
        {rooms.length === 0 && <Empty title="No rooms yet" />}
        <div className="space-y-4">
          {chosen.map(({ room, design }) => (
            <div key={room.id} className="flex flex-wrap items-center gap-4 border-b border-stone-100 pb-4 last:border-0">
              {design ? <Thumbnail design={design} /> : <div className="flex h-32 w-48 items-center justify-center rounded bg-stone-100 text-xs text-stone-400">no design chosen</div>}
              <div className="min-w-[220px] flex-1">
                <Link href={`/p/${projectId}/r/${room.id}`} className="font-semibold hover:underline">
                  {room.name}
                </Link>
                {design ? (
                  <>
                    <p className="text-sm text-stone-700">{design.name}</p>
                    <p className="text-xs text-stone-500">{design.style}</p>
                  </>
                ) : (
                  <p className="text-sm text-stone-500">Mark a design as “chosen” in the room to include it here.</p>
                )}
              </div>
              {design && (
                <div className="flex items-center gap-3">
                  <Select<Tier>
                    value={tiers[room.id] ?? "budget"}
                    onChange={(v) => setTiers({ ...tiers, [room.id]: v })}
                    options={[
                      { value: "budget", label: "Budget tier" },
                      { value: "nicer", label: "A bit nicer" },
                    ]}
                  />
                  <span className="text-sm font-semibold tabular-nums">€{tierTotal(design, tiers[room.id] ?? "budget").toFixed(2)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
      <Card
        title={`Combined shopping list — €${total.toFixed(2)} (shipping not included)`}
        actions={
          rows.length > 0 && (
            <>
              <Button size="sm" onClick={() => navigator.clipboard.writeText(rows.map((r) => `${r.room}\t${r.shop}\t${r.name}\t€${r.lineTotal.toFixed(2)}\t${r.url}`).join("\n"))}>
                Copy
              </Button>
              <Button size="sm" onClick={() => downloadBlob(new Blob([toCsv(rows)], { type: "text/csv" }), "shopping-list.csv")}>
                CSV
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                Print
              </Button>
            </>
          )
        }
      >
        {rows.length === 0 ? (
          <Empty title="Nothing to buy yet">Choose a design in each room.</Empty>
        ) : (
          <div className="space-y-4">
            {[...byShop.entries()].map(([shop, items]) => (
              <div key={shop}>
                <h3 className="mb-1 font-semibold">
                  {shop} <span className="text-sm font-normal text-stone-500">€{items.reduce((s, r) => s + r.lineTotal, 0).toFixed(2)}</span>
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {items.map((r, i) => (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="py-1 pr-2 text-stone-500">{r.room}</td>
                        <td className="pr-2">{r.name}</td>
                        <td className="pr-2 tabular-nums">€{r.lineTotal.toFixed(2)}</td>
                        <td className="pr-2">
                          <Badge tone={r.linkStatus === "verified" ? "green" : "amber"}>{r.linkStatus}</Badge>
                        </td>
                        <td>
                          <ExternalLink href={r.url}>link</ExternalLink>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Spare furniture">
        {spare.length === 0 ? (
          <p className="text-sm text-stone-500">No spare items.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {spare.map((s) => {
              const users = withDesign.filter(({ design }) => design.items.some((it) => it.ref.type === "inventory" && it.ref.inventoryId === s.id));
              const candidates = withDesign.filter(({ design }) => design.slots.some((sl) => sl.category === s.category));
              return (
                <li key={s.id}>
                  <span className="font-medium">{s.name}</span> ({s.w}×{s.d}×{s.h} cm){" "}
                  {users.length > 0 ? (
                    <span className="text-emerald-700">used in {users.map((u) => u.room.name).join(", ")}</span>
                  ) : candidates.length > 0 ? (
                    <span className="text-stone-600">could replace a planned purchase in {candidates.map((c) => c.room.name).join(", ")}</span>
                  ) : (
                    <span className="text-stone-500">not used — sell it or keep it for later</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
