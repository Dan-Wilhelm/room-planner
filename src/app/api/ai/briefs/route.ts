import type { RoomModel } from "@/lib/types";
import { isMock } from "@/lib/server/ai/client";
import { DesignRequest, designContext } from "@/lib/server/ai/designPrompt";
import { mockBriefs } from "@/lib/server/ai/mock";
import { ndjsonResponse } from "@/lib/server/ai/ndjson";
import { BRIEFS_SYSTEM } from "@/lib/server/ai/prompts";
import { readJson } from "@/lib/server/ai/request";
import { BriefsSchema } from "@/lib/server/ai/schemas";
import { structuredCall } from "@/lib/server/ai/structured";

export const maxDuration = 300;

export async function POST(req: Request) {
  const parsed = await readJson(req, DesignRequest);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) return mockBriefs(emit, b.room as RoomModel, b.count, b.style.mode === "inspiration");
    const text = [...designContext(b), "", `Write ${b.count} short, clearly distinct design brief(s) for this room.`].join("\n");
    const { data } = await structuredCall({
      step: "briefs",
      system: BRIEFS_SYSTEM,
      content: [{ type: "text", text }],
      schema: BriefsSchema,
      maxTokens: 12000,
      effort: "low",
      emit,
      progressLabel: "Choosing design directions",
    });
    return { briefs: data.briefs.slice(0, b.count) };
  });
}
