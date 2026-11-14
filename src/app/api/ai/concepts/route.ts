import { z } from "zod";
import type { InventoryItem, RoomModel } from "@/lib/types";
import { isMock } from "@/lib/server/ai/client";
import { mockConcepts } from "@/lib/server/ai/mock";
import { ndjsonResponse } from "@/lib/server/ai/ndjson";
import { CONCEPTS_SYSTEM } from "@/lib/server/ai/prompts";
import { readJson } from "@/lib/server/ai/request";
import { ConceptsSchema } from "@/lib/server/ai/schemas";
import { structuredCall } from "@/lib/server/ai/structured";

export const maxDuration = 800;

const Body = z.object({
  roomName: z.string().max(200),
  room: z.any(),
  inventory: z.array(z.any()).max(200),
  taste: z.any(),
  style: z.object({
    mode: z.enum(["independent", "matchRoom", "inspiration"]),
    otherRoomDesign: z.any().optional(), // compact summary of the other room's chosen design
    dnas: z.array(z.any()).max(6).optional(),
    elements: z.string().max(500).optional(),
  }),
  idea: z.string().max(2000),
  budget: z.number().nullable(),
  count: z.number().int().min(1).max(3),
  buildOn: z
    .object({
      design: z.any(), // compact design (items, slots, colours…)
      feedback: z.string().max(2000),
      lockedKeys: z.array(z.string()).max(60),
    })
    .optional(),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) {
      return mockConcepts(emit, b.room as RoomModel, b.inventory as InventoryItem[], b.count, b.budget, b.style.mode === "inspiration");
    }
    const parts: string[] = [
      `ROOM "${b.roomName}" (room model JSON):`,
      JSON.stringify(b.room),
      "",
      "INVENTORY (existing furniture; flag keep = must stay in this room, replaceable = may be replaced/removed; roomId null = spare from another room):",
      JSON.stringify(b.inventory),
      "",
      "TASTE (plain-language answers; dontKnow = show clearly different directions):",
      JSON.stringify(b.taste),
      "",
      `STYLE SOURCE: ${b.style.mode}`,
    ];
    if (b.style.mode === "matchRoom") parts.push("Match the style of this design from another room:", JSON.stringify(b.style.otherRoomDesign ?? {}));
    if (b.style.mode === "inspiration") {
      parts.push("Follow these inspiration design DNAs:", JSON.stringify(b.style.dnas ?? []));
      if (b.style.elements) parts.push(`Only use these elements of the inspiration: ${b.style.elements}`);
    }
    parts.push("", `IDEA: ${b.idea || "(none)"}`, `BUDGET (Budget tier, incl. paint + small materials, excl. shipping): ${b.budget != null ? `€${b.budget}` : "none given"}`);
    if (b.buildOn) {
      parts.push(
        "",
        `BUILD ON THIS EXISTING DESIGN — create ${b.count} variation(s) that apply the user's feedback and stay close otherwise:`,
        JSON.stringify(b.buildOn.design),
        `FEEDBACK: ${b.buildOn.feedback || "(none)"}`,
        `LOCKED (keep these item/slot keys exactly as they are, including their slot keys): ${JSON.stringify(b.buildOn.lockedKeys)}`,
      );
    } else {
      parts.push("", `Create ${b.count} complete, distinct designs.`);
    }
    const { data } = await structuredCall({
      step: b.buildOn ? "buildOn" : "concepts",
      system: CONCEPTS_SYSTEM,
      content: [{ type: "text", text: parts.join("\n") }],
      schema: ConceptsSchema,
      maxTokens: 64000,
      effort: "high",
      emit,
      progressLabel: b.buildOn ? "Creating variations" : "Designing",
    });
    return data;
  });
}
