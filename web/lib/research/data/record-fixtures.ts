/**
 * Records real responses once for the replay tests. Not part of the app or of `npm test`.
 *
 *   cd web
 *   node lib/research/data/record-fixtures.ts run          # whole run for today -> fixtures/run.json
 *   node lib/research/data/record-fixtures.ts mAAPL        # one asset -> fixtures/mAAPL.json
 *
 * Every response is saved keyed by the URL with any API key removed (see `redactUrl`), together
 * with the time it was recorded. Keys are read from the environment and never written to disk.
 * A single stock is recorded through Twelve Data (internal use, RESEARCH_PRICE_PROVIDER defaults to
 * "twelvedata" here only); without RESEARCH_PRICE_API_KEY with its public "demo" key, which only
 * answers for a few symbols such as AAPL. Large responses are trimmed afterwards to what the
 * parsers read (see the fixture's `note`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDeps, redactUrl, type DataDeps, type FetchLike } from "./deps.ts";
import { gatherAsset, gatherRun } from "./gather.ts";

export type Fixture = { recordedAt: string; assetId: string; note: string; responses: Record<string, { status: number; body: string }> };

function recorder(base: DataDeps): { fetch: FetchLike; responses: Fixture["responses"] } {
  const responses: Fixture["responses"] = {};
  const fetchRec: FetchLike = async (url, init) => {
    try {
      const res = await base.fetch(url, init);
      const body = await res.text();
      responses[redactUrl(url)] = { status: res.status, body };
      console.error(`${res.status} ${body.length} ${redactUrl(url).slice(0, 110)}`);
      return { ok: res.ok, status: res.status, text: async () => body };
    } catch (e) {
      responses[redactUrl(url)] = { status: 0, body: `network error: ${e instanceof Error ? e.message : "unknown"}` };
      throw e;
    }
  };
  return { fetch: fetchRec, responses };
}

async function record(target: string): Promise<void> {
  const base = defaultDeps();
  const { fetch, responses } = recorder(base);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const env = { ...process.env, RESEARCH_PRICE_PROVIDER: process.env.RESEARCH_PRICE_PROVIDER || "twelvedata", RESEARCH_PRICE_API_KEY: process.env.RESEARCH_PRICE_API_KEY || "demo" };
  const deps = { ...base, fetch, env, now: () => now };
  let summary: string;
  if (target === "run") {
    const run = await gatherRun(date, { ...deps, env: { ...env, RESEARCH_PRICE_API_KEY: "" } });
    summary = `market ${run.market.facts.length} facts; ${run.assets.map((a) => `${a.assetId} ${a.facts.length}`).join(", ")}; problems: ${[...run.market.problems, ...run.assets.flatMap((a) => a.problems)].join(" | ")}`;
  } else {
    const input = await gatherAsset(target, date, deps);
    summary = `${input.facts.length} facts, problems: ${input.problems.join(" | ") || "none"}`;
  }
  const fixture: Fixture = { recordedAt: now.toISOString(), assetId: target, note: "Real responses recorded by record-fixtures.ts", responses };
  const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${target}.json`), JSON.stringify(fixture));
  console.log(`${target}: ${Object.keys(responses).length} responses, ${summary}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const id of process.argv.slice(2)) await record(id);
}
