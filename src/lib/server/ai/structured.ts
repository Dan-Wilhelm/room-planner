import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { toJSONSchema as zToJSONSchema, type z } from "zod";
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
  try {
    return await runCall(opts, "grammar");
  } catch (err) {
    // Large schemas can exceed the structured-output grammar limits ("compiled grammar is too large",
    // "Schema is too complex"). Then the same request runs in JSON-text mode, validated with the same zod schema.
    if (err instanceof Anthropic.BadRequestError && /grammar is too large|schema is too complex/i.test(err.message)) {
      opts.emit.progress("Large answer format — switching to validated JSON mode…");
      try {
        return await jsonModeCall(opts);
      } catch (e2) {
        throw toUserError(e2);
      }
    }
    throw toUserError(err);
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

/** JSON-text mode: schema in the prompt, strict zod validation, one correction round on failure. */
async function jsonModeCall<S extends z.ZodType>(opts: StructuredOptions<S>): Promise<{ data: z.infer<S>; cost: CostEntry }> {
  const schemaText = JSON.stringify(zToJSONSchema(opts.schema));
  const instruction = `\n\nOUTPUT FORMAT: reply with ONE JSON object only (no prose, no code fence) that validates against this JSON Schema. Every listed property is required; use "" / 0 / [] / false when not applicable.\n${schemaText}`;
  const first = await runCall({ ...opts, system: opts.system + instruction }, "text");
  let errorText = "";
  try {
    const parsed = opts.schema.safeParse(extractJson(first.text));
    if (parsed.success) return { data: parsed.data, cost: first.cost };
    errorText = parsed.error.issues.slice(0, 15).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  } catch (e) {
    errorText = `Not valid JSON: ${(e as Error).message}`;
  }
  opts.emit.progress("Correcting the answer format…");
  const second = await runCall(
    {
      ...opts,
      system: opts.system + instruction,
      content: [
        ...opts.content,
        { type: "text", text: `A previous answer to this request failed validation:\n${errorText}\n\nPrevious answer (fix it, keep the content):\n${first.text.slice(0, 60000)}` },
      ],
    },
    "text",
  );
  const parsed = opts.schema.safeParse(extractJson(second.text));
  if (!parsed.success) throw new UserFacingError("The AI answer had an unexpected format twice. Please retry.");
  return { data: parsed.data, cost: { ...second.cost, usd: second.cost.usd + first.cost.usd } };
}

async function runCall<S extends z.ZodType>(opts: StructuredOptions<S>, mode: "grammar"): Promise<{ data: z.infer<S>; cost: CostEntry }>;
async function runCall<S extends z.ZodType>(opts: StructuredOptions<S>, mode: "text"): Promise<{ text: string; cost: CostEntry }>;
async function runCall<S extends z.ZodType>(opts: StructuredOptions<S>, mode: "grammar" | "text"): Promise<{ data?: z.infer<S>; text?: string; cost: CostEntry }> {
  const model = opts.model ?? DESIGN_MODEL;
  const fallback = supportsServerFallback(model);
  let lastProgress = 0;
  let chars = 0;
  const stream = anthropic().beta.messages.stream(
    {
      model,
      max_tokens: opts.maxTokens ?? 32000,
      thinking: { type: "adaptive" },
      output_config: mode === "grammar" ? { effort: opts.effort ?? "high", format: betaZodOutputFormat(opts.schema) } : { effort: opts.effort ?? "high" },
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
  if (msg.stop_reason === "refusal") throw new UserFacingError("The AI declined this request. Please rephrase the description or idea and try again.");
  if (msg.stop_reason === "max_tokens") throw new UserFacingError("The AI answer was too long and got cut off. Please retry (or simplify the request).");
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  if (mode === "text") return { text, cost };
  const parsed = (msg as unknown as { parsed_output?: unknown }).parsed_output;
  if (parsed != null) return { data: parsed as z.infer<S>, cost };
  const result = opts.schema.safeParse(JSON.parse(text));
  if (!result.success) throw new UserFacingError("The AI answer had an unexpected format. Please retry.");
  return { data: result.data, cost };
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
