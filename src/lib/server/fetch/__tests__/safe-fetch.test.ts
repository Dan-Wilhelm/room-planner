import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lookup = vi.fn();
vi.mock("node:dns", () => ({
  default: { promises: { lookup: (...args: unknown[]) => lookup(...args) } },
  promises: { lookup: (...args: unknown[]) => lookup(...args) },
}));

import { safeFetch, safeFetchBinary } from "../safe-fetch";

beforeEach(() => {
  lookup.mockReset();
});

describe("safeFetch refuses unsafe targets (no network)", () => {
  it("refuses http://127.0.0.1", async () => {
    const r = await safeFetch("http://127.0.0.1/");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("blocked");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses literal private / metadata / IPv6 loopback addresses", async () => {
    for (const u of ["http://10.0.0.5:8080/x", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://0.0.0.0/"]) {
      const r = await safeFetch(u);
      expect(r.error, u).toBe("blocked");
    }
  });

  it("refuses http://localhost without resolving", async () => {
    const r = await safeFetch("http://localhost:3000/api");
    expect(r.error).toBe("blocked");
  });

  it("refuses a hostname that resolves to a private address", async () => {
    lookup.mockResolvedValue([{ address: "192.168.0.10", family: 4 }]);
    const r = await safeFetch("http://intranet.example.com/");
    expect(r.error).toBe("blocked");
    expect(lookup).toHaveBeenCalledWith("intranet.example.com", expect.objectContaining({ all: true }));
  });

  it("refuses if ANY resolved address is blocked", async () => {
    lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "::1", family: 6 },
    ]);
    const r = await safeFetch("https://mixed.example.com/");
    expect(r.error).toBe("blocked");
  });

  it("maps DNS failure to network", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
    const r = await safeFetch("https://does-not-exist.example/");
    expect(r.error).toBe("network");
    expect(r.ok).toBe(false);
  });

  it.each(["file:///etc/passwd", "ftp://example.com/file", "javascript:alert(1)", "data:text/html,hi", "not a url", "http://user:pw@example.com/"])(
    "refuses %s as invalid-url",
    async (u) => {
      const r = await safeFetch(u);
      expect(r.error).toBe("invalid-url");
      expect(r.status).toBe(0);
      expect(r.body).toBe("");
    },
  );

  it("safeFetchBinary applies the same rules", async () => {
    expect((await safeFetchBinary("http://127.0.0.1/a.jpg")).error).toBe("blocked");
    expect((await safeFetchBinary("file:///a.jpg")).error).toBe("invalid-url");
  });
});
