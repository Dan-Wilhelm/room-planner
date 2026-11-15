import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { costFromUsage } from "@/lib/pricing";
import type { CostEntry } from "@/lib/types";
import { anthropic, productModel, toUserError } from "./client";
import { UserFacingError, type Emitter } from "./ndjson";
import { PRODUCTS_SYSTEM } from "./prompts";
import { SubmitProductsSchema, type SubmitProducts } from "./schemas";

export interface SlotRequest {
  key: string;
  category: string;
  label: string;
  maxW: number;
  maxD: number;
  maxH: number;
  color: string;
  material: string;
  styleTags: string[];
  targetBudget: number;
  targetNicer: number;
  quantity: number;
  lookAlike: string;
  notes: string;
}

export interface ProductSearchInput {
  designName: string;
  style: string;
  budgetEur: number | null;
  slots: SlotRequest[];
  mode: "tiers" | "alternatives";
  wish?: string; // alternatives: the user's wish
  maxSearches: number;
  stopAtUsd: number; // stop starting new batches once this much was spent in this request
}

const SUBMIT_TOOL: Anthropic.Messages.Tool = {
  name: "submit_products",
  description:
    "Submit all products you found. Call exactly once at the end. Each product references a slotKey and a tier ('budget' or 'nicer'; 'alternative' when asked for alternatives).",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["products", "notes"],
    properties: {
      notes: { type: "string" },
      products: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slotKey", "tier", "rank", "name", "shop", "priceEur", "url", "w", "d", "h", "dimsVerified", "why", "assembly", "bulky", "pickup", "similarity"],
          properties: {
            slotKey: { type: "string" },
            tier: { type: "string", enum: ["budget", "nicer", "alternative"] },
            rank: { type: "integer" },
            name: { type: "string" },
            shop: { type: "string" },
            priceEur: { type: "number" },
            url: { type: "string" },
            w: { type: "number" },
            d: { type: "number" },
            h: { type: "number" },
            dimsVerified: { type: "boolean" },
            why: { type: "string" },
            assembly: { type: "boolean" },
            bulky: { type: "boolean" },
            pickup: { type: "boolean" },
            similarity: { type: "string" },
          },
        },
      },
    },
  },
};

/** Web tool versions per model: the dynamic-filtering versions are not available on Haiku 5.5. */
function webTools(model: string, maxSearches: number) {
  const location = { type: "approximate" as const, city: "Karlsruhe", region: "Baden-Württemberg", country: "DE", timezone: "Europe/Berlin" };
  if (model.startsWith("claude-haiku")) {
    return [
      { type: "web_search_20250305" as const, name: "web_search" as const, max_uses: maxSearches, user_location: location },
      { type: "web_fetch_20250910" as const, name: "web_fetch" as const, max_uses: 3 },
    ];
  }
  return [
    { type: "web_search_20260318" as const, name: "web_search" as const, max_uses: maxSearches, user_location: location },
    { type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: 3 },
  ];
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const p of [...url.searchParams.keys()]) {
      if (/^(utm_|ref|tag|psc|th|smid|spm|gclid|fbclid)/i.test(p)) url.searchParams.delete(p);
    }
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
}

/** Collects every URL that appeared in web_search / web_fetch results. */
function collectResultUrls(content: Anthropic.Messages.ContentBlock[], into: Set<string>) {
  for (const block of content as unknown as Array<Record<string, unknown>>) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as Array<{ url?: string }>) if (r.url) into.add(normalizeUrl(r.url));
    }
    if (block.type === "web_fetch_tool_result") {
      const c = block.content as { url?: string; content?: { source?: { url?: string } } } | undefined;
      if (c?.url) into.add(normalizeUrl(c.url));
    }
  }
}

