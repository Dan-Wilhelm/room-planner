import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { isBlockedAddress } from "./ip";

/**
 * SSRF-safe HTTP client for fetching third-party pages and media.
 *
 * - Only http/https, no credentials in URLs.
 * - The hostname is resolved up front; if ANY resolved address is private/reserved
 *   the request is refused. The validated addresses are then pinned for the actual
 *   connection (custom `lookup`), so a second DNS answer (DNS rebinding) can't
 *   sneak in a private address.
 * - Redirects are followed manually and every hop is re-validated.
 * - No cookies are sent or kept; bodies are streamed and capped; one overall timeout.
 */

export type SafeFetchError = "timeout" | "blocked" | "invalid-url" | "network" | "too-large";

export interface SafeFetchOptions {
  /** Overall time budget for all hops (default 5000 ms). */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Max decoded body bytes; text bodies are truncated beyond this (default 1 MB). */
  maxBytes?: number;
  accept?: string;
  method?: "GET";
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  redirects: string[];
  headers: Headers;
  contentType: string;
  /** Text body (decoded with the page's charset), truncated at maxBytes. */
  body: string;
  bytes: Uint8Array | null;
  /** True when the body was cut off at maxBytes. */
  truncated?: boolean;
  error?: SafeFetchError;
}

export interface SafeFetchBinaryResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  redirects: string[];
  headers: Headers;
  contentType: string;
  bytes: Uint8Array | null;
  error?: SafeFetchError;
}

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const ACCEPT_LANGUAGE = "de-DE,de;q=0.9,en;q=0.8";
const DEFAULT_ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const DEFAULT_ACCEPT_MEDIA = "image/avif,image/webp,image/*,video/*;q=0.9,*/*;q=0.5";
export const MAX_PROXY_BYTES = 30 * 1024 * 1024;

class FetchFailure extends Error {
  constructor(
    readonly kind: SafeFetchError,
    readonly status = 0,
  ) {
    super(kind);
  }
}

// ---------------------------------------------------------------------------
// URL + DNS validation
// ---------------------------------------------------------------------------

/** Parses and validates a URL for outbound fetching (http/https only, no credentials). */
export function parseFetchableUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname) return null;
  return u;
}

function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

interface ResolvedAddress {
  address: string;
  family: number;
}

function withAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new FetchFailure("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new FetchFailure("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Resolves a hostname and refuses if any address is blocked. Exported for tests. */
export async function resolveSafeAddresses(hostname: string, signal?: AbortSignal): Promise<ResolvedAddress[]> {
  const host = bareHost(hostname).toLowerCase().replace(/\.$/, "");
  const literal = isIP(host);
  if (literal) {
    if (isBlockedAddress(host)) throw new FetchFailure("blocked");
    return [{ address: host, family: literal }];
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchFailure("blocked");
  }
  let addresses: ResolvedAddress[];
  try {
    const lookup = dns.promises.lookup(host, { all: true, verbatim: true });
    addresses = (await (signal ? withAbort(lookup, signal) : lookup)) as ResolvedAddress[];
  } catch (e) {
    if (e instanceof FetchFailure) throw e;
    throw new FetchFailure("network");
  }
  if (!addresses.length) throw new FetchFailure("network");
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new FetchFailure("blocked");
  return addresses;
}

// ---------------------------------------------------------------------------
// Single HTTP exchange
// ---------------------------------------------------------------------------

interface RawResponse {
  status: number;
  headers: Headers;
  stream: Readable;
  raw: http.IncomingMessage;
}

function toHeaders(h: http.IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    try {
      if (Array.isArray(v)) for (const item of v) out.append(k, item);
      else out.append(k, String(v));
    } catch {
      // skip headers with invalid characters
    }
  }
  return out;
}

function requestOnce(
  url: URL,
  addresses: ResolvedAddress[],
  accept: string,
  signal: AbortSignal,
): Promise<RawResponse> {
  const lib = url.protocol === "https:" ? https : http;
  // Pin the already-validated addresses; never resolve again for the connection.
  const lookup = ((_hostname: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options && options.all) cb(null, addresses);
    else cb(null, addresses[0].address, addresses[0].family);
  }) as unknown as LookupFunction;

  return new Promise<RawResponse>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: bareHost(url.hostname),
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        lookup,
        signal,
        headers: {
          "user-agent": BROWSER_USER_AGENT,
          accept,
          "accept-language": ACCEPT_LANGUAGE,
          "accept-encoding": "gzip, deflate, br",
          "cache-control": "no-cache",
          "upgrade-insecure-requests": "1",
        },
      },
      (res) => {
        const headers = toHeaders(res.headers);
        const enc = (res.headers["content-encoding"] ?? "").toString().trim().toLowerCase();
        let stream: Readable = res;
        if (enc === "gzip" || enc === "x-gzip" || enc === "deflate") stream = res.pipe(zlib.createUnzip());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        if (stream !== res) res.on("error", (e) => stream.destroy(e));
        resolve({ status: res.statusCode ?? 0, headers, stream, raw: res });
      },
    );
    req.on("error", (e) => {
      if (signal.aborted) reject(new FetchFailure("timeout"));
      else reject(new FetchFailure(e instanceof FetchFailure ? e.kind : "network"));
    });
    req.end();
  });
}

