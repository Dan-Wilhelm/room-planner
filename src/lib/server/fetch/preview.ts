import "server-only";
import type { PreviewStatus } from "@/lib/types";
import { decodeHtmlEntities, parseOpenGraph, type OpenGraphData } from "./opengraph";
import { detectPlatform, parseInstagramUrl, type Platform } from "./platform";
import { parseFetchableUrl, safeFetch } from "./safe-fetch";

/**
 * Link previews for inspiration links (Instagram, Pinterest, TikTok, any web page).
 *
 * Everything returned (title, caption, author, notes derived from remote data) is
 * untrusted third-party DATA. It is passed through as text and must never be
 * interpreted as instructions by callers (e.g. when it is shown to an AI model).
 *
 * No login, no scraping services, no video downloads from Instagram/Pinterest/TikTok
 * beyond the media_url that Instagram's own Business Discovery API returns.
 * Secrets (tokens) are read from process.env and never logged or returned.
 */

export interface LinkPreview {
  platform: Platform;
  status: PreviewStatus;
  title?: string;
  caption?: string;
  author?: string;
  imageUrls: string[];
  videoUrl?: string;
  notes: string[];
}

export interface InstagramBoosterStatus {
  oembed: boolean;
  businessDiscovery: boolean;
  expiresAt?: string;
  expiresSoon: boolean;
}

const GRAPH = "https://graph.facebook.com/v25.0";
const MAX_IMAGES = 20;
const MAX_CAPTION = 5000;
const IG_USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

// ---------------------------------------------------------------------------
// Booster status
// ---------------------------------------------------------------------------