function buildUserText(input: ProductSearchInput, slots: SlotRequest[]): string {
  const lines = [
    `Design: "${input.designName}" — style: ${input.style}`,
    input.budgetEur != null ? `Room budget for the Budget tier (incl. paint/materials, excl. shipping): €${input.budgetEur}` : "No fixed budget.",
    input.mode === "alternatives"
      ? `Find up to 5 ALTERNATIVE products (tier "alternative", rank 1–5) for the slot below that match the design's style — the closest real matches if none is perfect. User wish: "${input.wish || "no special wish"}".`
      : `Find candidates for both tiers for each slot (up to 3 per tier).`,
    `You may use at most ${input.maxSearches} web searches in total.`,
    "",
    "Slots (JSON):",
    JSON.stringify(slots),
  ];
  return lines.join("\n");
}

async function runBatch(
  input: ProductSearchInput,
  slots: SlotRequest[],
  emit: Emitter,
  step: string,
): Promise<{ result: SubmitProducts | null; text: string; urls: Set<string>; costs: CostEntry[] }> {
  const model = productModel();
  const client = anthropic();
  const urls = new Set<string>();
  const costs: CostEntry[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserText(input, slots) }];
  let reminded = false;
  let lastText = "";

  for (let turn = 0; turn < 8; turn++) {
    if (emit.timeLeftMs() < 20_000) throw new UserFacingError("Ran out of time on the server for this step — please retry.");
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [{ type: "text", text: PRODUCTS_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: [...webTools(model, input.maxSearches), SUBMIT_TOOL],
        tool_choice: { type: "auto" },
        messages,
      },
      { signal: emit.signal },
    );
    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      throw toUserError(err);
    }
    const cost = costFromUsage(step, model, message.usage as never);
    costs.push(cost);
    emit.cost(cost);
    collectResultUrls(message.content, urls);
    lastText = message.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n") || lastText;
    const searches = message.usage.server_tool_use?.web_search_requests ?? 0;
    if (searches) emit.progress(`Searching shops… (${searches} searches in this step)`);

    if (message.stop_reason === "refusal") {
      // No server-side fallback on Haiku 5.5: retry once with a reworded request, then give up.
      if (!reminded) {
        reminded = true;
        messages.splice(0, messages.length, {
          role: "user",
          content: `Please look up ordinary home furnishing products in German online shops for these items:\n${JSON.stringify(slots.map((s) => ({ key: s.key, item: s.label, maxSizeCm: [s.maxW, s.maxD, s.maxH] })))}\nReport them with submit_products.`,
        });
        continue;
      }
      throw new UserFacingError("The product search was declined by the AI. Please retry later.");
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_products");
    if (toolUse) {
      if (message.stop_reason === "max_tokens") throw new UserFacingError("The product list was cut off — please retry.");
      const parsed = SubmitProductsSchema.safeParse(toolUse.input);
      if (parsed.success) return { result: parsed.data, text: lastText, urls, costs };
      if (!reminded) {
        reminded = true;
        messages.push({ role: "assistant", content: message.content });
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: "INVALID_JSON: the input did not match the schema. Call submit_products again with valid input." }],
        });
        continue;
      }
      break;
    }
    // Ended without calling the tool: remind once.
    if (!reminded) {
      reminded = true;
      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: "Now call submit_products with everything you found (no more searches)." });
      continue;
    }
    break;
  }
  return { result: null, text: lastText, urls, costs };
}

/** Fallback: turn free text into the product JSON with a cheap structured call. */
async function convertTextToProducts(text: string, emit: Emitter): Promise<{ result: SubmitProducts | null; cost: CostEntry | null }> {
  if (!text.trim()) return { result: null, cost: null };
  const { structuredCall } = await import("./structured");
  try {
    const { data, cost } = await structuredCall({
      step: "convert",
      model: productModel(),
      effort: "low",
      system: "Convert the shopping research notes into the product JSON. Only include products with a URL that appears in the notes. Never invent data.",
      content: [{ type: "text", text }],
      schema: SubmitProductsSchema,
      maxTokens: 8000,
      emit,
    });
    return { result: data, cost };
  } catch {
    return { result: null, cost: null };
  }
}

