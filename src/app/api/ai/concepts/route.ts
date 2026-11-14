import type { InventoryItem, RoomModel } from "@/lib/types";
import { isMock } from "@/lib/server/ai/client";
import { DesignRequest, designContext } from "@/lib/server/ai/designPrompt";
import { mockConcepts } from "@/lib/server/ai/mock";
import { ndjsonResponse } from "@/lib/server/ai/ndjson";
import { CONCEPTS_SYSTEM } from "@/lib/server/ai/prompts";
import { readJson } from "@/lib/server/ai/request";
import { ConceptsSchema } from "@/lib/server/ai/schemas";
import { structuredCall } from "@/lib/server/ai/structured";

export const maxDuration = 800;

// Effort for the detailed design call. "medium" keeps a design at ~$0.13 / ~90 s (measured);
// "high" was ~3× the cost and time for similar layout quality (the geometry check + repair fix the rest).
const designEffort = () => (process.env.DESIGN_EFFORT as "low" | "medium" | "high" | undefined) ?? "medium";

export async function POST(req: Request) {
  const parsed = await readJson(req, DesignRequest);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) {
      const approachIdx = Number((b.brief as { index?: number } | undefined)?.index ?? 0);
      const out = await mockConcepts(emit, b.room as RoomModel, b.inventory as InventoryItem[], b.count, b.budget, b.style.mode === "inspiration", approachIdx);
      return out;
    }
    const parts = designContext(b);
    if (b.brief) {
      parts.push("", "FOLLOW THIS BRIEF (direction for this design):", JSON.stringify(b.brief));
      if (b.otherBriefs?.length) parts.push("The other designs of this run follow these briefs — yours must be clearly different from them:", JSON.stringify(b.otherBriefs));
    }
    parts.push("", b.count === 1 ? "Create 1 complete design." : `Create ${b.count} complete, distinct designs.`);
    const { data } = await structuredCall({
      step: b.buildOn ? "buildOn" : "concepts",
      system: CONCEPTS_SYSTEM,
      content: [{ type: "text", text: parts.join("\n") }],
      schema: ConceptsSchema,
      maxTokens: 48000,
      effort: designEffort(),
      emit,
      progressLabel: b.buildOn ? "Creating the variation" : "Designing",
    });
    return data;
  });
}
