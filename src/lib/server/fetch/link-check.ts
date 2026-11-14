import "server-only";
import { decodeHtmlEntities, extractTitleTag, parseOpenGraph } from "./opengraph";
import { safeFetch, type SafeFetchError } from "./safe-fetch";

export type LinkCheckStatus = "verified" | "could not verify" | "dead";

export interface LinkCheckResult {
  status: LinkCheckStatus;
  finalUrl: string;
  ogImage?: string;
  title?: string;
  reason: string;
}

export interface ClassifyInput {
  status: number;
  originalUrl: string;
  finalUrl: string;
  body: string;
  error?: SafeFetchError;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Visible text of an HTML document (scripts/styles/comments removed, entities decoded, lower-cased). */
export function visibleText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headingText(html: string): string {
  const parts: string[] = [];
  const title = extractTitleTag(html);
  if (title) parts.push(title);
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && parts.length < 5) parts.push(m[1]);
  return visibleText(parts.join(" \n "));
}

/** Phrases that mark a soft-404 / discontinued product anywhere in the visible text. */
const DEAD_PHRASES = [
  "nicht mehr verfügbar",
  "seite nicht gefunden",
  "page not found",
  "artikel ist leider nicht",
  "no longer available",
  "produkt nicht verfügbar",
];
/**
 * Generic phrases that also appear on healthy pages (e.g. "Nicht gefunden, was du suchst?"
 * in a search widget) — only counted when they are in the <title> or an <h1>.
 */
const DEAD_HEADING_PHRASES = ["nicht gefunden", "existiert nicht", "not found", "404"];

const BOT_WALL_MARKUP = [
  "cf_chl_opt", // Cloudflare challenge
  "challenge-platform",
  "cf-browser-verification",
  "/errors/validatecaptcha", // Amazon
  "captcha-delivery.com", // DataDome
  "px-captcha", // PerimeterX
  "_incapsula_resource", // Imperva
  "akamai-bot-manager",
];
const BOT_WALL_TEXT = [
  "captcha",
  "robot check",
  "are you a robot",
  "not a robot",
  "kein roboter",
  "bist du ein mensch",
  "sind sie ein mensch",
  "just a moment...",
  "attention required! | cloudflare",
  "checking your browser",
  "unusual traffic",
  "enter the characters you see below",
  "geben sie die zeichen unten ein",
  "access denied",
  "zugriff verweigert",
];

export function looksLikeBotWall(body: string): boolean {
  if (!body) return false;
  const lower = body.slice(0, 300_000).toLowerCase();
  if (BOT_WALL_MARKUP.some((m) => lower.includes(m))) return true;
  const text = visibleText(body.slice(0, 300_000));
  // Bot walls are short pages; a long product page that merely mentions "captcha" is not one.
  if (text.length > 20_000) return false;
  return BOT_WALL_TEXT.some((p) => text.includes(p));
}

