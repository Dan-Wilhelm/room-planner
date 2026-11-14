import { z } from "zod";
import { isMock } from "@/lib/server/ai/client";
import { mockDna } from "@/lib/server/ai/mock";
import { ndjsonResponse, UserFacingError } from "@/lib/server/ai/ndjson";
import { DNA_SYSTEM } from "@/lib/server/ai/prompts";
import { MAX_IMAGES, readJson } from "@/lib/server/ai/request";
import { DesignDnaSchema } from "@/lib/server/ai/schemas";
import { imageBlocks, structuredCall } from "@/lib/server/ai/structured";

export const maxDuration = 800;

const Body = z.object({
  url: z.string().max(2000).optional(),
  title: z.string().max(500).optional(),
  caption: z.string().max(5000).optional(),
  note: z.string().max(1000),
  images: z.array(z.object({ base64: z.string(), label: z.string().max(200).optional() })).max(MAX_IMAGES),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) return mockDna(emit);
    if (b.images.length === 0) throw new UserFacingError("Please add at least one image (screenshot, frame or cover image).", false);
    const text = [
      b.url ? `Source link (reference only): ${b.url}` : "Source: uploaded screenshots/recording",
      b.title ? `Title (data): ${b.title}` : "",
      b.caption ? `Caption (data): ${b.caption}` : "",
      `What the user means: ${b.note || "the overall look"}`,
      "",
      "Extract the design DNA.",
    ]
      .filter(Boolean)
      .join("\n");
    const { data } = await structuredCall({
      step: "inspiration",
      system: DNA_SYSTEM,
      content: [...imageBlocks(b.images), { type: "text", text }],
      schema: DesignDnaSchema,
      maxTokens: 12000,
      effort: "medium",
      emit,
      progressLabel: "Reading the inspiration",
    });
    return { ...data, kelvin: data.kelvin > 0 ? data.kelvin : null };
  });
}
