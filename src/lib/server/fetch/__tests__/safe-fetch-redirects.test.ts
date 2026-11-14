import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Fake DNS: *.good.test → 127.0.0.1 (treated as public by the mocked ip check),
// evil.test → 127.0.0.2 (blocked).
vi.mock("node:dns", () => {
  const lookup = async (host: string) => {
    if (host === "evil.test") return [{ address: "127.0.0.2", family: 4 }];
    if (host.endsWith("good.test")) return [{ address: "127.0.0.1", family: 4 }];
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  };
  return { default: { promises: { lookup } }, promises: { lookup } };
});
vi.mock("../ip", () => ({ isBlockedAddress: (ip: string) => ip !== "127.0.0.1" }));

import { safeFetch, safeFetchBinary } from "../safe-fetch";

let server: http.Server;
let port = 0;
const seen: { url: string; headers: http.IncomingHttpHeaders }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    const u = req.url ?? "/";
    if (u === "/redirect-good") {
      res.writeHead(302, { location: `http://www.good.test:${port}/final`, "set-cookie": "a=1" });
      res.end();
    } else if (u === "/redirect-relative") {
      res.writeHead(301, { location: "/final" });
      res.end();
    } else if (u === "/redirect-evil") {
      res.writeHead(302, { location: `http://evil.test:${port}/secret` });
      res.end();
    } else if (u === "/redirect-file") {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    } else if (u === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
    } else if (u === "/final") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<title>Größe</title>");
    } else if (u === "/latin1") {
      res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
      res.end(Buffer.from("<title>Gr\xf6\xdfe</title>", "latin1"));
    } else if (u === "/gzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(zlib.gzipSync("<p>compressed</p>"));
    } else if (u === "/big") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(50_000));
    } else if (u === "/img") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.alloc(2000, 1));
    } else if (u === "/slow") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("late");
      }, 2000);
    } else {
      res.writeHead(404);
      res.end("nope");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const base = () => `http://good.test:${port}`;

describe("safeFetch against a local test server", () => {
  it("follows redirects manually, re-validating hosts, and sends no cookies", async () => {
    const r = await safeFetch(`${base()}/redirect-good`);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe(`http://www.good.test:${port}/final`);
    expect(r.redirects).toEqual([`http://www.good.test:${port}/final`]);
    expect(r.body).toBe("<title>Größe</title>");
    const last = seen[seen.length - 1];
    expect(last.headers.cookie).toBeUndefined();
    expect(last.headers["user-agent"]).toMatch(/Mozilla\/5\.0/);
    expect(last.headers["accept-language"]).toBe("de-DE,de;q=0.9,en;q=0.8");
  });

  it("resolves relative redirects", async () => {
    const r = await safeFetch(`${base()}/redirect-relative`);
    expect(r.finalUrl).toBe(`${base()}/final`);
  });

  it("refuses a redirect to a blocked host", async () => {
    const r = await safeFetch(`${base()}/redirect-evil`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("blocked");
    expect(seen.some((s) => s.url === "/secret")).toBe(false);
  });

  it("refuses a redirect to file://", async () => {
    const r = await safeFetch(`${base()}/redirect-file`);
    expect(r.error).toBe("blocked");
  });

  it("stops after maxRedirects", async () => {
    const r = await safeFetch(`${base()}/loop`, { maxRedirects: 3 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("network");
    expect(r.redirects).toHaveLength(3);
  });

  it("decodes declared charsets and gzip", async () => {
    expect((await safeFetch(`${base()}/latin1`)).body).toBe("<title>Größe</title>");
    expect((await safeFetch(`${base()}/gzip`)).body).toBe("<p>compressed</p>");
  });

  it("truncates text at maxBytes", async () => {
    const r = await safeFetch(`${base()}/big`, { maxBytes: 1000 });
    expect(r.ok).toBe(true);
    expect(r.body).toHaveLength(1000);
    expect(r.truncated).toBe(true);
  });

  it("returns 404 status without error", async () => {
    const r = await safeFetch(`${base()}/missing`);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toBeUndefined();
  });

  it("times out", async () => {
    const r = await safeFetch(`${base()}/slow`, { timeoutMs: 300 });
    expect(r.error).toBe("timeout");
  });

  it("safeFetchBinary: returns bytes, and too-large when over maxBytes", async () => {
    const ok = await safeFetchBinary(`${base()}/img`, { maxBytes: 5000 });
    expect(ok.ok).toBe(true);
    expect(ok.contentType).toBe("image/jpeg");
    expect(ok.bytes?.byteLength).toBe(2000);
    const big = await safeFetchBinary(`${base()}/img`, { maxBytes: 1000 });
    expect(big.error).toBe("too-large");
    expect(big.bytes).toBeNull();
  });
});
