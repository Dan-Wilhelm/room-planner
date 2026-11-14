"use client";

import type { CostEntry, StreamEvent } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public retryable = true,
    public status?: number,
  ) {
    super(message);
  }
}

export interface StreamHandlers {
  onProgress?: (message: string, done?: number, total?: number) => void;
  onCost?: (entry: CostEntry) => void;
  signal?: AbortSignal;
}

/** POSTs JSON to an NDJSON route and resolves with the `result` payload. */
export async function postStream<T>(url: string, body: unknown, h: StreamHandlers = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: h.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new ApiError("Cancelled.", true);
    throw new ApiError("Network error — please check your connection and retry.");
  }
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError("Please sign in again.", false, 401);
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? `Request failed (${res.status}).`, res.status >= 500, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: T | undefined;
  let gotResult = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as StreamEvent<T>;
        if (ev.type === "progress") h.onProgress?.(ev.message, ev.done, ev.total);
        else if (ev.type === "cost") h.onCost?.(ev.entry);
        else if (ev.type === "result") {
          result = ev.data;
          gotResult = true;
        } else if (ev.type === "error") throw new ApiError(ev.message, ev.retryable ?? true);
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === "AbortError") throw new ApiError("Cancelled.", true);
    throw new ApiError("The connection was interrupted — please retry.");
  }
  if (!gotResult) throw new ApiError("The server stopped before finishing (time limit?) — please retry.");
  return result as T;
}
