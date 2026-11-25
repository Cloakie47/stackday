import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RpcClient,
  aggRoundOf,
  attachVolume,
  bucketSwaps,
  decodeRound,
  decodeString,
  decodeSwap,
  feedBars,
  fetchOnchainHistory,
  markSpikes,
  mergeHours,
  morphoOraclePrice,
  morphoOracleScale,
  phaseOf,
  poolBars,
  proxyRoundId,
  rowToHour,
  hourToRow,
  sessionWindows,
  sqrtPriceToUsd,
  stitchRounds,
  type Backfill,
  type Round,
  type Swap,
} from "./onchain.ts";
import { applyTailState, extendBackfillAsset, isTailState, tailRegresses, type BackfillAsset, type OnchainTailState, type OnchainTailStore } from "./onchain.ts";
import { rpcKey, type Fixture } from "./record-fixtures.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataDeps } from "./deps.ts";

const w = (x: bigint | number) => BigInt(x).toString(16).padStart(64, "0");
const at = (iso: string) => Date.parse(iso) / 1000;

test("ABI decoding: Chainlink rounds, proxy round ids across phases, strings", () => {
  const rid = proxyRoundId(2, 630);
  assert.equal(rid, 36893488147419103862n, "phase 2, round 630 as read from the AAPL proxy on 2026-11-25");
  assert.equal(phaseOf(rid), 2);
  assert.equal(aggRoundOf(rid), 630);
  const hex = `0x${w(rid)}${w(35450230043n)}${w(1795640486)}${w(1795640498)}${w(rid)}`;
  const d = decodeRound(hex);
  assert.equal(Number(d.answer) / 1e8, 354.50230043);
  assert.equal(d.updatedAt, 1795640498);
  // A negative answer decodes as negative (and is then dropped by stitchRounds).
  assert.ok(decodeRound(`0x${w(1)}${"f".repeat(64)}${w(0)}${w(1)}${w(1)}`).answer < 0n);
  const text = Buffer.from("Coinbase AAPL").toString("hex").padEnd(64, "0");
  assert.equal(decodeString(`0x${w(32)}${w(13)}${text}`), "Coinbase AAPL");
});

test("prices from chain: pool sqrtPriceX96 and the Morpho oracle scale (values read on 2026-11-25)", () => {
  // slot0 of the three pools at block 61,978,548: USDC is token0 (6 decimals), the stock token is token1.
  assert.equal(Math.round(sqrtPriceToUsd(0x88487b9820e48c336cd45d58n, 8) * 100) / 100, 352.85);
  assert.equal(Math.round(sqrtPriceToUsd(0xcfa25930056468a2b6139a39n, 8) * 100) / 100, 152.01);
  assert.equal(Math.round(sqrtPriceToUsd(0x8fc0ad455ec6d1798e650ed733ccn, 18) * 100) / 100, 738.39);
  // Morpho: 1e36 x loan units per collateral unit, so 10^(36 + 6 - 18) = 1e24 for deSPXA against USDC.
  assert.equal(morphoOracleScale(6, 18), 24);
  assert.equal(Math.round(morphoOraclePrice(720447104112661442083000000n, 6, 18) * 1000) / 1000, 720.447);
});

test("Swap logs: USDC volume from amount0, price from sqrtPriceX96, block time from the log", () => {
  const log = {
    topics: ["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"],
    data: "0x00000000000000000000000000000000000000000000000000000000861cba31ffffffffffffffffffffffffffffffffffffffffffffffffd777f056c7094a150000000000000000000000000000000000008cc4672eac8e0047e918537934530000000000000000000000000000000000000000000000001a87dd11568d387600000000000000000000000000000000000000000000000000000000000333c0",
    blockNumber: "0x32402da",
    blockTimestamp: "0x6ad26297",
    logIndex: "0x201",
  };
  const s = decodeSwap(log, 18)!;
  assert.equal(s.block, 52691674);
  assert.equal(s.time, 0x6ad26297);
  assert.equal(Math.round(s.usdc * 100) / 100, 2250.03);
  assert.ok(s.price > 700 && s.price < 800, String(s.price));
  assert.equal(decodeSwap({ ...log, blockTimestamp: undefined }, 18), null, "no block time, no swap");
});

