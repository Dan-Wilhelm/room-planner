import { requireAuth } from "@/lib/server/auth";
import { MAX_PROXY_BYTES, parseFetchableUrl, safeFetchBinary } from "@/lib/server/fetch";

export const maxDuration = 60;

/**
 * Proxies remote images/videos (link previews, product thumbnails) so the browser
 * can draw them onto a canvas without CORS problems. SSRF-safe via safeFetchBinary.
 *
 * Note: the whole file (≤ 30 MB) is fetched per request. For videos, clients should
 * `fetch()` the proxied URL once into a Blob and use an object URL, instead of
 * pointing a <video> element at it (which would issue many Range requests).
 */

function isAllowedType(contentType: string): boolean {
  const t = contentType.split(";")[0].trim().toLowerCase();
  if (t === "image/svg+xml") return false; // SVG can carry script — never serve it same-origin
  return /^(image|video)\/[a-z0-9.+-]+$/.test(t);
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const u = new URL(req.url).searchParams.get("u");
  if (!u || !parseFetchableUrl(u)) {
    return Response.json({ error: "Missing or invalid url." }, { status: 400 });
  }

  const r = await safeFetchBinary(u, { maxBytes: MAX_PROXY_BYTES, timeoutMs: 30000 });
  if (r.error === "invalid-url" || r.error === "blocked") {
    return Response.json({ error: "This address can't be loaded." }, { status: 400 });
  }
  if (r.error === "too-large") return Response.json({ error: "The file is too large." }, { status: 413 });
  if (r.error === "timeout") return Response.json({ error: "The remote server did not answer in time." }, { status: 504 });
  if (r.error || !r.ok || !r.bytes) {
    return Response.json({ error: `The file could not be loaded (HTTP ${r.status || "–"}).` }, { status: 502 });
  }
  if (!isAllowedType(r.contentType)) {
    return Response.json({ error: "Only images and videos can be loaded." }, { status: 415 });
  }

  const contentType = r.contentType.split(";")[0].trim().toLowerCase();
  const bytes = r.bytes;
  const baseHeaders: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "private, max-age=600",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "accept-ranges": "bytes",
  };

  const range = parseRange(req.headers.get("range"), bytes.byteLength);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "content-range": `bytes */${bytes.byteLength}` } });
  }
  if (range) {
    const slice = bytes.subarray(range.start, range.end + 1);
    return new Response(new Blob([slice as Uint8Array<ArrayBuffer>]), {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-length": String(slice.byteLength),
        "content-range": `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
      },
    });
  }
  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(bytes.byteLength) },
  });
}
