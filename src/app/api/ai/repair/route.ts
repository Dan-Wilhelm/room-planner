import { z } from "zod";
import { isMock } from "@/lib/server/ai/client";
import { mockRepair } from "@/lib/server/ai/mock";
import { ndjsonResponse } from "@/lib/server/ai/ndjson";
import { REPAIR_SYSTEM } from "@/lib/server/ai/prompts";
import { readJson } from "@/lib/server/ai/request";
import { RepairSchema } from "@/lib/server/ai/schemas";
import { structuredCall } from "@/lib/server/ai/structured";

export const maxDuration = 800;

const Body = z.object({
  room: z.any(),
  items: z.array(z.any()).max(120),
  violations: z.array(z.object({ code: z.string(), message: z.string(), itemIds: z.array(z.string()) })).max(80),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) return mockRepair(emit);
    const text = [
      "ROOM MODEL:",
      JSON.stringify(b.room),
      "",
      "CURRENT ITEMS (id, category, x, y, rotation, w, d, h, z, mount):",
      JSON.stringify(b.items),
      "",
      "VIOLATIONS FOUND BY THE CHECKER:",
      JSON.stringify(b.violations),
      "",
      "Return the moves (use the item ids above) that resolve as many violations as possible.",
    ].join("\n");
    const { data } = await structuredCall({
      step: "repair",
      system: REPAIR_SYSTEM,
      content: [{ type: "text", text }],
      schema: RepairSchema,
      maxTokens: 16000,
      effort: "high",
      emit,
      progressLabel: "Fixing the layout",
    });
    return data;
  });
}
