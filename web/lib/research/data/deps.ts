/**
 * Injectable dependencies for the research data layer. Server-only: these modules read API keys
 * from the environment and must never be imported into a client component.
 *
 * Tests pass a fake `fetch` that replays recorded responses from ./fixtures, so `npm test` never
 * touches the network.
 */

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type DataDeps = {
  fetch: FetchLike;
  /** Environment to read keys from. Defaults to process.env. */
  env: Record<string, string | undefined>;
  /** Current time. Injected so tests are deterministic. */
  now: () => Date;
  /** Waits between requests to respect rate limits. Tests pass a no-op. */
  sleep: (ms: number) => Promise<void>;
};

export function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("web/lib/research/data is server-only");
}

export function defaultDeps(): DataDeps {
  assertServer();
  return {
    fetch: (url, init) => fetch(url, { headers: init?.headers, cache: "no-store" }),
    env: process.env,
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/** Generic, contact-free User-Agent for public feeds that do not ask for one. */
export const GENERIC_USER_AGENT = "Stackday-Research/1.0 (+https://github.com/Cloakie47/stackday)";

/**
 * Spaces requests to one host so we stay under its published rate limit. One limiter per source,
 * shared by every caller in the process. `minGapMs` is the minimum time between request starts.
 */
export class RateLimiter {
  private next = 0;
  private readonly minGapMs: number;
  constructor(minGapMs: number) {
    this.minGapMs = minGapMs;
  }
  async wait(deps: Pick<DataDeps, "now" | "sleep">): Promise<void> {
    const now = deps.now().getTime();
    const at = Math.max(now, this.next);
    this.next = at + this.minGapMs;
    if (at > now) await deps.sleep(at - now);
  }
}

/** Removes secrets from a URL before it is logged, stored as a fixture key or shown in `problems`. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["apikey", "apiKey", "token", "key"]) if (u.searchParams.has(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return "(bad url)";
  }
}

/** Fetches text, turning network errors and non-2xx answers into a thrown Error with a redacted URL. */
export async function getText(deps: DataDeps, url: string, headers: Record<string, string>): Promise<string> {
  let res;
  try {
    res = await deps.fetch(url, { headers });
  } catch (e) {
    throw new Error(`network error for ${redactUrl(url)}: ${e instanceof Error ? e.message : "unknown"}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${redactUrl(url)}`);
  return res.text();
}

export async function getJson(deps: DataDeps, url: string, headers: Record<string, string>): Promise<unknown> {
  const text = await getText(deps, url, headers);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON from ${redactUrl(url)}`);
  }
}