function discard(r: RawResponse): void {
  r.stream.destroy();
  r.raw.destroy();
}

async function readBody(
  r: RawResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const chunk of r.stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (total + buf.length > maxBytes) {
        chunks.push(buf.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } catch (e) {
    if (signal.aborted && !total) throw new FetchFailure("timeout", r.status);
    if (!total) throw new FetchFailure(signal.aborted ? "timeout" : "network", r.status);
    void e; // keep what we have (partial HTML is still useful)
  } finally {
    discard(r);
  }
  const merged = Buffer.concat(chunks, total);
  return { bytes: new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength), truncated };
}

// ---------------------------------------------------------------------------
// Text decoding
// ---------------------------------------------------------------------------

function charsetFrom(contentType: string, bytes: Uint8Array): string {
  const m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType);
  if (m) return m[1];
  const head = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head) ?? /<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(head);
  return meta ? meta[1] : "utf-8";
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const label = charsetFrom(contentType, bytes);
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// Core with redirects
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface CoreOptions {
  timeoutMs: number;
  maxRedirects: number;
  maxBytes: number;
  accept: string;
  /** Binary mode: exceeding maxBytes is an error instead of truncation. */
  strictSize: boolean;
}

interface CoreResult {
  status: number;
  finalUrl: string;
  redirects: string[];
  headers: Headers;
  contentType: string;
  bytes: Uint8Array | null;
  truncated: boolean;
  error?: SafeFetchError;
}

async function fetchCore(rawUrl: string, opts: CoreOptions): Promise<CoreResult> {
  const redirects: string[] = [];
  let current = parseFetchableUrl(rawUrl);
  const fail = (error: SafeFetchError, status = 0, headers = new Headers()): CoreResult => ({
    status,
    finalUrl: current?.href ?? String(rawUrl),
    redirects,
    headers,
    contentType: headers.get("content-type") ?? "",
    bytes: null,
    truncated: false,
    error,
  });
  if (!current) return fail("invalid-url");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      const addresses = await resolveSafeAddresses(current.hostname, controller.signal);
      const res = await requestOnce(current, addresses, opts.accept, controller.signal);

      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get("location");
        discard(res);
        if (!location) return fail("network", res.status, res.headers);
        if (hop >= opts.maxRedirects) return fail("network", res.status, res.headers);
        let next: URL | null = null;
        try {
          next = parseFetchableUrl(new URL(location, current).href);
        } catch {
          next = null;
        }
        if (!next) return fail("blocked", res.status, res.headers); // redirect to file:, javascript:, credentials…
        redirects.push(next.href);
        current = next;
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const declared = Number(res.headers.get("content-length") ?? "");
      if (opts.strictSize && Number.isFinite(declared) && declared > opts.maxBytes) {
        discard(res);
        return fail("too-large", res.status, res.headers);
      }
      const { bytes, truncated } = await readBody(res, opts.maxBytes, controller.signal);
      if (opts.strictSize && truncated) return fail("too-large", res.status, res.headers);
      return {
        status: res.status,
        finalUrl: current.href,
        redirects,
        headers: res.headers,
        contentType,
        bytes,
        truncated,
      };
    }
  } catch (e) {
    if (e instanceof FetchFailure) return fail(e.kind, e.status);
    return fail(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetches a page as text with SSRF protection. Never throws. */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const r = await fetchCore(url, {
    timeoutMs: opts.timeoutMs ?? 5000,
    maxRedirects: opts.maxRedirects ?? 5,
    maxBytes: opts.maxBytes ?? 1_000_000,
    accept: opts.accept ?? DEFAULT_ACCEPT_HTML,
    strictSize: false,
  });
  const body = r.bytes ? decodeText(r.bytes, r.contentType) : "";
  return {
    ok: !r.error && r.status >= 200 && r.status < 300,
    status: r.status,
    finalUrl: r.finalUrl,
    redirects: r.redirects,
    headers: r.headers,
    contentType: r.contentType,
    body,
    bytes: r.bytes,
    truncated: r.truncated,
    ...(r.error ? { error: r.error } : {}),
  };
}

/** Fetches binary content (images/videos for the media proxy). Exceeding maxBytes → error "too-large". */
export async function safeFetchBinary(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; accept?: string } = {},
): Promise<SafeFetchBinaryResult> {
  const r = await fetchCore(url, {
    timeoutMs: opts.timeoutMs ?? 20000,
    maxRedirects: opts.maxRedirects ?? 5,
    maxBytes: Math.min(opts.maxBytes ?? 10 * 1024 * 1024, MAX_PROXY_BYTES),
    accept: opts.accept ?? DEFAULT_ACCEPT_MEDIA,
    strictSize: true,
  });
  return {
    ok: !r.error && r.status >= 200 && r.status < 300,
    status: r.status,
    finalUrl: r.finalUrl,
    redirects: r.redirects,
    headers: r.headers,
    contentType: r.contentType,
    bytes: r.bytes,
    ...(r.error ? { error: r.error } : {}),
  };
}
