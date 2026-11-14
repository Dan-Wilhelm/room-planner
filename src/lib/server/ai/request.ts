import "server-only";
import type { z } from "zod";
import { requireAuth } from "@/lib/server/auth";

export const MAX_BODY_BYTES = 4_400_000; // Vercel Functions accept ~4.5 MB
export const MAX_IMAGES = 12;

/** Auth + size limit + zod validation. Returns either the parsed body or an error Response. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<{ body: z.infer<S> } | { error: Response }> {
  const denied = requireAuth(req);
  if (denied) return { error: denied };
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return { error: Response.json({ error: "Request too large (max 4 MB). Use fewer or smaller images." }, { status: 413 }) };
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { error: Response.json({ error: "Could not read the request." }, { status: 400 }) };
  }
  if (raw.length > MAX_BODY_BYTES) return { error: Response.json({ error: "Request too large (max 4 MB)." }, { status: 413 }) };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: Response.json({ error: "Invalid JSON." }, { status: 400 }) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { error: Response.json({ error: "Invalid request.", details: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 }) };
  }
  return { body: parsed.data };
}
