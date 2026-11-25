/**
 * Writes ./onchain-backfill.json: the on-chain price history the run reads before its live tail
 * (see onchain.ts). Not part of the app or of `npm test`. Read-only JSON-RPC on Base mainnet: no
 * wallet, no transactions, no keys.
 *
 *   cd web
 *   node lib/research/data/build-onchain-backfill.ts            # all three assets, from scratch
 *   node lib/research/data/build-onchain-backfill.ts --extend   # keep the file, add what came after it
 *
 * Prefer --extend: it keeps every round and hour already in the file and reads only from each
 * pool's toBlock + 1 and each feed's next round to now (`extendBackfillAsset`), so coverage never
 * shrinks. A run from scratch starts at the oldest block the RPC serves (about 25 days on
 * PublicNode), which would cut the deSPXA pool history short.
 *
 * RESEARCH_BASE_RPC_URL picks the RPC (default: PublicNode, see onchain.ts). PublicNode keeps about
 * 11 million blocks of logs and state (archive reads need a token), so pool history older than that
 * needs an archive RPC; Chainlink rounds are read at the latest block and need no archive.
 *
 * What it stores, per asset, and records in the file:
 * - Chainlink feeds: every round of every phase ([phase, round, updatedAt, answer]) and the last
 *   round read per phase, so the run only reads newer rounds.
 * - Pools: every Swap from the oldest block the RPC serves (or --from-block) to the head, kept as
 *   hourly rows (trades, USDC volume, volume-weighted price, open, high, low, close; single-swap
 *   spikes counted for volume only), with the first and last block read and their times.
 * It also prints the measurements the design rests on: rounds per phase and per NYSE session,
 * swaps per day, response sizes and times.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDeps } from "./deps.ts";
import {
  BASE_CHAIN_ID,
  BASE_RPC_ENV,
  DEFAULT_BASE_RPC_URL,
  GETLOGS_MAX_BLOCKS,
  ONCHAIN_ASSETS,
  RpcClient,
  SELECTORS,
  bucketSwaps,
  decodeRound,
  decodeSwap,
  ethCall,
  extendBackfillAsset,
  feedBars,
  hexBlock,
  hexResult,
  hourToRow,
  proxyRoundId,
  sessionWindows,
  stitchRounds,
  word,
  wordAddress,
  type Backfill,
  type BackfillAsset,
  type Round,
  type Swap,
} from "./onchain.ts";

const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const u256 = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deps = { ...defaultDeps(), now: () => new Date() };
const rpc = new RpcClient(deps, process.env[BASE_RPC_ENV]?.trim() || DEFAULT_BASE_RPC_URL, 60_000);

async function withRetry<T>(f: () => Promise<T>, what: string, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw e;
      console.error(`retry ${what}: ${e instanceof Error ? e.message : e}`);
      await sleep(1500 * (i + 1));
    }
  }
}

async function blockTime(n: number): Promise<number> {
  const b = (await withRetry(() => rpc.call("eth_getBlockByNumber", [hexBlock(n), false]), "block")) as { timestamp: string };
  return Number(BigInt(b.timestamp));
}

/** Oldest block whose state and logs the RPC serves (bisected), with a margin. */
async function oldestReadable(head: number): Promise<number> {
  let ok = head - 1_000_000;
  let bad = Math.max(1, head - 40_000_000);
  try {
    await rpc.call("eth_getBlockByNumber", [hexBlock(bad), false]);
    return bad;
  } catch {
    // bisect below
  }
  while (ok - bad > 10_000) {
    const mid = Math.floor((ok + bad) / 2);
    try {
      await rpc.call("eth_getBlockByNumber", [hexBlock(mid), false]);
      ok = mid;
    } catch {
      bad = mid;
    }
  }
  return ok + 200_000; // the window moves while we scan
}