test("phases are stitched at the first round of the next phase; bad rounds are dropped", () => {
  const r = (phase: number, round: number, iso: string, answer: number): Round => ({ phase, round, updatedAt: at(iso), answer });
  const out = stitchRounds([
    r(1, 1, "2026-08-03T15:00:00Z", 300),
    r(1, 2, "2026-08-05T20:00:00Z", 301),
    r(2, 1, "2026-08-05T21:00:00Z", 302),
    r(1, 3, "2026-08-10T15:00:00Z", 999), // phase 1 still posting after phase 2 started: not used
    r(2, 2, "2026-08-10T15:00:01Z", 303),
    r(2, 3, "2026-08-11T15:00:00Z", 0),
  ]);
  assert.deepEqual(out.map((x) => `${x.phase}.${x.round}`), ["1.1", "1.2", "2.1", "2.2"]);
});

test("NYSE session windows: from the previous close to this close, holidays and early closes included", () => {
  const ws = sessionWindows(Date.parse("2026-11-24T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z"));
  assert.deepEqual(ws.map((x) => x.date), ["2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30"]);
  const fri = ws.find((x) => x.date === "2026-11-27")!;
  assert.equal(new Date(fri.start).toISOString(), "2026-11-25T21:00:00.000Z", "Thanksgiving is skipped: the window opens at Wednesday's close");
  assert.equal(new Date(fri.end).toISOString(), "2026-11-27T18:00:00.000Z", "early close at 1:00 p.m.");
  assert.equal(fri.t, "2026-11-27T14:30:00.000Z");
  const mon = ws.find((x) => x.date === "2026-11-30")!;
  assert.equal(new Date(mon.start).toISOString(), "2026-11-27T18:00:00.000Z", "the weekend lands in Monday's bar");
  // Only windows that have ended are returned.
  assert.equal(sessionWindows(Date.parse("2026-11-24T00:00:00Z"), Date.parse("2026-11-30T20:59:00Z")).at(-1)!.date, "2026-11-27");
});

test("daily bars from Chainlink rounds: carried open, close at the NYSE close, no made-up bar for a silent session", () => {
  const r = (iso: string, answer: number, round: number): Round => ({ phase: 2, round, updatedAt: at(iso), answer });
  const rounds = [
    r("2026-11-23T20:30:00Z", 100, 1), // before Tuesday's window
    r("2026-11-24T15:00:00Z", 104, 2),
    r("2026-11-24T20:59:00Z", 102, 3),
    r("2026-11-24T22:00:00Z", 101, 4), // after Tuesday's close: belongs to Wednesday
    r("2026-11-28T03:00:00Z", 99, 5), // Saturday: belongs to Monday 30th
  ];
  const ws = sessionWindows(Date.parse("2026-11-24T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z"));
  const { bars, noRound } = feedBars(rounds, ws);
  assert.deepEqual(bars.map((b) => [b.t.slice(0, 10), b.o, b.h, b.l, b.c]), [
    ["2026-11-24", 100, 104, 100, 102],
    ["2026-11-25", 102, 102, 101, 101],
    ["2026-11-30", 101, 101, 99, 99],
  ]);
  assert.deepEqual(noRound, ["2026-11-27"], "Friday had no round: skipped and reported");
});

