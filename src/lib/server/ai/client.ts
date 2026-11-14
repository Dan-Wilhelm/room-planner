import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { UserFacingError } from "./ndjson";

export const DESIGN_MODEL = "claude-sonnet-5-5";
export const productModel = () => process.env.PRODUCT_SEARCH_MODEL || "claude-haiku-5-5";
export const isMock = () => (process.env.AI_MODE ?? "mock") !== "live";

/** Server-side refusal fallback is only available on the Sonnet/Opus/Fable lines — never on Haiku 5.5. */
export const supportsServerFallback = (model: string) => !model.startsWith("claude-haiku");

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new UserFacingError("The Anthropic API key is not configured on the server.", false);
    }
    client = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  }
  return client;
}

/** Translates SDK errors into messages for the UI. */
export function toUserError(err: unknown): Error {
  if (err instanceof UserFacingError) return err;
  if (err instanceof Anthropic.RateLimitError) return new UserFacingError("Rate limit reached at Anthropic — waiting a bit and retrying usually helps.");
  if (err instanceof Anthropic.AuthenticationError) return new UserFacingError("The Anthropic API key was rejected.", false);
  if (err instanceof Anthropic.BadRequestError) {
    console.error("[anthropic 400]", err.message);
    if (/credit balance is too low/i.test(err.message)) {
      return new UserFacingError("The Anthropic account has no credits left — please top up under Plans & Billing in the Anthropic Console.", false);
    }
    return new UserFacingError("The AI request was rejected (400). Details are in the server log.", false);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new UserFacingError("The AI request timed out. Please retry.");
  if (err instanceof Anthropic.APIConnectionError) return new UserFacingError("Could not reach the AI service. Please retry.");
  if (err instanceof Anthropic.APIError) return new UserFacingError(`AI service error (${err.status ?? "?"}). Please retry.`);
  if (err instanceof Error && err.name === "AbortError") return err;
  console.error("[ai]", err);
  return new UserFacingError("Unexpected AI error. Please retry.");
}