/** Every round of every phase, or with `after` only the rounds after the last one already held per phase. */
async function readRounds(feed: string, decimals: number, head: number, after: Record<string, number> = {}): Promise<{ rounds: Round[]; lastRound: Record<string, number>; perPhase: string[] }> {
  const B = hexBlock(head);
  const phase = Number(word(hexResult((await rpc.batch([ethCall(feed, SELECTORS.phaseId, B)]))[0], "phaseId"), 0));
  const rounds: Round[] = [];
  const lastRound: Record<string, number> = {};
  const perPhase: string[] = [];
  const firstPhase = Math.max(1, ...Object.keys(after).map(Number));
  for (let p = firstPhase; p <= phase; p++) {
    const agg = wordAddress(String(await rpc.call("eth_call", [{ to: feed, data: SELECTORS.phaseAggregators + u256(p) }, B])));
    const last = Number(word(String(await rpc.call("eth_call", [{ to: agg, data: SELECTORS.latestRound }, B])), 0));
    for (let r = (after[String(p)] ?? 0) + 1; r <= last; r += 200) {
      const ids = Array.from({ length: Math.min(200, last - r + 1) }, (_, k) => r + k);
      const ans = await withRetry(() => rpc.batch(ids.map((id) => ethCall(feed, SELECTORS.getRoundData + u256(proxyRoundId(p, id)), B))), "rounds");
      ans.forEach((a, k) => {
        try {
          const d = decodeRound(hexResult(a, "getRoundData"));
          rounds.push({ phase: p, round: ids[k], updatedAt: d.updatedAt, answer: Number(d.answer) / 10 ** decimals });
        } catch {
          console.error(`round ${p}.${ids[k]} unreadable`);
        }
      });
    }
    lastRound[String(p)] = last;
    const mine = rounds.filter((x) => x.phase === p);
    perPhase.push(`phase ${p}: aggregator ${agg}, rounds ${(after[String(p)] ?? 0) + 1} to ${last}${mine.length ? `, ${new Date(mine[0].updatedAt * 1000).toISOString()} to ${new Date(mine[mine.length - 1].updatedAt * 1000).toISOString()}` : ", nothing new"}`);
  }
  return { rounds, lastRound, perPhase };
}

