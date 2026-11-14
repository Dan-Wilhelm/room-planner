"use client";

import { useState } from "react";
import type { Design, ID } from "@/lib/types";
import { Button, Field, Modal, Select, TextArea } from "../ui";

export function BuildOnDialog({ design, open, onClose, onStart }: { design: Design; open: boolean; onClose: () => void; onStart: (feedback: string, count: number, locked: ID[]) => void }) {
  const [feedback, setFeedback] = useState("");
  const [count, setCount] = useState("2");
  const [locked, setLocked] = useState<ID[]>(design.locked ?? []);
  const lockables = [
    ...design.slots.map((s) => ({ id: s.id, label: s.label, kind: "new item" })),
    ...design.items.filter((i) => i.ref.type === "inventory").map((i) => ({ id: i.id, label: i.label, kind: "existing" })),
  ];
  return (
    <Modal open={open} onClose={onClose} title={`Build on “${design.name}”`}>
      <Field label="What should change?">
        <TextArea placeholder="e.g. desk by the window, warmer light, cheaper rug" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>
      <Field label="Number of variations" className="mt-3">
        <Select value={count} onChange={setCount} options={["1", "2", "3"].map((v) => ({ value: v, label: v }))} className="w-24" />
      </Field>
      <div className="mt-3">
        <span className="mb-1 block text-sm font-medium text-stone-700">Lock items (kept exactly, not searched again)</span>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-stone-200 p-2 text-sm">
          {lockables.map((l) => (
            <label key={l.id} className="flex items-center gap-2">
              <input type="checkbox" checked={locked.includes(l.id)} onChange={(e) => setLocked(e.target.checked ? [...locked, l.id] : locked.filter((x) => x !== l.id))} />
              {l.label} <span className="text-xs text-stone-400">({l.kind})</span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            onStart(feedback, Number(count), locked);
            onClose();
          }}
        >
          Create variations
        </Button>
      </div>
    </Modal>
  );
}
