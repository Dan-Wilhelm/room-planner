import "server-only";

/**
 * Tolerant OpenGraph / meta parsing with regexes (no DOM). All returned text is
 * untrusted third-party DATA — callers must never treat it as instructions.
 */

export interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
  video?: string;
  siteName?: string;
  /** og:type, e.g. "website", "product", "video.other". */
  type?: string;
  images: string[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  agrave: "à",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  times: "×",
  deg: "°",
  shy: "",
};

/** Decodes HTML entities (named subset + all numeric forms). */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (match, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      return code === 0 ? "�" : String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[ent] ?? NAMED_ENTITIES[ent.toLowerCase()];
    // Only decode known names; require ";" for names to avoid mangling URLs like "?a=1&copy=2".
    return named !== undefined && match.endsWith(";") ? named : match;
  });
}

/** Parses the attributes of a single tag string like `<meta property="og:title" content="x">`. */
export function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const inner = tag.replace(/^<\s*[\w:-]+/, "").replace(/\/?>$/, "");
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeHtmlEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function clean(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t || undefined;
}

function resolveUrl(raw: string | undefined, baseUrl: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v || v.startsWith("data:")) return undefined;
  try {
    const u = new URL(v, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/** Collects meta tags as (key, value) pairs; key = property | name | itemprop (lower-cased). */
export function collectMeta(html: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = parseAttributes(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").trim().toLowerCase();
    const value = a.content ?? a.value;
    if (key && value !== undefined) out.push([key, value]);
  }
  return out;
}

export function extractTitleTag(html: string): string | undefined {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? clean(decodeHtmlEntities(m[1].replace(/<[^>]*>/g, ""))) : undefined;
}

export function parseOpenGraph(html: string, baseUrl: string): OpenGraphData {
  const meta = collectMeta(html ?? "");
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const hit = meta.find(([mk]) => mk === k);
      if (hit && clean(hit[1])) return hit[1];
    }
    return undefined;
  };

  const images: string[] = [];
  const pushImage = (raw: string | undefined) => {
    const u = resolveUrl(raw, baseUrl);
    if (u && !images.includes(u)) images.push(u);
  };
  for (const [k, v] of meta) {
    if (k === "og:image" || k === "og:image:url" || k === "og:image:secure_url") pushImage(v);
  }
  for (const [k, v] of meta) {
    if (k === "twitter:image" || k === "twitter:image:src") pushImage(v);
  }
  // <link rel="image_src" href="…"> (older convention)
  const linkRe = /<link\b[^>]*>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html ?? ""))) {
    const a = parseAttributes(lm[0]);
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("image_src")) pushImage(a.href);
  }

  const video = resolveUrl(first("og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream"), baseUrl);

  return {
    title: clean(first("og:title", "twitter:title")) ?? extractTitleTag(html ?? ""),
    description: clean(first("og:description", "twitter:description", "description")),
    image: images[0],
    video,
    siteName: clean(first("og:site_name", "application-name")),
    type: clean(first("og:type"))?.toLowerCase(),
    images,
  };
}
