import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server/auth";

// Simple per-instance throttle: failed attempts add an increasing delay.
const failures = new Map<string, { count: number; last: number }>();

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  const key = clientKey(req);
  const f = failures.get(key);
  if (f && Date.now() - f.last > 15 * 60 * 1000) failures.delete(key);

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!checkPassword(password)) {
    const entry = failures.get(key) ?? { count: 0, last: 0 };
    entry.count += 1;
    entry.last = Date.now();
    failures.set(key, entry);
    const delayMs = Math.min(1000 * 2 ** (entry.count - 1), 15000);
    await new Promise((r) => setTimeout(r, delayMs));
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  failures.delete(key);
  const token = createSessionToken();
  const secure = process.env.NODE_ENV === "production";
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_S}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cookie },
  });
}