async function readSwaps(pool: string, decimals: number, from: number, to: number): Promise<{ swaps: Swap[]; requests: number; bytes: number }> {
  const ranges: [number, number][] = [];
  for (let b = from; b <= to; b += GETLOGS_MAX_BLOCKS) ranges.push([b, Math.min(to, b + GETLOGS_MAX_BLOCKS - 1)]);
  const swaps: Swap[] = [];
  let requests = 0;
  let bytes = 0;
  let next = 0;
  const one = async ([a, b]: [number, number]): Promise<void> => {
    try {
      const logs = (await withRetry(() => rpc.call("eth_getLogs", [{ address: pool, topics: [SWAP_TOPIC], fromBlock: hexBlock(a), toBlock: hexBlock(b) }]), `logs ${a}`, 2)) as Parameters<typeof decodeSwap>[0][];
      requests++;
      bytes += JSON.stringify(logs).length;
      for (const l of logs) {
        const s = decodeSwap(l, decimals);
        if (s) swaps.push(s);
      }
    } catch (e) {
      if (b - a < 500) throw e;
      const mid = Math.floor((a + b) / 2); // too many results: split the range
      await one([a, mid]);
      await one([mid + 1, b]);
    }
  };
  const worker = async () => {
    while (next < ranges.length) {
      const r = ranges[next++];
      await one(r);
      if (next % 25 === 0) console.error(`  ${pool.slice(0, 8)}: ${next}/${ranges.length} ranges, ${swaps.length} swaps`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { swaps, requests, bytes };
}

const backfillPath = () => join(dirname(fileURLToPath(import.meta.url)), "onchain-backfill.json");

/** --extend: keep the checked-in file and add the rounds and swaps that came after it. */
async function extend(): Promise<void> {
  const chain = Number(BigInt(String(await rpc.call("eth_chainId", []))));
  if (chain !== BASE_CHAIN_ID) throw new Error(`not Base: chain ${chain}`);
  const file = JSON.parse(readFileSync(backfillPath(), "utf8")) as Backfill;
  const head = Number(BigInt(String(await rpc.call("eth_blockNumber", []))));
  const headTime = await blockTime(head);
  const t0 = Date.now();
  const before = JSON.stringify(file).length;
  for (const cfg of Object.values(ONCHAIN_ASSETS)) {
    const old = file.assets[cfg.assetId] ?? {};
    const add: Parameters<typeof extendBackfillAsset>[1] = {};
    if (cfg.feed) {
      const { rounds, lastRound, perPhase } = await readRounds(cfg.feed.address, cfg.feed.decimals, head, old.feed?.lastRound ?? {});
      add.rounds = rounds;
      add.lastRound = lastRound;
      console.log(`${cfg.assetId} feed: ${rounds.length} new rounds`);
      for (const p of perPhase) console.log(`  ${p}`);
    }
    if (old.pool && head > old.pool.toBlock) {
      const t = Date.now();
      const { swaps, requests, bytes } = await readSwaps(cfg.pool.address, cfg.token.decimals, old.pool.toBlock + 1, head);
      add.pool = { toBlock: head, toTime: headTime, swaps };
      console.log(`${cfg.assetId} pool: ${swaps.length} new swaps in blocks ${old.pool.toBlock + 1} to ${head}, ${requests} requests, ${(bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t) / 1000).toFixed(0)} s`);
    }
    const next = extendBackfillAsset(old, add);
    if ((next.pool?.toBlock ?? 0) < (old.pool?.toBlock ?? 0) || (next.pool?.hours.length ?? 0) < (old.pool?.hours.length ?? 0)) throw new Error(`${cfg.assetId}: extending would shrink coverage`);
    file.assets[cfg.assetId] = next;
  }
  file.generatedAt = new Date(headTime * 1000).toISOString();
  file.note = file.note.replace(/ Extended by --extend .*$/, "") + ` Extended by --extend on ${new Date().toISOString().slice(0, 10)} to block ${head}.`;
  writeFileSync(backfillPath(), `${JSON.stringify(file)}\n`);
  console.log(`extended ${backfillPath()}: ${(before / 1024).toFixed(0)} KB -> ${(JSON.stringify(file).length / 1024).toFixed(0)} KB, ${rpc.requests} requests, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

async function main(): Promise<void> {
  const chain = Number(BigInt(String(await rpc.call("eth_chainId", []))));
  if (chain !== BASE_CHAIN_ID) throw new Error(`not Base: chain ${chain}`);
  const head = Number(BigInt(String(await rpc.call("eth_blockNumber", []))));
  const headTime = await blockTime(head);
  const fromArg = process.argv.find((a) => a.startsWith("--from-block="));
  const from = fromArg ? Number(fromArg.split("=")[1]) : await oldestReadable(head);
  const fromTime = await blockTime(from);
  console.log(`head ${head} (${new Date(headTime * 1000).toISOString()}), pools read from block ${from} (${new Date(fromTime * 1000).toISOString()})`);
  const t0 = Date.now();
  const assets: Record<string, BackfillAsset> = {};
  for (const cfg of Object.values(ONCHAIN_ASSETS)) {
    const a: BackfillAsset = {};
    if (cfg.feed) {
      const t = Date.now();
      const { rounds, lastRound, perPhase } = await readRounds(cfg.feed.address, cfg.feed.decimals, head);
      a.feed = { address: cfg.feed.address, rounds: rounds.map((r) => [r.phase, r.round, r.updatedAt, Number(r.answer.toPrecision(12))]), lastRound };
      const stitched = stitchRounds(rounds);
      const windows = sessionWindows(stitched[0].updatedAt * 1000, headTime * 1000);
      const fb = feedBars(stitched, windows);
      const per = windows.map((w) => stitched.filter((r) => r.updatedAt * 1000 > w.start && r.updatedAt * 1000 <= w.end).length);
      const gaps = stitched.slice(1).map((r, i) => r.updatedAt - stitched[i].updatedAt);
      const jumps = stitched.slice(1).map((r, i) => ({ r, ch: r.answer / stitched[i].answer - 1 })).filter((x) => Math.abs(x.ch) > 0.08);
      // Overlap between phases: the same moment in two phases should agree.
      const p1 = rounds.filter((r) => r.phase === 1);
      const p2 = rounds.filter((r) => r.phase === 2 && r.updatedAt <= Math.max(...p1.map((x) => x.updatedAt)));
      const diffs = p2.slice(0, 50).map((r) => {
        const near = p1.reduce((b, x) => (Math.abs(x.updatedAt - r.updatedAt) < Math.abs(b.updatedAt - r.updatedAt) ? x : b), p1[0]);
        return { dt: Math.abs(near.updatedAt - r.updatedAt), d: r.answer / near.answer - 1 };
      }).filter((x) => x.dt < 600);
      console.log(`${cfg.assetId} feed ${cfg.feed.address}: ${rounds.length} rounds in ${Date.now() - t} ms, ${rpc.requests} requests so far`);
      for (const s of perPhase) console.log(`  ${s}`);
      console.log(`  stitched ${stitched.length} rounds; ${windows.length} sessions, rounds per session min ${Math.min(...per)} median ${per.sort((x, y) => x - y)[Math.floor(per.length / 2)]} max ${Math.max(...per)}; sessions with no round: ${fb.noRound.length} ${fb.noRound.join(" ")}; longest gap between rounds ${(Math.max(...gaps) / 3600).toFixed(1)} h`);
      console.log(`  overlap phase 1 vs 2 (rounds within 10 min): ${diffs.length}, max difference ${diffs.length ? (Math.max(...diffs.map((x) => Math.abs(x.d))) * 100).toFixed(3) : "n/a"} %`);
      console.log(`  moves over 8 % between consecutive rounds: ${jumps.map((j) => `${new Date(j.r.updatedAt * 1000).toISOString()} ${(j.ch * 100).toFixed(1)}%`).join(", ") || "none"}`);
    }
    const t = Date.now();
    const { swaps, requests, bytes } = await readSwaps(cfg.pool.address, cfg.token.decimals, from, head);
    const { hours, spikes } = bucketSwaps(swaps);
    a.pool = { address: cfg.pool.address, fromBlock: from, toBlock: head, fromTime, toTime: headTime, swaps: swaps.length, spikes, hours: hours.map(hourToRow) };
    const perDay = new Map<string, number>();
    for (const s of swaps) perDay.set(new Date(s.time * 1000).toISOString().slice(0, 10), (perDay.get(new Date(s.time * 1000).toISOString().slice(0, 10)) ?? 0) + 1);
    console.log(`${cfg.assetId} pool ${cfg.pool.address}: ${swaps.length} swaps (${spikes} single-swap spikes) in ${requests} getLogs requests, ${(bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t) / 1000).toFixed(0)} s`);
    console.log(`  swaps per UTC day: ${[...perDay].map(([d, n]) => `${d.slice(5)} ${n}`).join(", ")}`);
    assets[cfg.assetId] = a;
  }
  const file: Backfill = {
    note: `On-chain price history on Base mainnet written by build-onchain-backfill.ts on ${new Date().toISOString().slice(0, 10)}. Chainlink rounds: every round of every phase up to lastRound. Pools: every Swap from fromBlock to toBlock as hourly rows [t, trades, USDC volume, priced trades, priced volume, vwap, open, high, low, close]. Read-only RPC; the URL is not stored.`,
    generatedAt: new Date(headTime * 1000).toISOString(),
    assets,
  };
  const out = backfillPath();
  writeFileSync(out, `${JSON.stringify(file)}\n`);
  console.log(`wrote ${out}: ${(JSON.stringify(file).length / 1024).toFixed(0)} KB, ${rpc.requests} requests, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await (process.argv.includes("--extend") ? extend() : main());
