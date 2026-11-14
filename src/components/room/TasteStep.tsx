"use client";

import { listInspirations, listProjectDesigns, listRooms, updateRoom, useLive } from "@/lib/db";
import type { Room, StyleSource, Taste } from "@/lib/types";
import { Badge, Button, Card, Field, Notice, TextArea, TextInput, cx } from "../ui";

function Choice<T extends string>({ value, options, onChange }: { value: T | null; options: T[]; onChange: (v: T | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(value === o ? null : o)}
          className={cx("rounded-full px-3 py-1 text-sm ring-1", value === o ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50")}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function TasteStep({ room, onNext }: { room: Room; onNext: () => void }) {
  const { data: inspirations } = useLive(() => listInspirations(room.projectId), [room.projectId], []);
  const { data: rooms } = useLive(() => listRooms(room.projectId), [room.projectId], []);
  const { data: designs } = useLive(() => listProjectDesigns(room.projectId), [room.projectId], []);
  const t = room.taste;
  const setTaste = (patch: Partial<Taste>) => updateRoom(room.id, { taste: { ...t, ...patch } });
  const setStyle = (s: StyleSource) => updateRoom(room.id, { styleSource: s });
  const s = room.styleSource;
  const otherRooms = rooms.filter((r) => r.id !== room.id && r.chosenDesignId);
  const analysed = inspirations.filter((i) => i.dna);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Your taste (optional — skip anything)">
        <div className="space-y-4">
          <button
            onClick={() => setTaste({ dontKnow: !t.dontKnow })}
            className={cx("w-full rounded-lg px-4 py-3 text-left text-sm ring-1", t.dontKnow ? "bg-violet-50 text-violet-900 ring-violet-300" : "bg-white ring-stone-300 hover:bg-stone-50")}
          >
            <span className="font-medium">I don&apos;t know yet — show me different directions.</span>
            <span className="block text-xs text-stone-500">The 3 designs will be clearly different in style, each described in plain words.</span>
          </button>
          <div className={cx(t.dontKnow && "pointer-events-none opacity-40")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Colours I like">
                <TextInput value={t.colorsLike} placeholder="e.g. warm beige, sage green" onChange={(e) => setTaste({ colorsLike: e.target.value })} />
              </Field>
              <Field label="Colours I don't like">
                <TextInput value={t.colorsDislike} placeholder="e.g. grey, bright red" onChange={(e) => setTaste({ colorsDislike: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Wood">
                <Choice value={t.wood} options={["yes", "a bit", "no"]} onChange={(v) => setTaste({ wood: v })} />
              </Field>
              <Field label="Light">
                <Choice value={t.light} options={["warm", "neutral", "cool"]} onChange={(v) => setTaste({ light: v })} />
              </Field>
              <Field label="Feel">
                <Choice value={t.feel} options={["cozy", "airy and calm", "lively"]} onChange={(v) => setTaste({ feel: v })} />
              </Field>
              <Field label="Plants">
                <Choice value={t.plants} options={["many", "a few", "none"]} onChange={(v) => setTaste({ plants: v })} />
              </Field>
            </div>
          </div>
        </div>
      </Card>
      <div className="space-y-5">
        <Card title="Style source for this room">
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" checked={s.mode === "independent"} onChange={() => setStyle({ mode: "independent" })} className="mt-1" />
              <span>
                <span className="font-medium">Independent</span> — designed on its own; it may look completely different from the other rooms.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                disabled={otherRooms.length === 0}
                checked={s.mode === "matchRoom"}
                onChange={() => otherRooms[0] && setStyle({ mode: "matchRoom", roomId: otherRooms[0].id, designId: otherRooms[0].chosenDesignId! })}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Match another room</span> — use the style of a chosen design.
                {otherRooms.length === 0 && <span className="block text-xs text-stone-500">(No other room has a chosen design yet.)</span>}
                {s.mode === "matchRoom" && (
                  <select
                    className="mt-1 block rounded border border-stone-300 px-2 py-1"
                    value={s.roomId}
                    onChange={(e) => {
                      const r = otherRooms.find((x) => x.id === e.target.value);
                      if (r) setStyle({ mode: "matchRoom", roomId: r.id, designId: r.chosenDesignId! });
                    }}
                  >
                    {otherRooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} — {designs.find((d) => d.id === r.chosenDesignId)?.name ?? "design"}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                disabled={analysed.length === 0}
                checked={s.mode === "inspiration"}
                onChange={() => setStyle({ mode: "inspiration", inspirationIds: analysed.slice(0, 1).map((i) => i.id) })}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Follow inspiration(s)</span> — the 3 designs then differ in how closely they follow it.
                {analysed.length === 0 && <span className="block text-xs text-stone-500">(Analyse an inspiration on the project&apos;s inspiration board first.)</span>}
              </span>
            </label>
            {s.mode === "inspiration" && (
              <div className="ml-6 space-y-2">
                {analysed.map((i) => (
                  <label key={i.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={s.inspirationIds.includes(i.id)}
                      onChange={(e) => setStyle({ ...s, inspirationIds: e.target.checked ? [...s.inspirationIds, i.id] : s.inspirationIds.filter((x) => x !== i.id) })}
                    />
                    <span className="flex flex-wrap items-center gap-1">
                      {i.title || i.url || "Uploaded inspiration"} <Badge>{i.dna!.feel.slice(0, 40)}</Badge>
                    </span>
                  </label>
                ))}
                <TextInput placeholder='Only certain elements? e.g. "only the colours and the lighting"' value={s.elements ?? ""} onChange={(e) => setStyle({ ...s, elements: e.target.value })} />
                <p className="text-xs text-stone-500">Where the inspiration and your taste answers conflict, the inspiration wins.</p>
              </div>
            )}
          </div>
        </Card>
        <Card title="Your idea & budget">
          <Field label="Idea (optional)">
            <TextArea className="min-h-[60px]" placeholder="e.g. bedroom with a home office corner" value={room.idea} onChange={(e) => updateRoom(room.id, { idea: e.target.value })} />
          </Field>
          <Field label="Budget for this room (optional, EUR)" hint="Includes paint and small materials, excludes shipping (shown separately)." className="mt-3">
            <TextInput
              inputMode="decimal"
              className="w-40"
              value={room.budget ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".").trim();
                updateRoom(room.id, { budget: v === "" ? null : Math.max(0, Number(v) || 0) });
              }}
            />
          </Field>
        </Card>
        {!room.modelConfirmed && <Notice tone="warn">Please confirm the room model (step 2) before creating designs.</Notice>}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onNext} disabled={!room.modelConfirmed}>
            Next: designs →
          </Button>
        </div>
      </div>
    </div>
  );
}
