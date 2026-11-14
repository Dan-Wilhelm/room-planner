import { generateText } from "ai";
import { z } from "zod";
import { imageCost } from "@/lib/pricing";
import { isMock } from "@/lib/server/ai/client";
import { ndjsonResponse, sleep, UserFacingError } from "@/lib/server/ai/ndjson";
import { readJson } from "@/lib/server/ai/request";

export const maxDuration = 300;

const imageModel = () => process.env.IMAGE_MODEL || "google/gemini-nano-banana-2.1";

const Body = z.object({
  prompt: z.string().max(6000),
  layout: z.string().max(2_000_000), // base64 JPEG of the 3D view
  roomPhoto: z.string().max(1_500_000).optional(),
  inspiration: z.string().max(1_500_000).optional(),
});

// 1×1 beige JPEG-ish placeholder is not needed: in mock mode we echo the layout screenshot back.

function gatewayError(err: unknown): Error {
  const status = (err as { statusCode?: number; status?: number }).statusCode ?? (err as { status?: number }).status;
  const body = String((err as { responseBody?: string }).responseBody ?? (err as Error).message ?? "");
  if (status === 402 && body.includes("quota_for_entity_exceeded")) return new UserFacingError("The AI Gateway budget for this project is used up. Raise it in the Vercel dashboard (AI Gateway → Budgets).", false);
  if (status === 402) return new UserFacingError("No AI Gateway credits left. Add credits in the Vercel dashboard (AI Gateway → Credits).", false);
  if (status === 403) return new UserFacingError("AI Gateway needs a verified payment method on the Vercel team before images can be generated.", false);
  if (status === 429) return new UserFacingError("Image generation is rate-limited right now — please retry in a minute.");
  if (status === 401) return new UserFacingError("The server isn't authorised for the AI Gateway (OIDC token missing/expired).", false);
  console.error("[image]", status, body.slice(0, 500));
  return new UserFacingError("Image generation failed. Please retry.");
}

export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) {
      emit.progress("Rendering (mock)…");
      await sleep(600);
      emit.cost({ ...imageCost("image", 1, "mock"), usd: 0, note: "mock" });
      return { base64: b.layout, mediaType: "image/jpeg", model: "mock" };
    }
    const model = imageModel();
    emit.progress(`Rendering with ${model}…`);
    const content: ({ type: "text"; text: string } | { type: "file"; data: string; mediaType: string })[] = [
      { type: "text", text: "Reference 1 — the planned layout (a simple 3D model). Keep every furniture position, size and the room geometry exactly as shown:" },
      { type: "file", data: b.layout, mediaType: "image/jpeg" },
    ];
    if (b.roomPhoto) content.push({ type: "text", text: "Reference 2 — a real photo of this room (match walls, floor, windows, light):" }, { type: "file", data: b.roomPhoto, mediaType: "image/jpeg" });
    if (b.inspiration) content.push({ type: "text", text: "Reference 3 — style inspiration: adopt the mood, colours and materials, do NOT copy the scene:" }, { type: "file", data: b.inspiration, mediaType: "image/jpeg" });
    content.push({ type: "text", text: b.prompt });
    try {
      const result = await generateText({
        model,
        messages: [{ role: "user", content }],
        providerOptions: { google: { imageConfig: { imageSize: "1K", aspectRatio: "4:3" } } },
        abortSignal: emit.signal,
      });
      const file = result.files.find((f) => f.mediaType.startsWith("image/"));
      if (!file) throw new UserFacingError("The image model returned no image. Please retry.");
      emit.cost(imageCost("image", 1, model));
      const base64 = file.base64.replace(/^data:[^;]+;base64,/, "");
      return { base64, mediaType: file.mediaType, model };
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      throw gatewayError(err);
    }
  });
}
