import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
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

/**
 * Single-use sign-in codes, stored in the `sign_in_nonces` table (see supabase/schema.sql).
 * `take` deletes the row and reports whether it was there and still valid, in one statement,
 * so two requests can never both use the same nonce.
 */
export const dbNonceStore = {
  async put(nonce: string, expiresAt: Date) {
    // Clear out old unused codes first, so the table stays small.
    await db().from("sign_in_nonces").delete().lt("expires_at", new Date().toISOString());
    const { error } = await db().from("sign_in_nonces").insert({ nonce, expires_at: expiresAt.toISOString() });
    if (error) throw new Error("Could not save the sign-in code.");
  },
  async take(nonce: string, now: Date) {
    const { data, error } = await db()
      .from("sign_in_nonces")
      .delete()
      .eq("nonce", nonce)
      .gt("expires_at", now.toISOString())
      .select("nonce");
    if (error) return false;
    return (data ?? []).length === 1;
  },
};

/**
 * The domain(s) sign-in messages must name. SITE_DOMAIN (comma-separated, for example
 * "stackday-rho.vercel.app") if set, otherwise the host this request was sent to.
 * The host comes from the request URL, which the hosting provider routes by: a request that
 * reaches this deployment was sent to this deployment's host.
 */
export function signInDomains(request: Request): string[] {
  const fixed = (process.env.SITE_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  return fixed.length ? fixed : [new URL(request.url).host];
}

const UID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0, 1, I or O: easy to read aloud and type

function newUid() {
  let out = "SD-";
  for (let i = 0; i < 8; i++) out += UID_ALPHABET[randomInt(UID_ALPHABET.length)];
  return out;
}

export type Profile = { wallet: string; uid: string; username: string | null; account_type: "individual" | "business" | null };

/**
 * Returns the wallet's profile, creating it with a fresh unique ID the first time.
 * Called at sign-in, so every signed-in wallet has a profile.
 */
export async function ensureProfile(wallet: string): Promise<Profile> {
  const found = await db().from("profiles").select("wallet, uid, username, account_type").eq("wallet", wallet).maybeSingle();
  if (found.error) throw new Error("profile lookup failed");
  if (found.data?.uid) return found.data as Profile;

  for (let attempt = 0; attempt < 5; attempt++) {
    const uid = newUid();
    const res = found.data
      ? await db().from("profiles").update({ uid }).eq("wallet", wallet).select("wallet, uid, username, account_type").single()
      : await db().from("profiles").insert({ wallet, uid }).select("wallet, uid, username, account_type").single();
    if (!res.error) return res.data as Profile;
    if (res.error.code !== "23505") throw new Error("profile create failed");
    // 23505 is a uniqueness clash: either the ID is taken (try another) or the row was just created by a parallel request.
    const again = await db().from("profiles").select("wallet, uid, username, account_type").eq("wallet", wallet).maybeSingle();
    if (again.data?.uid) return again.data as Profile;
  }
  throw new Error("could not allocate a unique id");
}
