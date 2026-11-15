import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only helpers for the account database (Supabase) and the signed-in session.
 *
 * Secrets live in environment variables and never reach the browser:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SESSION_SECRET or SUPABASE_JWT_SECRET
 * The database tables have row level security switched on with no public policies, so the
 * only way in is through these API routes, which check a wallet signature first.
 */

const COOKIE = "sd_session";
const SESSION_HOURS = 24 * 7;

/**
 * Secret that signs the sign-in cookie. SESSION_SECRET if set, otherwise the database's own
 * JWT secret, which Vercel's Supabase integration provides automatically.
 */
function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.SUPABASE_JWT_SECRET || "";
}

export function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && sessionSecret());
}

let client: SupabaseClient | undefined;
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

function mac(payload: string) {
  return createHmac("sha256", `stackday-session:${sessionSecret()}`).update(payload).digest("hex");
}

export function sessionCookie(address: string) {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `${address.toLowerCase()}.${expires}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${payload}.${mac(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The signed-in wallet (lowercase) for this request, or null. */
export function sessionWallet(request: Request): string | null {
  if (!sessionSecret()) return null;
  const header = request.headers.get("cookie") ?? "";
  const raw = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [address, expires, signature] = raw.slice(COOKIE.length + 1).split(".");
  if (!address || !expires || !signature) return null;
  const expected = mac(`${address}.${expires}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expires) < Date.now()) return null;
  return address;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export const notConfigured = () =>
  json({ configured: false, error: "The account database is not connected yet." }, 503);

export const needSignIn = () => json({ error: "Sign in with your wallet first." }, 401);

export const isWallet = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);

/** Today's date in UTC as YYYY-MM-DD. */
export const today = () => new Date().toISOString().slice(0, 10);
