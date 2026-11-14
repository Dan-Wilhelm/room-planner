import type { CostEntry } from "./types";

/**
 * Dated price table (USD). Source: Anthropic list prices and the Vercel AI Gateway model list.
 * Update PRICES_AS_OF when changing values.
 */
export const PRICES_AS_OF = "2026-11-14";

interface TokenRates {
  input: number; // $ per 1M input tokens
  output: number;
  cacheRead: number;
  cacheWrite: number; // 5-minute cache write
}

const SONNET_5_5: TokenRates = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 };
// Claude Haiku 5.5 has two rate cards, selected by prompt length (≤ 100K tokens vs. longer).
const HAIKU_5_5_SHORT: TokenRates = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };
const HAIKU_5_5_LONG: TokenRates = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 };

export const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches
export const IMAGE_USD = 0.0336; // google/gemini-nano-banana-2.1, 1K
export const EUR_PER_USD = 0.87; // approximate, for display only

export const ROOM_RUN_LIMIT_USD = 1.0;
export const ALTERNATIVES_TARGET_USD = 0.1;
export const INSPIRATION_TARGET_USD = 0.15;

export function ratesFor(model: string, promptTokens: number): TokenRates {
  if (model.startsWith("claude-haiku-5-5")) return promptTokens > 100_000 ? HAIKU_5_5_LONG : HAIKU_5_5_SHORT;
  if (model.startsWith("claude-sonnet-5-5")) return SONNET_5_5;
  // Unknown model: be conservative and use Sonnet rates.
  return SONNET_5_5;
}

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
}

export function costFromUsage(step: string, model: string, usage: UsageLike, extra?: Partial<CostEntry>): CostEntry {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const fetches = usage.server_tool_use?.web_fetch_requests ?? 0;
  const r = ratesFor(model, input + cacheRead + cacheWrite);
  const usd =
    (input * r.input + output * r.output + cacheRead * r.cacheRead + cacheWrite * r.cacheWrite) / 1_000_000 +
    searches * WEB_SEARCH_USD;
  return {
    step,
    model,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    searches,
    fetches,
    images: 0,
    usd: Math.round(usd * 1_000_000) / 1_000_000,
    at: Date.now(),
    ...extra,
  };
}

export function imageCost(step = "image", count = 1, model = "google/gemini-nano-banana-2.1"): CostEntry {
  return {
    step,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    searches: 0,
    fetches: 0,
    images: count,
    usd: count * IMAGE_USD,
    at: Date.now(),
  };
}

export function sumCosts(entries: CostEntry[]): number {
  return Math.round(entries.reduce((s, e) => s + e.usd, 0) * 10000) / 10000;
}

export function formatUsd(usd: number): string {
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

export function formatUsdEur(usd: number): string {
  return `${formatUsd(usd)} (≈ €${(usd * EUR_PER_USD).toFixed(usd < 0.1 ? 3 : 2)})`;
}
