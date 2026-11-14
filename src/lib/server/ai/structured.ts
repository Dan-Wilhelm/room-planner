import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { costFromUsage } from "@/lib/pricing";
import type { CostEntry } from "@/lib/types";
import { anthropic, DESIGN_MODEL, supportsServerFallback, toUserError } from "./client";
import { UserFacingError, type Emitter } from "./ndjson";

type BetaContent = Anthropic.Beta.Messages.BetaContentBlockParam[];

export interface StructuredOptions<S extends z.ZodType> {
  step: string;
  system: string;
  content: BetaContent;
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  model?: string;
  emit: Emitter;
  progressLabel?: string;
}

/**
 * One fresh, single-turn structured-output request (no web tools — structured outputs are
 * incompatible with citations). Streams to avoid HTTP timeouts and reports progress.
 */
export async function structuredCall<S extends z.ZodType>(opts: StructuredOptions<S>): Promise<{ data: z.infer<S>; cost: CostEntry }> {
  const model = opts.model ?? DESIGN_MODEL;
  const fallback = supportsServerFallback(model);
  let lastProgress = 0;
  let chars = 0;
  try {
    const stream = anthropic().beta.messages.stream(
      {
        model,
        max_tokens: opts.maxTokens ?? 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort ?? "high", format: betaZodOutputFormat(opts.schema) },
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: opts.content }],
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: opts.emit.signal },
    );
    stream.on("text", (delta) => {
      chars += delta.length;
      const now = Date.now();
      if (now - lastProgress > 2500) {
        lastProgress = now;
        opts.emit.progress(`${opts.progressLabel ?? "Writing"}… (${Math.round(chars / 100) / 10}k characters)`);
      }
    });
    const msg = await stream.finalMessage();
    const cost = costFromUsage(opts.step, msg.model ?? model, msg.usage as never);
    opts.emit.cost(cost);

    if (msg.stop_reason === "refusal") {
      throw new UserFacingError("The AI declined this request. Please rephrase the description or idea and try again.");
    }
    if (msg.stop_reason === "max_tokens") {
      throw new UserFacingError("The AI answer was too long and got cut off. Please retry (or simplify the request).");
    }
    const parsed = (msg as unknown as { parsed_output?: unknown }).parsed_output;
    if (parsed != null) return { data: parsed as z.infer<S>, cost };
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const json = JSON.parse(text);
    const result = opts.schema.safeParse(json);
    if (!result.success) throw new UserFacingError("The AI answer had an unexpected format. Please retry.");
    return { data: result.data, cost };
  } catch (err) {
    throw toUserError(err);
  }
}

/** Builds base64 image content blocks for the Messages API. */
export function imageBlocks(images: { base64: string; label?: string }[]): BetaContent {
  const blocks: BetaContent = [];
  images.forEach((img, i) => {
    blocks.push({ type: "text", text: img.label ? `Image ${i + 1}: ${img.label}` : `Image ${i + 1}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.base64 } });
  });
  return blocks;
}