test("pool hours: single-swap spikes count for volume, not price; thin and unread sessions are skipped", () => {
  assert.deepEqual(markSpikes([100, 100.1, 110, 100.2, 100.1]), [false, false, true, false, false]);
  assert.deepEqual(markSpikes([100, 103, 106, 109]), [false, false, false, false], "a steady move is not a spike");
  const sw = (iso: string, price: number, usdc: number, i: number): Swap => ({ block: i, logIndex: 0, time: at(iso), price, usdc });
  const swaps = [
    sw("2026-11-24T14:10:00Z", 700, 1000, 1),
    sw("2026-11-24T14:20:00Z", 702, 3000, 2),
    sw("2026-11-24T14:30:00Z", 780, 50, 3), // spike
    sw("2026-11-24T14:40:00Z", 701, 1000, 4),
    sw("2026-11-24T19:05:00Z", 705, 2000, 5),
    sw("2026-11-25T15:00:00Z", 710, 500, 6), // Wednesday: only 1 trade
  ];
  const { hours, spikes } = bucketSwaps(swaps);
  assert.equal(spikes, 1);
  const h14 = hours.find((h) => h.t === at("2026-11-24T14:00:00Z"))!;
  assert.equal(h14.n, 4);
  assert.equal(h14.pn, 3);
  assert.equal(h14.vol, 5050);
  assert.equal(h14.h, 702);
  assert.equal(h14.vwap, (700 * 1000 + 702 * 3000 + 701 * 1000) / 5000);
  // Hour rows survive the backfill file round trip.
  assert.deepEqual(rowToHour(hourToRow(h14)), h14);
  const ws = sessionWindows(Date.parse("2026-11-24T00:00:00Z"), Date.parse("2026-11-26T00:00:00Z"));
  const cov = [{ from: Date.parse("2026-11-20T00:00:00Z"), to: Date.parse("2026-11-26T00:00:00Z") }];
  const pb = poolBars(hours, ws, cov);
  assert.equal(pb.bars.length, 1);
  assert.equal(pb.bars[0].t, "2026-11-24T14:30:00.000Z");
  assert.equal(pb.bars[0].o, h14.vwap);
  assert.equal(pb.bars[0].c, 705);
  assert.equal(pb.bars[0].h, 705, "the 780 spike is not the high");
  assert.equal(pb.bars[0].v, 7050);
  assert.deepEqual(pb.thin, ["2026-11-25"]);
  // Swaps not read for a session: no bar, and reported as unread rather than thin.
  const short = poolBars(hours, ws, [{ from: cov[0].from, to: Date.parse("2026-11-25T12:00:00Z") }]);
  assert.deepEqual(short.unread, ["2026-11-25"]);
  // Volume is attached to feed bars only for sessions fully read.
  const vb = attachVolume([{ t: "2026-11-24T14:30:00.000Z", o: 1, h: 1, l: 1, c: 1 }, { t: "2026-11-25T14:30:00.000Z", o: 1, h: 1, l: 1, c: 1 }], ws, hours, [{ from: cov[0].from, to: Date.parse("2026-11-25T12:00:00Z") }]);
  assert.deepEqual(vb.map((b) => b.v), [7050, undefined]);
});

test("merging the backfill's last partial hour with the tail adds trades and keeps open and close in order", () => {
  const a = bucketSwaps([{ block: 1, logIndex: 0, time: at("2026-11-24T14:10:00Z"), price: 700, usdc: 100 }]).hours;
  const b = bucketSwaps([{ block: 2, logIndex: 0, time: at("2026-11-24T14:50:00Z"), price: 710, usdc: 300 }]).hours;
  const [m] = mergeHours(a, b);
  assert.equal(m.n, 2);
  assert.equal(m.o, 700);
  assert.equal(m.c, 710);
  assert.equal(m.vwap, (700 * 100 + 710 * 300) / 400);
});

test("RPC errors never contain the RPC URL", async () => {
  const url = "https://rpc.example.invalid/v1/SECRETKEY";
  const deps = { fetch: async () => { throw new Error(`connect failed to ${url}`); }, env: {}, now: () => new Date(), sleep: async () => {} } as unknown as DataDeps;
  await assert.rejects(new RpcClient(deps, url).call("eth_chainId", []), (e: Error) => !e.message.includes("SECRETKEY") && /network error/.test(e.message));
});

/** Fake Base RPC answering from a function of (method, params). */
function fakeRpc(answer: (method: string, params: unknown[]) => unknown, now = "2026-11-25T12:00:00Z"): DataDeps {
  return {
    fetch: async (_url, init) => {
      const reqs = JSON.parse(init?.body ?? "[]") as { id: number; method: string; params: unknown[] }[];
      return { ok: true, status: 200, text: async () => JSON.stringify(reqs.map((r) => {
        const res = answer(r.method, r.params);
        return res instanceof Error ? { jsonrpc: "2.0", id: r.id, error: { code: -32000, message: res.message } } : { jsonrpc: "2.0", id: r.id, result: res };
      })) };
    },
    env: {},
    now: () => new Date(now),
    sleep: async () => {},
  };
}

