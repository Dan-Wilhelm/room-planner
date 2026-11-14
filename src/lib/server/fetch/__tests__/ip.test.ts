import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isBlockedAddress } from "../ip";

describe("isBlockedAddress — IPv4", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "127.255.0.9",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.0.8",
    "192.0.2.10",
    "198.18.0.1",
    "198.51.100.5",
    "203.0.113.7",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.169.0.1", "151.101.1.69"])(
    "allows %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe("isBlockedAddress — IPv6", () => {
  it.each([
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "[::1]",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fe80::1%en0",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "ff00::",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1", // hex form of 127.0.0.1
    "::ffff:169.254.169.254",
    "::ffff:0:192.168.0.1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::10.0.0.1",
    "64:ff9b:1::1",
    "2002:7f00:1::",
    "2002:c0a8:0101::1",
    "2001:db8::1",
    "2001:0:4136:e378::1",
    "100::1",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "2a00:1450:4001:82a::200e",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "64:ff9b::8.8.8.8",
    "2002:0808:0808::1",
  ])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("isBlockedAddress — not an IP", () => {
  it.each(["", "localhost", "example.com", "1.2.3", "256.1.1.1", "::g", "1.2.3.4.5"])("treats %j as blocked", (v) => {
    expect(isBlockedAddress(v)).toBe(true);
  });
});