/** JSON-LD / microdata says the product is in stock — a strong "alive" signal. */
function saysInStock(body: string): boolean {
  return /schema\.org\/(InStock|LimitedAvailability|PreOrder|OnlineOnly|InStoreOnly)/i.test(body) ||
    /"availability"\s*:\s*"(https?:\/\/schema\.org\/)?(InStock|LimitedAvailability|PreOrder|OnlineOnly|InStoreOnly)"/i.test(body) ||
    /<meta[^>]+(?:product:availability|og:availability)[^>]+content\s*=\s*["']?(in ?stock|instock|available)/i.test(body);
}

// ---------------------------------------------------------------------------
// URL heuristics
// ---------------------------------------------------------------------------

function safeUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

export function isSearchOrCategoryUrl(u: URL): boolean {
  const p = u.pathname.toLowerCase();
  if (/\/(search|suche|such|category|categories|kategorie|kategorien|cat|c)(\/|$|\.)/.test(p)) return true;
  if (p.includes("/search") || p.includes("/suche") || p.includes("/category") || p.includes("/kategorie")) return true;
  if (p === "/s" || p.startsWith("/s/")) return true; // Amazon /s?k=
  const q = u.searchParams;
  return ["q", "k", "query", "search", "searchterm", "keyword", "keywords"].some((k) => q.has(k));
}

export function isHomepageUrl(u: URL): boolean {
  const p = u.pathname.toLowerCase();
  if (p === "" || p === "/") return true;
  if (/^\/(index\.(html?|php)|home|start|startseite)\/?$/.test(p)) return true;
  // Locale roots such as /de/, /de-de/, /de/de/ (IKEA), /en_gb/
  return /^\/([a-z]{2}([-_][a-z]{2})?\/){1,2}$/.test(p.endsWith("/") ? p : `${p}/`);
}

function sameResource(a: URL, b: URL): boolean {
  const norm = (u: URL) =>
    `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------------------
// Classification (pure; unit-tested)
// ---------------------------------------------------------------------------

export function classifyLinkResponse(input: ClassifyInput): { status: LinkCheckStatus; reason: string } {
  const { status, body = "", error } = input;

  if (error === "invalid-url") return { status: "dead", reason: "Not a valid http(s) link." };
  if (error === "blocked") return { status: "could not verify", reason: "The address points to a blocked (private/internal) host." };
  if (error === "timeout") return { status: "could not verify", reason: "The shop did not answer in time." };
  if (error === "network" && !status) return { status: "could not verify", reason: "The shop could not be reached." };
  if (error === "network") return { status: "could not verify", reason: `Redirect problem (HTTP ${status}).` };

  if (status === 404 || status === 410) return { status: "dead", reason: `The shop says the page does not exist (HTTP ${status}).` };

  if (status === 401 || status === 403 || status === 429) {
    return { status: "could not verify", reason: `The shop blocks automated checks (HTTP ${status}).` };
  }
  if (status >= 500) return { status: "could not verify", reason: `The shop had a server error (HTTP ${status}).` };
  if (status < 200 || status >= 300) return { status: "could not verify", reason: `Unexpected response (HTTP ${status}).` };

  // 2xx from here on.
  if (looksLikeBotWall(body)) {
    return { status: "could not verify", reason: "The shop showed a bot check (captcha) instead of the page." };
  }

  const original = safeUrl(input.originalUrl);
  const final = safeUrl(input.finalUrl);
  if (original && final && !sameResource(original, final)) {
    const originalIsProduct = !isSearchOrCategoryUrl(original) && !isHomepageUrl(original);
    if (originalIsProduct && isSearchOrCategoryUrl(final)) {
      return { status: "dead", reason: "The product link now redirects to a search or category page." };
    }
    if (originalIsProduct && isHomepageUrl(final)) {
      return { status: "dead", reason: "The product link now redirects to the shop's homepage." };
    }
  }

  const inStock = saysInStock(body);
  const headings = headingText(body);
  const headingHit = DEAD_HEADING_PHRASES.find((p) =>
    p === "404" ? /(^|\D)404(\D|$)/.test(headings) : headings.includes(p),
  );
  if (headingHit && !inStock) {
    return { status: "dead", reason: `The page title says "${headingHit}".` };
  }
  const text = visibleText(body);
  const hit = DEAD_PHRASES.find((p) => text.includes(p));
  if (hit && !inStock) {
    return { status: "dead", reason: `The page says "${hit}".` };
  }

  return {
    status: "verified",
    reason: hit ? `Page loaded (HTTP ${status}); it mentions "${hit}" but lists the product as available.` : `Page loaded (HTTP ${status}).`,
  };
}

// ---------------------------------------------------------------------------
// Network check
// ---------------------------------------------------------------------------

/** Checks whether a product link still works. Never throws; "could not verify" is not an error. */
export async function checkProductLink(url: string): Promise<LinkCheckResult> {
  const res = await safeFetch(url, { timeoutMs: 8000, maxBytes: 1_500_000 });
  const { status, reason } = classifyLinkResponse({
    status: res.status,
    originalUrl: url,
    finalUrl: res.finalUrl,
    body: res.body,
    error: res.error,
  });
  const out: LinkCheckResult = { status, finalUrl: res.finalUrl, reason };
  if (res.body && res.status >= 200 && res.status < 300) {
    const og = parseOpenGraph(res.body, res.finalUrl);
    if (og.title) out.title = og.title.slice(0, 300);
    if (status === "verified" && og.image) out.ogImage = og.image;
  }
  return out;
}