test("contract checks: a wrong chain or a feed that says something else stops the read", async () => {
  const empty: Backfill = { note: "", generatedAt: "", assets: {} };
  const wrongChain = await fetchOnchainHistory("mAAPL", fakeRpc((m) => (m === "eth_chainId" ? "0x1" : { number: "0x10", timestamp: "0x10" })), empty);
  assert.equal(wrongChain.daily, undefined);
  assert.match(wrongChain.problems[0], /chain id 0x1 is not Base/);
  const pool = (m: string, p: unknown[]) => {
    if (m === "eth_chainId") return "0x2105";
    if (m === "eth_getBlockByNumber") return { number: "0x3b1b5f4", timestamp: w(at("2026-11-25T11:59:00Z")).replace(/^0+/, "0x") };
    const data = (p[0] as { data: string }).data;
    if (data === "0x0dfe1681") return `0x${w(BigInt("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"))}`;
    if (data === "0xd21220a7") return `0x${w(BigInt("0xb200000000000000000000c2e324d24d7eecd1fb"))}`;
    if (data === "0x3850c7bd") return `0x${w(0x88487b9820e48c336cd45d58n)}${w(0)}`;
    if (data === "0x7284e416") return `0x${w(32)}${w(13)}${Buffer.from("Coinbase TSLA").toString("hex").padEnd(64, "0")}`;
    if (data === "0x313ce567") return `0x${w(8)}`;
    return new Error("execution reverted");
  };
  const wrongFeed = await fetchOnchainHistory("mAAPL", fakeRpc(pool), empty);
  assert.match(wrongFeed.problems.join(" | "), /says "Coinbase TSLA"/);
  assert.equal(wrongFeed.current, undefined);
  assert.equal(wrongFeed.daily, undefined);
});

// ---------------------------------------------------------------------------------------------
// Builder --extend and the persisted tail
// ---------------------------------------------------------------------------------------------

const sw2 = (iso: string, price: number, usdc: number, block: number): Swap => ({ block, logIndex: 0, time: at(iso), price, usdc });

test("builder --extend keeps every round and hour, merges the partial last hour, never shrinks", () => {
  const first = bucketSwaps([sw2("2026-11-24T14:10:00Z", 700, 100, 10), sw2("2026-11-24T15:20:00Z", 702, 100, 20)]).hours;
  const existing: BackfillAsset = {
    feed: { address: "0xfeed", rounds: [[2, 1, at("2026-11-24T14:00:00Z"), 100], [2, 2, at("2026-11-24T15:00:00Z"), 101]], lastRound: { "2": 2 } },
    pool: { address: "0xpool", fromBlock: 1, toBlock: 20, fromTime: at("2026-11-24T14:00:00Z"), toTime: at("2026-11-24T15:30:00Z"), swaps: 2, spikes: 0, hours: first.map((h) => hourToRow(h)) },
  };
  const next = extendBackfillAsset(existing, {
    rounds: [{ phase: 2, round: 2, updatedAt: at("2026-11-24T15:00:00Z"), answer: 101 }, { phase: 2, round: 3, updatedAt: at("2026-11-24T16:00:00Z"), answer: 103 }],
    lastRound: { "2": 3 },
    pool: { toBlock: 40, toTime: at("2026-11-24T16:40:00Z"), swaps: [sw2("2026-11-24T15:50:00Z", 704, 300, 30), sw2("2026-11-24T16:30:00Z", 706, 100, 40)] },
  });
  assert.deepEqual(next.feed!.rounds.map((r) => r[1]), [1, 2, 3], "round 2 is not added twice");
  assert.equal(next.feed!.lastRound["2"], 3);
  assert.equal(next.pool!.toBlock, 40);
  assert.equal(next.pool!.fromBlock, 1, "the start is kept");
  assert.equal(next.pool!.swaps, 4);
  const h15 = rowToHour(next.pool!.hours.find((r) => r[0] === at("2026-11-24T15:00:00Z"))!);
  assert.equal(h15.n, 2, "the partial 15:00 hour in the file and the new swap in it are one hour");
  assert.equal(h15.o, 702);
  assert.equal(h15.c, 704);
  assert.equal(next.pool!.hours.length, 3);
  // An addition that ends before the file does nothing to the pool.
  const same = extendBackfillAsset(existing, { pool: { toBlock: 15, toTime: at("2026-11-24T15:00:00Z"), swaps: [sw2("2026-11-24T14:50:00Z", 1, 1, 15)] } });
  assert.deepEqual(same.pool, existing.pool);
});

