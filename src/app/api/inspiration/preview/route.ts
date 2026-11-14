import { z } from "zod";
import { requireAuth } from "@/lib/server/auth";
import { fetchLinkPreview, instagramBoosterStatus, parseFetchableUrl } from "@/lib/server/fetch";

export const maxDuration = 60;

const BodySchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Please paste a link.")
    .max(2048, "That link is too long.")
    .refine((u) => parseFetchableUrl(u) !== null, "Please paste a valid http(s) link."),
});

function proxied(u: string): string {
  return `/api/media-proxy?u=${encodeURIComponent(u)}`;
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const p = await fetchLinkPreview(parsed.data.url);
    // Title/caption/author are untrusted third-party text: returned as plain data only.
    return Response.json(
      {
        platform: p.platform,
        status: p.status,
        title: p.title,
        caption: p.caption,
        author: p.author,
        notes: p.notes,
        images: p.imageUrls.map(proxied),
        ...(p.videoUrl ? { video: proxied(p.videoUrl) } : {}),
        booster: instagramBoosterStatus(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "The link preview failed. Please upload screenshots instead." }, { status: 502 });
  }
}
