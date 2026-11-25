import { createHmac } from "node:crypto";

/**
 * Rate limiting for the API routes (fix 2 in docs/SECURITY-CHECKLIST.md).
 * No framework code in here, so it is unit tested (rate-limit.test.ts). proxy.ts calls `limit`
 * for every /api request with the real store (a counter in the account database).
 *
 * The client address comes ONLY from a header the hosting provider sets itself. Headers a
 * visitor can write (X-Forwarded-For, Forwarded, X-Client-IP, ...) are never trusted, so
 * changing them does not get anyone a fresh allowance.
 */

export type Rule = { name: string; limit: number; windowSeconds: number };

/** Per client address, per window. Strictest on sign-in and on claiming a name. */
const RULES: { method: string; path: string; rule: Rule }[] = [
  { method: "POST", path: "/api/session/nonce", rule: { name: "nonce", limit: 20, windowSeconds: 60 } },
  { method: "POST", path: "/api/session", rule: { name: "sign-in", limit: 10, windowSeconds: 60 } },
  { method: "POST", path: "/api/profile", rule: { name: "name", limit: 5, windowSeconds: 60 } },
  { method: "POST", path: "/api/employees", rule: { name: "team-write", limit: 30, windowSeconds: 60 } },
  { method: "DELETE", path: "/api/employees", rule: { name: "team-write", limit: 30, windowSeconds: 60 } },
  { method: "POST", path: "/api/attendance", rule: { name: "check-in", limit: 10, windowSeconds: 60 } },
  { method: "POST", path: "/api/chat", rule: { name: "chat", limit: 20, windowSeconds: 60 } },
];
const READS: Rule = { name: "read", limit: 120, windowSeconds: 60 };
const OTHER_WRITES: Rule = { name: "write", limit: 30, windowSeconds: 60 };

export function ruleFor(method: string, pathname: string): Rule | null {
  const m = method.toUpperCase();
  if (m === "OPTIONS" || m === "HEAD") return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith("/api/")) return null;
  const hit = RULES.find((r) => r.method === m && r.path === path);
  if (hit) return hit.rule;
  return m === "GET" ? READS : OTHER_WRITES;
}

/**
 * The visitor's address, from the hosting provider's own header. On Vercel that is
 * `x-real-ip`, which Vercel sets on every request and a client cannot override. Anywhere else
 * (your own computer) there is no trusted header, so every request shares one bucket.
 */
export function clientIp(headers: Headers, env: { VERCEL?: string }): string {
  if (env.VERCEL) {
    const ip = headers.get("x-real-ip")?.trim();
    if (ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip)) return ip;
    return "vercel-unknown";
  }
  return "local";
}

/** The address is stored only as a keyed hash, never in the clear. */
export function bucketKey(rule: Rule, ip: string, secret: string) {
  const id = createHmac("sha256", `stackday-rate-limit:${secret}`).update(ip).digest("hex").slice(0, 32);
  return `${rule.name}:${id}`;
}

export interface RateLimitStore {
  /** Count one more request for `key` in the current window and return the new count. */
  hit(key: string, windowSeconds: number, now: Date): Promise<number>;
}

export type Decision =
  | { limited: false; rule: Rule | null; remaining?: number }
  | { limited: true; rule: Rule; retryAfter: number };

export async function limit(p: {
  method: string;
  pathname: string;
  headers: Headers;
  env: { VERCEL?: string };
  secret: string;
  store: RateLimitStore;
  now: Date;
  onError?: (e: unknown) => void;
}): Promise<Decision> {
  const rule = ruleFor(p.method, p.pathname);
  if (!rule) return { limited: false, rule: null };
  const key = bucketKey(rule, clientIp(p.headers, p.env), p.secret);
  let count: number;
  try {
    count = await p.store.hit(key, rule.windowSeconds, p.now);
  } catch (e) {
    // If the counter is unreachable, let the request through rather than take the site down.
    // The routes behind it need the same database, so they will fail on their own anyway.
    p.onError?.(e);
    return { limited: false, rule };
  }
  if (count > rule.limit) {
    const elapsed = Math.floor(p.now.getTime() / 1000) % rule.windowSeconds;
    return { limited: true, rule, retryAfter: rule.windowSeconds - elapsed };
  }
  return { limited: false, rule, remaining: rule.limit - count };
}

/** Fixed windows kept in memory. Used by the tests; not shared between serverless instances. */
export function memoryRateLimitStore(): RateLimitStore {
  const counts = new Map<string, number>();
  return {
    async hit(key, windowSeconds, now) {
      const window = Math.floor(now.getTime() / 1000 / windowSeconds);
      const k = `${key}@${window}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    },
  };
}

/**
 * The chat assistant costs model money per message, so on top of the per-address limit above it is
 * limited per signed-in wallet (docs/features/CHAT-AND-GIFTS.md, guardrail 8). The wallet is stored
 * only as a keyed hash, like an address.
 */
export const CHAT_WALLET_RULES: Rule[] = [
  { name: "chat-wallet-minute", limit: 10, windowSeconds: 60 },
  { name: "chat-wallet-day", limit: 150, windowSeconds: 86_400 },
];

/**
 * Counts one chat message for `wallet` against every rule. Unlike `limit`, it fails closed: if the
 * counter cannot be reached, the message is refused, because each message spends model credit.
 */
export async function limitWallet(p: { wallet: string; secret: string; store: RateLimitStore; now: Date; rules?: Rule[]; onError?: (e: unknown) => void }): Promise<Decision> {
  const rules = p.rules ?? CHAT_WALLET_RULES;
  for (const rule of rules) {
    let count: number;
    try {
      count = await p.store.hit(bucketKey(rule, p.wallet.toLowerCase(), p.secret), rule.windowSeconds, p.now);
    } catch (e) {
      p.onError?.(e);
      return { limited: true, rule, retryAfter: 60 };
    }
    if (count > rule.limit) {
      const elapsed = Math.floor(p.now.getTime() / 1000) % rule.windowSeconds;
      return { limited: true, rule, retryAfter: rule.windowSeconds - elapsed };
    }
  }
  return { limited: false, rule: rules[0] ?? null };
}
