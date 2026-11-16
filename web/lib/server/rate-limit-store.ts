import { db } from "./backend";
import type { RateLimitStore } from "./rate-limit";

/**
 * Counter in the account database: the `rate_limit_hit` function in supabase/schema.sql adds one
 * to the current window for a key in a single statement and returns the new count, so all
 * serverless instances share the same count.
 */
export const dbRateLimitStore: RateLimitStore = {
  async hit(key, windowSeconds) {
    const { data, error } = await db().rpc("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds });
    if (error) throw new Error(`rate limit counter: ${error.message}`);
    return Number(data);
  },
};