export function instagramBoosterStatus(now = Date.now()): InstagramBoosterStatus {
  const oembed = !!process.env.META_OEMBED_TOKEN;
  const businessDiscovery = !!(process.env.META_IG_USER_TOKEN && process.env.META_IG_USER_ID);
  const rawExp = process.env.META_IG_USER_TOKEN_EXPIRES;
  let expiresAt: string | undefined;
  let expiresSoon = false;
  if (rawExp) {
    const t = Date.parse(rawExp);
    if (Number.isFinite(t)) {
      expiresAt = new Date(t).toISOString();
      expiresSoon = t - now <= 7 * 24 * 60 * 60 * 1000; // includes already expired
    }
  }
  return { oembed, businessDiscovery, ...(expiresAt ? { expiresAt } : {}), expiresSoon };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clip(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Strips tags (keeping line breaks) and decodes entities. */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const IG_BOILERPLATE =
  /^(view this post on instagram|diesen beitrag auf instagram ansehen|a post shared by|ein beitrag geteilt von|beitrag geteilt von)/i;

/** Extracts the caption text from Instagram's oEmbed `html` blockquote. */
export function captionFromOEmbedHtml(html: string): { caption?: string; sharedBy?: string } {
  const block = /<blockquote\b[\s\S]*?<\/blockquote>/i.exec(html)?.[0] ?? html;
  const paragraphs: string[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  let sharedBy: string | undefined;
  while ((m = re.exec(block))) {
    const text = htmlToText(m[1]);
    if (!text) continue;
    const by = /(?:a post shared by|ein beitrag geteilt von)[^@]*@([A-Za-z0-9._]{1,30})/i.exec(text);
    if (by) sharedBy = by[1];
    if (IG_BOILERPLATE.test(text)) continue;
    paragraphs.push(text);
  }
  const caption = paragraphs.join("\n").trim();
  return { caption: caption || undefined, sharedBy };
}

/** Instagram og:description often looks like `12 likes, 3 comments - user on March 1, 2025: "caption"`. */
function parseInstagramDescription(desc: string | undefined): { author?: string; caption?: string } {
  if (!desc) return {};
  const m = /-\s*([A-Za-z0-9._]{1,30})\s+(?:on|am)\s+[^:]{3,40}:\s*["“]?([\s\S]*?)["”]?\s*\.?$/i.exec(desc);
  if (m) return { author: m[1], caption: m[2] };
  return { caption: desc };
}

function filterImages(platform: Platform, images: string[]): string[] {
  return images.filter((u) => {
    let h: URL;
    try {
      h = new URL(u);
    } catch {
      return false;
    }
    const host = h.hostname.toLowerCase();
    if (platform === "instagram") {
      // Static logos on the login page, not post content.
      if (host === "static.cdninstagram.com" || h.pathname.includes("/rsrc.php/")) return false;
    }
    if (platform === "pinterest" && host === "s.pinimg.com") return false;
    if (platform === "tiktok" && /\/(logo|favicon)/i.test(h.pathname)) return false;
    return true;
  });
}

interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

function sanitize(text: string): string {
  let t = text;
  for (const key of ["META_OEMBED_TOKEN", "META_IG_USER_TOKEN"] as const) {
    const v = process.env[key];
    if (v) t = t.split(v).join("[token]");
  }
  return t.replace(/access_token=[^&\s]+/gi, "access_token=[token]").slice(0, 160);
}

function graphErrorNote(label: string, err: GraphError | undefined, httpStatus: number, username?: string): string {
  const code = err?.code;
  if (code === 190) return `${label}: the access token has expired or is invalid — please renew it.`;
  if (code === 10 || code === 200 || code === 3 || (code !== undefined && code >= 200 && code < 300)) {
    return `${label}: the app is missing a required permission.`;
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) return `${label}: rate limit reached, please try again later.`;
  if (code === 110 || (code === 100 && username)) {
    return `${label}: Instagram couldn't look up @${username ?? "?"} (only public Business/Creator accounts are visible).`;
  }
  const msg = err?.message ? ` (${sanitize(err.message)})` : "";
  return `${label} failed${code !== undefined ? ` (code ${code})` : ` (HTTP ${httpStatus || "–"})`}${msg}.`;
}

async function graphGet(url: string): Promise<{ json: Record<string, unknown> | null; status: number; error?: string }> {
  const r = await safeFetch(url, { timeoutMs: 10000, maxBytes: 3_000_000, accept: "application/json" });
  if (r.error && !r.body) return { json: null, status: r.status, error: r.error };
  try {
    return { json: JSON.parse(r.body) as Record<string, unknown>, status: r.status };
  } catch {
    return { json: null, status: r.status, error: r.truncated ? "too-large" : "invalid-json" };
  }
}

// ---------------------------------------------------------------------------
// Instagram booster
// ---------------------------------------------------------------------------

interface BoosterResult {
  author?: string;
  caption?: string;
  imageUrls: string[];
  videoUrl?: string;
}

async function instagramOEmbed(url: string, token: string, notes: string[]): Promise<BoosterResult> {
  const api = `${GRAPH}/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(token)}&omitscript=true`;
  const { json, status, error } = await graphGet(api);
  if (!json) {
    notes.push(`Instagram oEmbed could not be loaded (${error ?? `HTTP ${status}`}).`);
    return { imageUrls: [] };
  }
  if (json.error) {
    notes.push(graphErrorNote("Instagram oEmbed", json.error as GraphError, status));
    return { imageUrls: [] };
  }
  const out: BoosterResult = { imageUrls: [] };
  const html = typeof json.html === "string" ? json.html : "";
  const { caption, sharedBy } = captionFromOEmbedHtml(html);
  const authorName = typeof json.author_name === "string" ? json.author_name : undefined;
  out.author = authorName || sharedBy;
  out.caption = caption;
  if (typeof json.thumbnail_url === "string" && parseFetchableUrl(json.thumbnail_url)) {
    out.imageUrls.push(json.thumbnail_url);
  }
  return out;
}

interface IgMedia {
  id?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  children?: { data?: { media_type?: string; media_url?: string }[] };
}

async function instagramBusinessDiscovery(
  shortcode: string,
  username: string,
  userId: string,
  token: string,
  notes: string[],
): Promise<BoosterResult> {
  const out: BoosterResult = { imageUrls: [] };
  if (!IG_USERNAME_RE.test(username) || !/^\d+$/.test(userId)) {
    notes.push("Instagram Business Discovery skipped (invalid username or account id).");
    return out;
  }
  const mediaFields = "{id,caption,media_type,media_url,permalink,children{media_type,media_url}}";
  let after: string | undefined;
  for (let page = 0; page < 3; page++) {
    const media = `media${after ? `.after(${after})` : ""}.limit(50)${mediaFields}`;
    const fields = `business_discovery.username(${username}){${media}}`;
    const api = `${GRAPH}/${userId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
    const { json, status, error } = await graphGet(api);
    if (!json) {
      notes.push(`Instagram Business Discovery could not be loaded (${error ?? `HTTP ${status}`}).`);
      return out;
    }
    if (json.error) {
      notes.push(graphErrorNote("Instagram Business Discovery", json.error as GraphError, status, username));
      return out;
    }
    const bd = json.business_discovery as
      | { media?: { data?: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } } }
      | undefined;
    const items = bd?.media?.data ?? [];
    const hit = items.find((m) => {
      const p = m.permalink ?? "";
      return p.includes(`/${shortcode}/`) || p.endsWith(`/${shortcode}`);
    });
    if (hit) {
      out.caption = hit.caption;
      out.author = username;
      const push = (type: string | undefined, mediaUrl: string | undefined) => {
        if (!mediaUrl || !parseFetchableUrl(mediaUrl)) return false;
        if ((type ?? "").toUpperCase() === "VIDEO") {
          if (!out.videoUrl) out.videoUrl = mediaUrl;
        } else if (!out.imageUrls.includes(mediaUrl)) {
          out.imageUrls.push(mediaUrl);
        }
        return true;
      };
      let missing = 0;
      if ((hit.media_type ?? "").toUpperCase() === "CAROUSEL_ALBUM") {
        for (const c of hit.children?.data ?? []) if (!push(c.media_type, c.media_url)) missing++;
        if (!hit.children?.data?.length && !push("IMAGE", hit.media_url)) missing++;
      } else if (!push(hit.media_type, hit.media_url)) {
        missing++;
      }
      if (missing) {
        notes.push(
          "Instagram did not provide the media file for this post (e.g. licensed music or downloads disabled) — falling back to the link preview.",
        );
      }
      return out;
    }
    const next = bd?.media?.paging?.cursors?.after;
    if (!next || !bd?.media?.paging?.next || !/^[A-Za-z0-9_=-]+$/.test(next)) break;
    after = next;
  }
  notes.push(`Instagram Business Discovery: post not found among @${username}'s latest posts.`);
  return out;
}

// ---------------------------------------------------------------------------
// TikTok (official public oEmbed, no auth) — only used when the page has no preview
// ---------------------------------------------------------------------------

async function tiktokOEmbed(url: string): Promise<{ title?: string; author?: string; image?: string } | null> {
  const { json } = await graphGet(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  if (!json || json.error || json.status_msg) return null;
  const image = typeof json.thumbnail_url === "string" && parseFetchableUrl(json.thumbnail_url) ? json.thumbnail_url : undefined;
  return {
    title: typeof json.title === "string" ? json.title : undefined,
    author: typeof json.author_name === "string" ? json.author_name : undefined,
    image,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function fetchErrorNote(error: string | undefined, status: number): string {
  switch (error) {
    case "blocked":
      return "The link points to a blocked (private/internal) address.";
    case "timeout":
      return "The page did not answer in time.";
    case "invalid-url":
      return "That is not a valid http(s) link.";
    case "network":
      return status ? `The page could not be loaded (redirect problem, HTTP ${status}).` : "The page could not be reached.";
    default:
      return `The page could not be loaded (HTTP ${status}).`;
  }
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const notes: string[] = [];
  const parsed = parseFetchableUrl(url);
  const platform = detectPlatform(url);
  if (!parsed) {
    return { platform, status: "failed → upload needed", imageUrls: [], notes: ["That is not a valid http(s) link."] };
  }
  const href = parsed.href;
  const ig = platform === "instagram" ? parseInstagramUrl(href) : {};

  // 1) The page itself (OpenGraph).
  let og: OpenGraphData = { images: [] };
  const page = await safeFetch(href, { timeoutMs: 8000, maxBytes: 1_500_000 });
  if (page.status >= 200 && page.status < 300 && page.body) {
    const loginWall =
      platform === "instagram" && /\/accounts\/login|\/challenge\//.test(page.finalUrl);
    if (loginWall) {
      notes.push("Instagram showed a login page instead of the post.");
    } else {
      og = parseOpenGraph(page.body, page.finalUrl);
      og.images = filterImages(platform, og.images);
      if (platform !== "web" && !og.images.length) {
        // Generic app shell / login wall ("Instagram", "TikTok - Make Your Day"): its text says nothing about the post.
        og = { images: [] };
        notes.push("The platform did not expose a preview for this link (login wall or app-only page).");
      }
    }
  } else {
    notes.push(fetchErrorNote(page.error, page.status));
  }

  let title = og.title;
  let caption = og.description;
  let author: string | undefined;
  let imageUrls = [...og.images];
  // og:video is only used for ordinary web pages — never download videos from social platforms.
  let videoUrl = platform === "web" ? og.video : undefined;

  if (platform === "instagram") {
    const parsedDesc = parseInstagramDescription(og.description);
    author = parsedDesc.author ?? ig.username;
    caption = parsedDesc.caption;
  }

  // 2) Instagram booster (optional, env-configured).
  if (platform === "instagram") {
    const oembedToken = process.env.META_OEMBED_TOKEN;
    const userToken = process.env.META_IG_USER_TOKEN;
    const userId = process.env.META_IG_USER_ID;
    let boosterAuthor: string | undefined;
    if (oembedToken) {
      try {
        const o = await instagramOEmbed(href, oembedToken, notes);
        if (o.author) boosterAuthor = author = o.author;
        if (o.caption) caption = o.caption;
        if (!imageUrls.length && o.imageUrls.length) imageUrls = o.imageUrls;
      } catch {
        notes.push("Instagram oEmbed failed unexpectedly.");
      }
    }
    if (userToken && userId) {
      const username = ig.username ?? boosterAuthor ?? author;
      if (!ig.shortcode) {
        notes.push("Instagram Business Discovery needs a post link (…/p/CODE/ or …/reel/CODE/).");
      } else if (!username) {
        notes.push("Instagram Business Discovery skipped: the account name is unknown (paste the link with the username, or set up oEmbed).");
      } else {
        try {
          const bd = await instagramBusinessDiscovery(ig.shortcode, username, userId, userToken, notes);
          if (bd.imageUrls.length) imageUrls = bd.imageUrls;
          if (bd.videoUrl) videoUrl = bd.videoUrl;
          if (bd.caption) caption = bd.caption;
          if (bd.author) author = bd.author;
        } catch {
          notes.push("Instagram Business Discovery failed unexpectedly.");
        }
      }
    }
  }

  // 3) TikTok fallback via TikTok's own public oEmbed (thumbnail only).
  if (platform === "tiktok" && !imageUrls.length) {
    try {
      const t = await tiktokOEmbed(href);
      if (t) {
        title = title ?? t.title;
        author = author ?? t.author;
        if (t.image) imageUrls.push(t.image);
      }
    } catch {
      // ignore — handled by the status below
    }
  }

  imageUrls = Array.from(new Set(imageUrls)).slice(0, MAX_IMAGES);

  const isVideoPost =
    !!og.type?.startsWith("video") ||
    !!og.video ||
    ig.kind === "reel" ||
    ig.kind === "tv" ||
    platform === "tiktok";

  let status: PreviewStatus;
  if (!imageUrls.length && !videoUrl) {
    status = "failed → upload needed";
    notes.push("No usable preview — please upload screenshots or the video.");
  } else if (isVideoPost && !videoUrl && imageUrls.length <= 1) {
    status = "cover image only";
    notes.push("Only the cover image is available — upload screenshots of the scenes you mean for better results.");
  } else {
    status = "link preview ok";
  }

  return {
    platform,
    status,
    ...(clip(title, 300) ? { title: clip(title, 300) } : {}),
    ...(clip(caption, MAX_CAPTION) ? { caption: clip(caption, MAX_CAPTION) } : {}),
    ...(clip(author, 100) ? { author: clip(author, 100) } : {}),
    imageUrls,
    ...(videoUrl ? { videoUrl } : {}),
    notes,
  };
}
