import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "rp_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters.");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Constant-time string comparison (hashes both sides so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(input, expected);
}

/** Token format: <expiresAtEpochSeconds>.<hmac> */
export function createSessionToken(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE_S;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const payload = `${parts[0]}.${parts[1]}`;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  if (!safeEqual(parts[2], expected)) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp * 1000 > now;
}

/** Reads the session cookie from a Request (route handlers). */
export function isAuthenticated(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
  return verifySessionToken(token);
}

/** Use at the top of every API route: `const denied = requireAuth(req); if (denied) return denied;` */
export function requireAuth(req: Request): Response | null {
  if (isAuthenticated(req)) return null;
  return Response.json({ error: "Not signed in." }, { status: 401 });
}