test("tail state: joins the backfill at the hour of its last block, ignores an older state, uses a gapped one alone", () => {
  const row = (iso: string, n: number) => hourToRow({ t: at(iso), n, vol: n, pn: n, pvw: n, vwap: 1, o: 1, h: 1, l: 1, c: 1 });
  const base: BackfillAsset = { pool: { address: "0xpool", fromBlock: 1, toBlock: 100, fromTime: at("2026-11-24T10:00:00Z"), toTime: at("2026-11-24T12:30:00Z"), swaps: 6, spikes: 0, hours: [row("2026-11-24T11:00:00Z", 2), row("2026-11-24T12:00:00Z", 1)] } };
  const state: OnchainTailState = { version: 1, assetId: "mSPX", updatedAt: "2026-11-25T00:00:00.000Z", pool: { fromBlock: 101, fromTime: at("2026-11-24T12:00:00Z"), toBlock: 300, toTime: at("2026-11-24T15:10:00Z"), hours: [row("2026-11-24T12:00:00Z", 3), row("2026-11-24T14:00:00Z", 4)] } };
  const joined = applyTailState(base, state, "0xpool");
  assert.equal(joined.note, undefined);
  assert.deepEqual(joined.asset.pool!.hours.map((r) => [r[0], r[1]]), [[at("2026-11-24T11:00:00Z"), 2], [at("2026-11-24T12:00:00Z"), 3], [at("2026-11-24T14:00:00Z"), 4]], "the complete 12:00 hour of the state replaces the partial one of the backfill");
  assert.equal(joined.asset.pool!.toBlock, 300);
  assert.equal(joined.asset.pool!.fromTime, base.pool!.fromTime, "history from the backfill is kept");
  // The checked-in file was regenerated past the state: the file wins.
  assert.equal(applyTailState({ pool: { ...base.pool!, toBlock: 400 } }, state, "0xpool").asset.pool!.toBlock, 400);
  // A state that starts after the last hour of the backfill (a gap) is used alone, with a note.
  const gapped = applyTailState(base, { ...state, pool: { ...state.pool!, fromTime: at("2026-11-24T14:00:00Z") } }, "0xpool");
  assert.match(gapped.note!, /after the checked-in backfill ends/);
  assert.equal(gapped.asset.pool!.fromTime, at("2026-11-24T14:00:00Z"));
  // Shape check and the coverage rule.
  assert.equal(isTailState(state, "mSPX"), true);
  assert.equal(isTailState({ ...state, version: 2 }, "mSPX"), false);
  assert.equal(isTailState(state, "mAAPL"), false, "the state of another asset is not used");
  assert.equal(tailRegresses(state, { ...state, pool: { ...state.pool!, toBlock: 250 } }, base), true);
  assert.equal(tailRegresses({ ...state, lastRound: { "2": 9 } }, { ...state, lastRound: { "2": 8 } }, base), true);
  assert.equal(tailRegresses(state, { ...state, pool: undefined }, { pool: { ...base.pool!, toBlock: 400 } }), false, "the file now covers further: dropping the state is not a step back");
});

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const onchainFx = JSON.parse(readFileSync(join(fixtureDir, "onchain.json"), "utf8")) as Fixture;

