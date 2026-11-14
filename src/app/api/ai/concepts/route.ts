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

// Effort for the design call. Measured on the test room: "low" and "medium" cost the same (~11k output tokens
// per single design) with equal layout quality; "high" was ~3× cost and time. All designs of a run come from ONE call.
const designEffort = () => (process.env.DESIGN_EFFORT as "low" | "medium" | "high" | undefined) ?? "low";

export async function POST(req: Request) {
  const parsed = await readJson(req, DesignRequest);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) {
      return mockConcepts(emit, b.room as RoomModel, b.inventory as InventoryItem[], b.count, b.budget, b.style.mode === "inspiration");
    }
    const parts = designContext(b);
    parts.push("", b.count === 1 ? "Create 1 complete design." : `Create ${b.count} complete, distinct designs.`);
    const { data } = await structuredCall({
      step: b.buildOn ? "buildOn" : "concepts",
      system: CONCEPTS_SYSTEM,
      content: [{ type: "text", text: parts.join("\n") }],
      schema: ConceptsSchema,
      maxTokens: 64000,
      effort: designEffort(),
      emit,
      progressLabel: b.buildOn ? "Creating the variation" : "Designing",
    });
    return data;
  });
}
