/**
 * Records real responses once for the replay tests. Not part of the app or of `npm test`.
 *
 *   cd web
 *   node lib/research/data/record-fixtures.ts mcbBTC mAAPL
 *
 * Every response `gatherAsset` fetches is saved under fixtures/<assetId>.json, keyed by the URL
 * with any API key removed (see `redactUrl`), together with the time it was recorded. Keys are
 * read from the environment and never written to disk. Without RESEARCH_PRICE_API_KEY a stock is
 * recorded with Twelve Data's public "demo" key, which only answers for a few symbols such as AAPL.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDeps, redactUrl, type FetchLike } from "./deps.ts";
import { gatherAsset } from "./gather.ts";

export type Fixture = { recordedAt: string; assetId: string; note: string; responses: Record<string, { status: number; body: string }> };

async function record(assetId: string): Promise<void> {
  const base = defaultDeps();
  const responses: Fixture["responses"] = {};
  const fetchRec: FetchLike = async (url, init) => {
    const res = await base.fetch(url, init);
    const body = await res.text();
    responses[redactUrl(url)] = { status: res.status, body };
    return { ok: res.ok, status: res.status, text: async () => body };
  };
  const now = new Date();
  const env = { ...process.env, RESEARCH_PRICE_API_KEY: process.env.RESEARCH_PRICE_API_KEY || "demo" };
  const input = await gatherAsset(assetId, now.toISOString().slice(0, 10), { ...base, fetch: fetchRec, env, now: () => now });
  const fixture: Fixture = { recordedAt: now.toISOString(), assetId, note: "Real responses recorded by record-fixtures.ts", responses };
  const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${assetId}.json`), JSON.stringify(fixture));
  console.log(`${assetId}: ${Object.keys(responses).length} responses, ${input.facts.length} facts, problems: ${input.problems.join(" | ") || "none"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const id of process.argv.slice(2)) await record(id);
}
