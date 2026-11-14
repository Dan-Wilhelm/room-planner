import "server-only";
import { isIP } from "node:net";

/**
 * SSRF protection: true if the address must not be contacted from the server
 * (private, loopback, link-local, CGNAT, multicast, reserved, documentation,
 * IPv6 ULA/link-local, and IPv6 forms that embed such an IPv4 address).
 * Anything that is not a valid IP literal is treated as blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  if (typeof ip !== "string") return true;
  let addr = ip.trim();
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone); // fe80::1%en0 → zone ids only exist on link-local
  const kind = isIP(addr);
  if (kind === 4) return isBlockedV4(parseV4(addr)!);
  if (kind === 6) {
    const words = parseV6(addr);
    return words ? isBlockedV6(words) : true;
  }
  return true;
}

function parseV4(addr: string): number[] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  const out = parts.map((p) => Number(p));
  return out.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? out : null;
}

function inV4(o: number[], base: [number, number, number, number], bits: number): boolean {
  const ip = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const net = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (net & mask);
}

const V4_BLOCKED: [[number, number, number, number], number][] = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local (incl. cloud metadata 169.254.169.254)
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 88, 99, 0], 24], // 6to4 relay anycast (deprecated)
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved + broadcast 255.255.255.255
];

function isBlockedV4(o: number[]): boolean {
  return V4_BLOCKED.some(([base, bits]) => inV4(o, base, bits));
}

/** Parses an IPv6 literal into 8 16-bit words (supports "::" and a trailing dotted IPv4). */
function parseV6(addr: string): number[] | null {
  let s = addr.toLowerCase();
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const o = parseV4(maybeV4);
    if (!o) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder words, replaced below
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toWords = (part: string) => (part === "" ? [] : part.split(":").map((h) => parseInt(h, 16)));
  const head = toWords(halves[0]);
  const rest = halves.length === 2 ? toWords(halves[1]) : [];
  if ([...head, ...rest].some((w) => !Number.isFinite(w) || w < 0 || w > 0xffff)) return null;
  let words: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    words = [...head, ...new Array(fill).fill(0), ...rest];
  } else {
    words = head;
  }
  if (words.length !== 8) return null;
  if (tail.length) {
    words[6] = tail[0];
    words[7] = tail[1];
  }
  return words;
}

function embeddedV4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isBlockedV6(w: number[]): boolean {
  const allZero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);

  // :: (unspecified) and ::1 (loopback)
  if (allZero(0, 7) && (w[7] === 0 || w[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d → judge the IPv4 address
  if (allZero(0, 5) && w[5] === 0xffff) return isBlockedV4(embeddedV4(w[6], w[7]));
  // IPv4-translated ::ffff:0:a.b.c.d (RFC 2765)
  if (allZero(0, 4) && w[4] === 0xffff && w[5] === 0) return isBlockedV4(embeddedV4(w[6], w[7]));
  // Deprecated IPv4-compatible ::a.b.c.d
  if (allZero(0, 6)) return isBlockedV4(embeddedV4(w[6], w[7]));
  // NAT64 well-known prefix 64:ff9b::/96 → judge the embedded IPv4
  if (w[0] === 0x64 && w[1] === 0xff9b && allZero(2, 6)) return isBlockedV4(embeddedV4(w[6], w[7]));
  // NAT64 local-use 64:ff9b:1::/48
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) return true;
  // 6to4 2002::/16 → embedded IPv4 in words 1–2
  if (w[0] === 0x2002) return isBlockedV4(embeddedV4(w[1], w[2]));
  // Teredo 2001:0::/32 (tunnels to arbitrary IPv4) and documentation 2001:db8::/32
  if (w[0] === 0x2001 && (w[1] === 0 || w[1] === 0xdb8)) return true;
  // Discard-only 100::/64
  if (w[0] === 0x100 && allZero(1, 4)) return true;
  // ULA fc00::/7
  if ((w[0] & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10 and deprecated site-local fec0::/10
  if ((w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0) return true;
  // Multicast ff00::/8
  if ((w[0] & 0xff00) === 0xff00) return true;
  return false;
}
