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