/** Rejects URLs that are not a German product detail page (search/listing pages, foreign shops). */
export function isAcceptableProductUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = decodeURIComponent(u.pathname).toLowerCase();
  if (/(^|\.)amazon\./.test(host)) return host === "amazon.de" && /\/(dp|gp\/product)\/[a-z0-9]{10}/i.test(path);
  if (/(^|\.)ikea\.com$/.test(host)) return path.startsWith("/de/de/") && path.includes("/p/");
  if (/\/(s|search|suche|such|kategorie|category|c)\/?$/.test(path) || u.searchParams.has("q") || u.searchParams.has("k")) return false;
  return true;
}

export interface ProductSearchResult {
  products: SubmitProducts["products"];
  droppedUnknownUrls: number;
  notes: string[];
  stoppedForBudget: boolean;
  diagnostics: { dropped: Record<string, number>; emptySlots: string[]; searchesPerBatch: number; batches: number };
}

/** Runs the product search in batches (keeps each request well under 100K input tokens). */
export async function searchProducts(input: ProductSearchInput, emit: Emitter, step = "products"): Promise<ProductSearchResult> {
  const batchSize = input.mode === "alternatives" ? 1 : 4;
  const batches: SlotRequest[][] = [];
  for (let i = 0; i < input.slots.length; i += batchSize) batches.push(input.slots.slice(i, i + batchSize));
  // At least one search per slot in the batch plus one spare — never fewer searches than items.
  const perBatchSearches = Math.max(Math.min(batchSize, input.slots.length) + 1, Math.floor(input.maxSearches / Math.max(1, batches.length)));

  const all: SubmitProducts["products"] = [];
  const notes: string[] = [];
  let dropped = 0;
  const dropReasons: Record<string, number> = { unknownUrl: 0, notProductPage: 0, duplicate: 0, invalidUrl: 0 };
  let spent = 0;
  let stoppedForBudget = false;

  for (let b = 0; b < batches.length; b++) {
    if (spent >= input.stopAtUsd) {
      stoppedForBudget = true;
      notes.push(`Stopped searching to stay within the cost limit (${batches.length - b} batch(es) skipped).`);
      break;
    }
    emit.progress(input.mode === "alternatives" ? "Finding alternatives…" : `Finding products ${Math.min((b + 1) * batchSize, input.slots.length)}/${input.slots.length}…`, b, batches.length);
    const { result, text, urls, costs } = await runBatch({ ...input, maxSearches: perBatchSearches }, batches[b], emit, step);
    spent += costs.reduce((s, c) => s + c.usd, 0);
    let final = result;
    if (!final) {
      const conv = await convertTextToProducts(text, emit);
      if (conv.cost) spent += conv.cost.usd;
      final = conv.result;
      if (!final) notes.push(`No products could be read for: ${batches[b].map((s) => s.label).join(", ")}.`);
    }
    if (final) {
      if (final.notes) notes.push(final.notes);
      const keys = new Set(batches[b].map((s) => s.key));
      const seen = new Set<string>();
      for (const p of final.products) {
        if (!keys.has(p.slotKey)) continue;
        const dedupe = `${p.slotKey}|${p.tier}|${normalizeUrl(p.url)}`;
        const reason = !/^https?:\/\//i.test(p.url)
          ? "invalidUrl"
          : !urls.has(normalizeUrl(p.url))
            ? "unknownUrl"
            : !isAcceptableProductUrl(p.url)
              ? "notProductPage"
              : seen.has(dedupe)
                ? "duplicate"
                : null;
        if (reason) {
          dropped++;
          dropReasons[reason]++;
          continue;
        }
        seen.add(dedupe);
        all.push(p);
      }
    }
  }
  const covered = new Set(all.map((p) => p.slotKey));
  const emptySlots = input.slots.filter((s) => !covered.has(s.key)).map((s) => s.label);
  const diagnostics = { dropped: dropReasons, emptySlots, searchesPerBatch: perBatchSearches, batches: batches.length };
  console.info("[products]", JSON.stringify({ step, slots: input.slots.length, found: all.length, ...diagnostics, spent: Math.round(spent * 1000) / 1000 }));
  return { products: all, droppedUnknownUrls: dropped, notes, stoppedForBudget, diagnostics };
}
