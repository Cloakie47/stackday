import type { ResearchSnapshot } from "../types.ts";

/**
 * How report and portfolio routes get today's research. Injectable so tests (and this branch,
 * before gg/research-engine merges) can use their own fixtures. The default reads the engine's
 * public `GET /api/research/snapshot`, which answers with a `ResearchSnapshot` or `{ snapshot }`.
 */
export type SnapshotLoader = () => Promise<ResearchSnapshot | null>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Light shape check: enough that the builder cannot crash on it. The engine validates notes in
 * depth before it stores them; this only refuses something that is not a snapshot at all.
 */
export function asSnapshot(x: unknown): ResearchSnapshot | null {
  const s = isObj(x) && isObj(x.snapshot) ? x.snapshot : x;
  if (!isObj(s)) return null;
  if (s.kind !== "live" && s.kind !== "sample") return null;
  if (typeof s.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return null;
  if (typeof s.generatedAt !== "string" || typeof s.runId !== "string") return null;
  if (!isObj(s.market) || !Array.isArray(s.notes)) return null;
  for (const n of s.notes) {
    if (!isObj(n) || typeof n.assetId !== "string" || typeof n.action !== "string" || !Array.isArray(n.facts) || !isObj(n.outlook)) return null;
    if (!isObj(n.scenarios) || !Array.isArray(n.reasons) || !Array.isArray(n.opportunities) || !Array.isArray(n.risks)) return null;
  }
  return s as unknown as ResearchSnapshot;
}

/** Loader that fetches the snapshot route on the same site as `requestUrl`. */
export function fetchSnapshotLoader(requestUrl: string, fetchImpl: typeof fetch = fetch): SnapshotLoader {
  const url = new URL("/api/research/snapshot", requestUrl).toString();
  return async () => {
    try {
      const res = await fetchImpl(url, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!res.ok) return null;
      return asSnapshot(await res.json());
    } catch {
      return null;
    }
  };
}

/** Loader that always returns the given snapshot. For tests and fixtures. */
export const staticSnapshotLoader = (snapshot: ResearchSnapshot | null): SnapshotLoader => async () => snapshot;
