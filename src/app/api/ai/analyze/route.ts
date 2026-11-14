import { z } from "zod";
import type { RoomModel } from "@/lib/types";
import { isMock } from "@/lib/server/ai/client";
import { mockAnalysis } from "@/lib/server/ai/mock";
import { ndjsonResponse } from "@/lib/server/ai/ndjson";
import { ANALYSIS_SYSTEM } from "@/lib/server/ai/prompts";
import { MAX_IMAGES, readJson } from "@/lib/server/ai/request";
import { RoomAnalysisSchema } from "@/lib/server/ai/schemas";
import { imageBlocks, structuredCall } from "@/lib/server/ai/structured";

export const maxDuration = 800;

const Body = z.object({
  roomName: z.string().max(200),
  description: z.string().max(8000),
  known: z.any().nullable(), // partial RoomModel with user-entered values
  userPaths: z.array(z.string()).max(500),
  images: z.array(z.object({ base64: z.string(), label: z.string().max(200).optional() })).max(MAX_IMAGES),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) return mockAnalysis(emit, (body.known as RoomModel | null) ?? null);
    emit.progress(`Analysing ${body.images.length} image(s) and the description…`);
    const text = [
      `Room: "${body.roomName}"`,
      "",
      "USER DESCRIPTION (data):",
      body.description || "(none)",
      "",
      "VALUES THE USER ENTERED (authoritative — copy exactly):",
      body.userPaths.length ? JSON.stringify({ paths: body.userPaths, model: body.known }) : "(none — estimate everything)",
      "",
      "Create the complete room model. Wall indexes and offsets must follow the coordinate conventions.",
    ].join("\n");
    const { data } = await structuredCall({
      step: "analysis",
      system: ANALYSIS_SYSTEM,
      content: [...imageBlocks(body.images), { type: "text", text }],
      schema: RoomAnalysisSchema,
      maxTokens: 24000,
      effort: "high",
      emit,
      progressLabel: "Measuring the room",
    });
    return data;
  });
}
