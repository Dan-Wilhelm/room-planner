import "server-only";
import { getDeadline } from "@vercel/functions";
import type { CostEntry, StreamEvent } from "@/lib/types";

export interface Emitter {
  progress(message: string, done?: number, total?: number): void;
  cost(entry: CostEntry): void;
  /** Milliseconds left before the platform deadline (minus a safety margin). Infinity locally. */
  timeLeftMs(): number;
  signal: AbortSignal;
}

export class UserFacingError extends Error {
  constructor(
    message: string,
    public retryable = true,
  ) {
    super(message);
  }
}

const SAFETY_MARGIN_MS = 25_000;

/**
 * Runs `work` and streams NDJSON events: progress, heartbeats (every 10 s), cost entries,
 * then exactly one `result` or `error` line.
 */
export function ndjsonResponse<T>(req: Request, work: (emit: Emitter) => Promise<T>): Response {
  const encoder = new TextEncoder();
  const deadline = getDeadline();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          closed = true;
        }
      };
      const hb = setInterval(() => send({ type: "heartbeat", t: Date.now() }), 10_000);
      const emit: Emitter = {
        progress: (message, done, total) => send({ type: "progress", message, done, total }),
        cost: (entry) => send({ type: "cost", entry }),
        timeLeftMs: () => (deadline ? deadline.getTime() - Date.now() - SAFETY_MARGIN_MS : Number.POSITIVE_INFINITY),
        signal: req.signal,
      };
      try {
        const data = await work(emit);
        send({ type: "result", data });
      } catch (err) {
        const message =
          err instanceof UserFacingError
            ? err.message
            : err instanceof Error && err.name === "AbortError"
              ? "Cancelled."
              : "Something went wrong on the server. Please try again.";
        if (!(err instanceof UserFacingError)) console.error("[ndjson]", err);
        send({ type: "error", message, retryable: err instanceof UserFacingError ? err.retryable : true });
      } finally {
        clearInterval(hb);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
