/**
 * Records real responses once for the replay tests. Not part of the app or of `npm test`.
 *
 *   cd web
 *   node lib/research/data/record-fixtures.ts run          # whole run for today -> fixtures/run.json
 *   node lib/research/data/record-fixtures.ts mAAPL        # one asset -> fixtures/mAAPL.json
 *   node lib/research/data/record-fixtures.ts onchain      # on-chain reads for the stocks -> fixtures/onchain.json
 *   node lib/research/data/record-fixtures.ts onchain --backfill=path.json   # against a (truncated) backfill copy
 *
 * Every response is saved keyed by the URL with any API key removed (see `redactUrl`), together
 * with the time it was recorded. Keys are read from the environment and never written to disk.
 * JSON-RPC reads (onchain.ts) are saved per call, keyed by method and parameters, never by the RPC
 * URL; the on-chain fixture also stores the backfill it was recorded against, so the replayed run
 * asks for exactly the recorded blocks and rounds. Large responses are trimmed afterwards to what
 * the parsers read (see the fixture's `note`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDeps, redactUrl, type DataDeps, type FetchLike } from "./deps.ts";
import { gatherAsset, gatherRun } from "./gather.ts";
import { ONCHAIN_ASSETS, ONCHAIN_BACKFILL, fetchOnchainHistory, type Backfill, type RpcAnswer } from "./onchain.ts";

export type Fixture = {
  recordedAt: string;
  assetId: string;
  note: string;
  responses: Record<string, { status: number; body: string }>;
  /**
   * JSON-RPC answers keyed by `rpcKey(method, params)`, in the order they were given: the same call
   * (for example the latest block) can answer differently later in a recording.
   */
  rpc?: Record<string, RpcAnswer[]>;
  /** The on-chain fixture: the same, per asset, so each asset replays on its own. */
  rpcByAsset?: Record<string, Record<string, RpcAnswer[]>>;
  /** The on-chain backfill the RPC answers were recorded against. */
  backfill?: Backfill;
};

/** Key of one JSON-RPC call in a fixture: the method and its parameters, never the URL. */
export const rpcKey = (method: string, params: unknown) => `${method} ${JSON.stringify(params)}`;

function recorder(base: DataDeps): { fetch: FetchLike; responses: Fixture["responses"]; rpc: NonNullable<Fixture["rpc"]> } {
  const responses: Fixture["responses"] = {};
  const rpc: NonNullable<Fixture["rpc"]> = {};
  const fetchRec: FetchLike = async (url, init) => {
    if (init?.method === "POST") {
      const res = await base.fetch(url, init);
      const body = await res.text();
      const reqs = JSON.parse(init.body ?? "[]") as { id: number; method: string; params: unknown[] }[];
      try {
        const answers = JSON.parse(body) as { id: number; result?: unknown; error?: RpcAnswer["error"] }[];
        for (const q of reqs) {
          const a = answers.find((x) => x.id === q.id);
          if (a) (rpc[rpcKey(q.method, q.params)] ??= []).push(a.error ? { error: a.error } : { result: a.result });
        }
      } catch {
        // not a batch answer: the replay will fail the same way as the live call
      }
      console.error(`${res.status} rpc batch of ${reqs.length}: ${[...new Set(reqs.map((q) => q.method))].join(", ")}`);
      return { ok: res.ok, status: res.status, text: async () => body };
    }
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
  return { fetch: fetchRec, responses, rpc };
}

async function record(target: string, backfill: Backfill = ONCHAIN_BACKFILL): Promise<void> {
  const base = defaultDeps();
  const { fetch, responses, rpc } = recorder(base);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const deps = { ...base, fetch, now: () => now };
  let summary: string;
  let extra: Partial<Fixture> = {};
  if (target === "run") {
    const run = await gatherRun(date, deps);
    summary = `market ${run.market.facts.length} facts; ${run.assets.map((a) => `${a.assetId} ${a.facts.length}`).join(", ")}; problems: ${[...run.market.problems, ...run.assets.flatMap((a) => a.problems)].join(" | ")}`;
  } else if (target === "onchain") {
    const parts: string[] = [];
    const rpcByAsset: NonNullable<Fixture["rpcByAsset"]> = {};
    for (const id of Object.keys(ONCHAIN_ASSETS)) {
      const h = await fetchOnchainHistory(id, deps, backfill);
      rpcByAsset[id] = { ...rpc };
      for (const k of Object.keys(rpc)) delete rpc[k];
      parts.push(`${id}: ${h.daily?.length ?? 0} daily bars, current ${h.current?.value}, ${h.requests} requests, problems: ${h.problems.join(" | ") || "none"}`);
    }
    summary = parts.join("\n");
    extra = { rpcByAsset, backfill };
  } else {
    const input = await gatherAsset(target, date, deps);
    summary = `${input.facts.length} facts, problems: ${input.problems.join(" | ") || "none"}`;
    extra = Object.keys(rpc).length ? { rpc, backfill: ONCHAIN_BACKFILL } : {};
  }
  const fixture: Fixture = { recordedAt: now.toISOString(), assetId: target, note: "Real responses recorded by record-fixtures.ts", responses, ...extra };
  const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${target}.json`), JSON.stringify(fixture));
  console.log(`${target}: ${Object.keys(responses).length} responses, ${Object.keys(extra.rpcByAsset ?? {}).length} assets with rpc answers\n${summary}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bfArg = process.argv.find((a) => a.startsWith("--backfill="));
  const backfill = bfArg ? (JSON.parse(readFileSync(bfArg.slice("--backfill=".length), "utf8")) as Backfill) : undefined;
  for (const id of process.argv.slice(2).filter((a) => !a.startsWith("--"))) await record(id, backfill);
}
