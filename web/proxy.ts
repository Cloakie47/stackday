import { NextResponse, type NextRequest } from "next/server";
import { configured } from "@/lib/server/backend";
import { originAllowed } from "@/lib/server/origin-check";
import { limit } from "@/lib/server/rate-limit";
import { dbRateLimitStore } from "@/lib/server/rate-limit-store";

/**
 * Runs before every /api request: an origin check on data changes, then rate limiting per visitor
 * address (see lib/server/origin-check.ts and lib/server/rate-limit.ts).
 * Without the account database nothing is limited, because every /api route that writes
 * anything needs that database and answers "not connected" anyway.
 */
export async function proxy(request: NextRequest) {
  // Refuse data changes sent from another website's page (see lib/server/origin-check.ts).
  if (!originAllowed({ method: request.method, origin: request.headers.get("origin"), host: request.nextUrl.host })) {
    return NextResponse.json({ error: "This request came from another website." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (!configured()) return NextResponse.next();
  const decision = await limit({
    method: request.method,
    pathname: request.nextUrl.pathname,
    headers: request.headers,
    env: { VERCEL: process.env.VERCEL },
    secret: process.env.SESSION_SECRET || process.env.SUPABASE_JWT_SECRET || "",
    store: dbRateLimitStore,
    now: new Date(),
    onError: (e) => console.error("rate limit check skipped:", e instanceof Error ? e.message : e),
  });
  if (decision.limited) {
    return NextResponse.json(
      { error: "Too many requests. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(decision.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
