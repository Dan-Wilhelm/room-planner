import "server-only";

export type Platform = "instagram" | "pinterest" | "tiktok" | "web";

function hostOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function isHostOrSub(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectPlatform(url: string): Platform {
  const host = hostOf(url);
  if (!host) return "web";
  if (isHostOrSub(host, "instagram.com") || isHostOrSub(host, "instagr.am")) return "instagram";
  if (isHostOrSub(host, "pin.it")) return "pinterest";
  // pinterest.com, pinterest.de, de.pinterest.com, pinterest.co.uk, …
  const labels = host.split(".");
  const idx = labels.indexOf("pinterest");
  if (idx !== -1 && idx < labels.length - 1) return "pinterest";
  if (isHostOrSub(host, "tiktok.com")) return "tiktok"; // includes vm.tiktok.com, www.tiktok.com
  return "web";
}

export interface InstagramUrlInfo {
  shortcode?: string;
  username?: string;
  kind?: "p" | "reel" | "tv";
}

/** Path segments that are Instagram routes, not usernames. */
const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "explore",
  "accounts",
  "stories",
  "direct",
  "about",
  "developer",
  "legal",
  "web",
  "emails",
  "challenge",
  "s",
  "ar",
]);

const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,64}$/;
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

function kindOf(segment: string | undefined): InstagramUrlInfo["kind"] | undefined {
  if (segment === "p") return "p";
  if (segment === "reel" || segment === "reels") return "reel";
  if (segment === "tv") return "tv";
  return undefined;
}

/**
 * Parses instagram.com/p/CODE/, /reel/CODE/, /reels/CODE/, /tv/CODE/,
 * /USERNAME/p/CODE/, /USERNAME/reel/CODE/, /stories/USERNAME/…, /USERNAME/.
 */
export function parseInstagramUrl(url: string): InstagramUrlInfo {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return {};
  }
  if (detectPlatform(u.href) !== "instagram") return {};
  const segs = u.pathname.split("/").filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  if (!segs.length) return {};

  const k0 = kindOf(segs[0]);
  if (k0 && segs[1] && SHORTCODE_RE.test(segs[1])) return { shortcode: segs[1], kind: k0 };

  if (segs[0] === "stories" && segs[1] && USERNAME_RE.test(segs[1])) return { username: segs[1] };

  if (!IG_RESERVED.has(segs[0].toLowerCase()) && USERNAME_RE.test(segs[0])) {
    const username = segs[0];
    const k1 = kindOf(segs[1]);
    if (k1 && segs[2] && SHORTCODE_RE.test(segs[2])) return { username, shortcode: segs[2], kind: k1 };
    return { username };
  }
  return {};
}