/** Replays the recorded Base answers of one asset. `refuse` turns a call into an error answer; every call is logged. */
function replay(asset: string, opts: { refuse?: (method: string, params: unknown[]) => boolean; log?: { method: string; params: unknown[] }[]; store?: OnchainTailStore } = {}): DataDeps {
  const rpc = onchainFx.rpcByAsset![asset];
  const used = new Map<string, number>();
  return {
    fetch: async (_url, init) => {
      const reqs = JSON.parse(init?.body ?? "[]") as { id: number; method: string; params: unknown[] }[];
      const body = reqs.map((q) => {
        opts.log?.push({ method: q.method, params: q.params });
        const key = rpcKey(q.method, q.params);
        const list = rpc[key];
        if (opts.refuse?.(q.method, q.params) || !list?.length) return { jsonrpc: "2.0", id: q.id, error: { code: -32000, message: "not recorded" } };
        const i = used.get(key) ?? 0;
        used.set(key, i + 1);
        return { jsonrpc: "2.0", id: q.id, ...list[Math.min(i, list.length - 1)] };
      });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
    env: {},
    now: () => new Date(onchainFx.recordedAt),
    sleep: async () => {},
    ...(opts.store ? { onchainTail: opts.store } : {}),
  };
}

function memoryStore(): OnchainTailStore & { data: Map<string, OnchainTailState> } {
  const data = new Map<string, OnchainTailState>();
  return {
    data,
    async load(id: string) {
      const v = data.get(id);
      return v ? (JSON.parse(JSON.stringify(v)) as OnchainTailState) : null;
    },
    async save(id: string, state: OnchainTailState) {
      data.set(id, JSON.parse(JSON.stringify(state)) as OnchainTailState);
    },
  };
}

const barKey = (bars: { t: string; o: number; c: number; v?: number }[] | undefined) => (bars ?? []).map((b) => `${b.t} ${b.o.toFixed(4)} ${b.c.toFixed(4)} ${b.v?.toFixed(0) ?? "-"}`);
const priceKey = (bars: { t: string; o: number; c: number }[] | undefined) => (bars ?? []).map((b) => `${b.t} ${b.o.toFixed(4)} ${b.c.toFixed(4)}`);

test("tail store: a run saves what it read, the next run reads nothing older and builds the same bars", async () => {
  const bf = onchainFx.backfill!;
  const store = memoryStore();
  for (const id of ["mAAPL", "mNVDA", "mSPX"]) {
    const alone = await fetchOnchainHistory(id, replay(id), bf);
    const first = await fetchOnchainHistory(id, replay(id, { store }), bf);
    assert.ok(first.daily?.length, `${id}: ${first.problems.join(" | ")}`);
    const saved = store.data.get(id)!;
    assert.ok(isTailState(saved, id), `${id} saved a valid state`);
    assert.ok(JSON.stringify(saved).length < 200_000, "the state stays small");
    assert.deepEqual(priceKey(first.daily), priceKey(alone.daily), `${id}: same prices as without a store`);
    if (id === "mSPX") {
      assert.deepEqual(barKey(first.daily), barKey(alone.daily), "same volume too");
      assert.ok(saved.pool!.toBlock > bf.assets.mSPX.pool!.toBlock && saved.pool!.hours.length > 0);
      assert.equal(saved.pool!.fromTime, Math.floor(bf.assets.mSPX.pool!.toTime / 3600) * 3600);
    } else {
      assert.ok(saved.rounds!.length > 0 && saved.lastRound!["2"] > bf.assets[id].feed!.lastRound["2"], `${id}: new rounds saved`);
    }
    // Second run with the state: no round or log range older than the state is asked for again.
    const log: { method: string; params: unknown[] }[] = [];
    const second = await fetchOnchainHistory(id, replay(id, { store, log }), bf);
    assert.deepEqual(barKey(second.daily), barKey(first.daily), `${id}: same bars from the stored tail`);
    const starts = log.filter((q) => q.method === "eth_getLogs").map((q) => Number(BigInt((q.params[0] as { fromBlock: string }).fromBlock)));
    if (saved.pool) for (const b of starts) assert.ok(b > saved.pool.toBlock, `${id}: log read starts after the stored tail (${b})`);
    const roundCalls = log.filter((q) => q.method === "eth_call" && String((q.params[0] as { data: string }).data).startsWith("0x9a6fc8f5"));
    assert.equal(roundCalls.length, 0, `${id}: no round is read twice`);
  }
});

test("tail store: a stale backfill plus a stored state reads only the gap after the state", async () => {
  const bf = onchainFx.backfill!;
  const store = memoryStore();
  // Run 1 is cut after the first batch of log ranges: the state ends part of the way.
  let ranges = 0;
  const cut = replay("mSPX", { store, refuse: (m) => m === "eth_getLogs" && ++ranges > 10 });
  const part = await fetchOnchainHistory("mSPX", cut, bf);
  assert.ok(part.problems.some((p) => /the next run continues from there/.test(p)), part.problems.join(" | "));
  const mid = store.data.get("mSPX")!.pool!.toBlock;
  assert.ok(mid > bf.assets.mSPX.pool!.toBlock, "progress was saved");
  // Run 2 reads only from the stored end and ends with the same bars as one full read.
  const log: { method: string; params: unknown[] }[] = [];
  const rest = await fetchOnchainHistory("mSPX", replay("mSPX", { store, log }), bf);
  const full = await fetchOnchainHistory("mSPX", replay("mSPX"), bf);
  const starts = log.filter((q) => q.method === "eth_getLogs").map((q) => Number(BigInt((q.params[0] as { fromBlock: string }).fromBlock)));
  assert.equal(Math.min(...starts), mid + 1, "the read starts right after the stored tail");
  assert.deepEqual(barKey(rest.daily), barKey(full.daily));
  assert.ok(store.data.get("mSPX")!.pool!.toBlock >= mid, "coverage never moves backwards");
});

test("tail store failures never break the read: a failing load or save is a problem line and bars still come", async () => {
  const bf = onchainFx.backfill!;
  const broken: OnchainTailStore = {
    load: async () => {
      throw new Error("database down");
    },
    save: async () => {
      throw new Error("database down");
    },
  };
  const h = await fetchOnchainHistory("mSPX", replay("mSPX", { store: broken }), bf);
  assert.ok(h.daily?.length);
  assert.ok(h.problems.some((p) => /stored on-chain tail could not be loaded \(database down\)/.test(p)));
  assert.ok(h.problems.some((p) => /on-chain tail could not be saved \(database down\)/.test(p)));
  // A stored value of the wrong shape is ignored, not trusted.
  const odd: OnchainTailStore = { load: async () => ({ version: 7 }) as unknown as OnchainTailState, save: async () => {} };
  const h2 = await fetchOnchainHistory("mSPX", replay("mSPX", { store: odd }), bf);
  assert.ok(h2.daily?.length && h2.problems.some((p) => /unexpected shape, ignored/.test(p)));
  // A stored state ahead of this read (another run got further) is never overwritten by a smaller one.
  const ahead = memoryStore();
  await fetchOnchainHistory("mSPX", replay("mSPX", { store: ahead }), bf);
  const far = { ...ahead.data.get("mSPX")!, pool: { ...ahead.data.get("mSPX")!.pool!, toBlock: 99_999_999 } };
  ahead.data.set("mSPX", far);
  await fetchOnchainHistory("mSPX", replay("mSPX", { store: ahead }), bf);
  assert.equal(ahead.data.get("mSPX")!.pool!.toBlock, 99_999_999);
});

// ---------------------------------------------------------------------------------------------
// Issue #80: one RPC error never wipes an asset; the restricted deSPXA feed is optional
// ---------------------------------------------------------------------------------------------

const to = (p: unknown[]) => String((p[0] as { to?: string })?.to ?? "").toLowerCase();
const DESPXA_FEED = "0x97165ad36d96567a521958cc46914160b968752b";

test("a failed head block is retried once; a second failure still builds bars from the backfill", async () => {
  const bf = onchainFx.backfill!;
  for (const id of ["mAAPL", "mSPX"]) {
    const full = await fetchOnchainHistory(id, replay(id), bf);
    // One failure, then the retry answers: the same result as a clean read.
    let n = 0;
    const once = await fetchOnchainHistory(id, replay(id, { refuse: (m, p) => m === "eth_getBlockByNumber" && p[0] === "latest" && ++n === 1 }), bf);
    assert.deepEqual(barKey(once.daily), barKey(full.daily), `${id}: retry gives the same bars`);
    assert.equal(once.current?.value, full.current?.value);
    // Both attempts fail: bars from the backfill alone, no current price, no pool or loan facts, said in a problem line.
    const down = await fetchOnchainHistory(id, replay(id, { refuse: (m, p) => m === "eth_getBlockByNumber" && p[0] === "latest" }), bf);
    assert.ok(down.daily?.length, `${id}: ${down.problems.join(" | ")}`);
    assert.equal(down.current, undefined);
    assert.deepEqual(down.facts, []);
    assert.ok(down.problems.some((p) => /latest Base block not read after a retry .* bars from the backfill and stored tail only, up to 2026-/.test(p)), down.problems.join(" | "));
    const lastBf = id === "mSPX" ? bf.assets.mSPX.pool!.toTime : Math.max(...bf.assets[id].feed!.rounds.map((r) => r[2]));
    for (const b of down.daily!) assert.ok(Date.parse(b.t) / 1000 <= lastBf, `${id}: no bar after the backfill's end`);
  }
});

test("a failed price batch is retried once; a second failure keeps the bars and drops only the current price", async () => {
  const bf = onchainFx.backfill!;
  const slot0 = (m: string, p: unknown[]) => m === "eth_call" && String((p[0] as { data: string }).data) === "0x0dfe1681"; // pool token0, part of the price batch
  for (const id of ["mAAPL", "mSPX"]) {
    const full = await fetchOnchainHistory(id, replay(id), bf);
    let n = 0;
    const once = await fetchOnchainHistory(id, replay(id, { refuse: (m, p) => slot0(m, p) && ++n === 1 }), bf);
    assert.equal(once.current?.value, full.current?.value, `${id}: the retry reads the price`);
    const down = await fetchOnchainHistory(id, replay(id, { refuse: slot0 }), bf);
    assert.ok(down.daily?.length, `${id}: bars still come (${down.problems.join(" | ")})`);
    assert.equal(down.current, undefined);
    assert.ok(down.problems.some((p) => /current on-chain price not read after a retry/.test(p)));
  }
});

test("deSPXA: px.last is the pool price (the bars' basis), the Morpho oracle is a separate loan price", async () => {
  const bf = onchainFx.backfill!;
  const h = await fetchOnchainHistory("mSPX", replay("mSPX"), bf);
  const pool = h.facts.find((f) => f.id === "px.pool.last")!;
  const loan = h.facts.find((f) => f.id === "px.loan")!;
  assert.equal(h.current!.value, pool.value);
  assert.match(h.current!.label, /pool .*the same basis as the chart bars/);
  assert.match(loan.label, /Loan price .*Morpho market oracle/);
  assert.notEqual(loan.value, pool.value);
  // The last pool bar and px.last are within a few percent: no oracle-versus-pool gap read as a move.
  const lastBar = h.daily!.at(-1)!;
  assert.ok(Math.abs(h.current!.value / lastBar.c - 1) < 0.03, `pool ${h.current!.value} vs last bar ${lastBar.c}`);
});

test("deSPXA: the restricted oracle feed reverting never removes the asset; the loan price is dated at the head block", async () => {
  const bf = onchainFx.backfill!;
  const full = await fetchOnchainHistory("mSPX", replay("mSPX"), bf);
  const h = await fetchOnchainHistory("mSPX", replay("mSPX", { refuse: (m, p) => m === "eth_call" && to(p) === DESPXA_FEED }), bf);
  assert.ok(h.daily?.length && h.current, h.problems.join(" | "));
  assert.deepEqual(barKey(h.daily), barKey(full.daily));
  const loan = h.facts.find((f) => f.id === "px.loan")!;
  assert.equal(loan.value, full.facts.find((f) => f.id === "px.loan")!.value);
  assert.equal(loan.asOf, h.facts.find((f) => f.id === "px.pool.last")!.asOf, "dated at the head block");
  // The feed is not in the batch that must not fail.
  const log: { method: string; params: unknown[] }[] = [];
  await fetchOnchainHistory("mSPX", replay("mSPX", { log }), bf);
  assert.ok(log.filter((q) => to(q.params) === DESPXA_FEED).length <= 1);
});
