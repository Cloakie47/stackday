import type { Fact, IsoDateTime, PriceBar, Source } from "../types.ts";
import { addDays, isTradingDay, newYorkParts, newYorkTimeToUtc, sessionHours } from "./calendar.ts";
import type { DataDeps } from "./deps.ts";
import backfillJson from "./onchain-backfill.json" with { type: "json" };

/**
 * On-chain prices on Base mainnet for the stock assets (founder decision, November 25, 2026; spec
 * section 5). Read-only JSON-RPC: no wallet, no transactions, no keys. Server-only.
 *
 * - Apple (AAPLc) and NVIDIA (NVDAc): the current price is the Chainlink "Coinbase AAPL" or
 *   "Coinbase NVDA" feed (`latestRoundData`). Daily bars are built from the feed's round history
 *   (`getRoundData` across phases) on the NYSE session calendar. Volume is the USDC traded in the
 *   main AAPLc/USDC or NVDAc/USDC pool, from the checked-in backfill only: these pools see about
 *   6,500 and 26,000 swaps a day (6 and 24 MB of logs), too much to read inside a run.
 * - S&P 500 (deSPXA): the current price is the Morpho deSPXA/USDC market oracle (`price()`, what
 *   Morpho liquidates on). The oracle keeps no history (its feed always reports round 1), so daily
 *   bars come from the deSPXA/USDC pool's Swap events: volume-weighted hourly prices, single-swap
 *   spikes ignored, sessions with fewer than `MIN_POOL_TRADES` trades skipped. The pool trades
 *   above or below the oracle; that premium is its own fact.
 *
 * Every number is labelled as the token's on-chain price on Base, not the exchange price or the
 * index level, and cites the feed, oracle or pool address with its round or block.
 *
 * Cost: history up to the backfill's end comes from ./onchain-backfill.json (written by
 * build-onchain-backfill.ts, which records the rounds and blocks it covers). At run time only the
 * tail after it is read: Chainlink rounds (200 per batched request) and, for deSPXA only, pool
 * logs in ranges of `GETLOGS_MAX_BLOCKS`. The whole read is bounded by `ONCHAIN_BUDGET_MS`.
 *
 * Contract values were read from chain on 2026-11-25 (block about 61,978,500) and are checked
 * again on every run: chain id, feed description and decimals, pool tokens. A mismatch stops the
 * read with a problem line. See SOURCES.md, section 2.
 */

export const BASE_RPC_ENV = "RESEARCH_BASE_RPC_URL";
/**
 * Public Base RPC used when RESEARCH_BASE_RPC_URL is not set. https://mainnet.base.org answered
 * every eth_getLogs with "request limit reached" on 2026-11-25; PublicNode answers eth_getLogs up
 * to 50,000 blocks per request and keeps about 11 million blocks of history (archive reads need a
 * token). The URL is never logged or stored: problems cite contracts, rounds and blocks only.
 */
export const DEFAULT_BASE_RPC_URL = "https://base-rpc.publicnode.com";
export const BASE_CHAIN_ID = 8453;
/** eth_getLogs block range limit of the default RPC. */
export const GETLOGS_MAX_BLOCKS = 50_000;
/** Per-request timeout for on-chain reads. */
export const RPC_TIMEOUT_MS = 8_000;
/** Total time for one asset's on-chain read at run time (the engine's per-asset call has 270 s for everything). */
export const ONCHAIN_BUDGET_MS = 15_000;
/** At most this many Chainlink rounds are read at run time (about 4 months of NVDA at 17 a day). */
export const MAX_TAIL_ROUNDS = 2_000;
/** At most this many eth_getLogs ranges are read at run time: 120 x 50,000 blocks, about 14 days at 0.2 s blocks. */
export const MAX_TAIL_LOG_REQUESTS = 120;
/** A pool session bar needs at least this many priced trades, otherwise it is skipped. */
export const MIN_POOL_TRADES = 3;
/** A swap more than this far from both neighbours, while they agree, is a single-swap spike. */
export const SPIKE_THRESHOLD = 0.02;
const ROUNDS_PER_BATCH = 200;
const LOGS_PER_BATCH = 10;

export const USDC = { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 } as const;
const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export type Token = { symbol: string; address: string; decimals: number };
export type FeedRef = { address: string; description: string; decimals: number };
export type OracleRef = {
  address: string;
  /** Morpho Blue market that uses the oracle. */
  morphoMarket: string;
  /** The oracle's BASE_FEED_1 (18 decimals; no round history). */
  baseFeed: string;
  loanDecimals: number;
  collateralDecimals: number;
};
/** token0 is USDC and token1 the asset token in all three pools (checked on every run). */
export type PoolRef = { address: string; venue: string; factory: string };
export type OnchainAsset = {
  assetId: string;
  token: Token;
  /** What the token stands for, used in labels ("Apple's stock price", "the S&P 500 index"). */
  underlying: string;
  feed?: FeedRef;
  oracle?: OracleRef;
  pool: PoolRef;
  /** Where daily bars come from. */
  bars: "feed" | "pool";
  /** Read the pool's Swap logs after the backfill at run time (only where the pool is quiet). */
  poolTail: boolean;
};

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

export const ONCHAIN_ASSETS: Record<string, OnchainAsset> = {
  mAAPL: {
    assetId: "mAAPL",
    token: { symbol: "AAPLc", address: "0xb200000000000000000000c2e324d24d7eecd1fb", decimals: 8 },
    underlying: "Apple's exchange price",
    feed: { address: "0x787f13dEa48Db0897CbCDD985de77809D837F988", description: "Coinbase AAPL", decimals: 8 },
    pool: { address: "0xf5fcb9cdafce67d50afef298f88e709d2b946ba6", venue: "concentrated-liquidity pool", factory: "0x9cb220581b91b0c83223012fe69688b92ad07a76" },
    bars: "feed",
    poolTail: false,
  },
  mNVDA: {
    assetId: "mNVDA",
    token: { symbol: "NVDAc", address: "0xb20000000000000000000078ee7ce2fe4908108c", decimals: 8 },
    underlying: "NVIDIA's exchange price",
    feed: { address: "0x04689a41629776563E6822F76f2e57D148d28513", description: "Coinbase NVDA", decimals: 8 },
    pool: { address: "0xf668e21993f0acd7ab00bb1cfbaed0df28a3c8ec", venue: "concentrated-liquidity pool", factory: "0x9cb220581b91b0c83223012fe69688b92ad07a76" },
    bars: "feed",
    poolTail: false,
  },
  mSPX: {
    assetId: "mSPX",
    token: { symbol: "deSPXA", address: "0x9c5c365e764829876243d0b289733b9d2b729685", decimals: 18 },
    underlying: "the S&P 500 index",
    oracle: {
      address: "0x98c27f1C7772d66bCF837F0b8A435A31E6e85b6d",
      morphoMarket: "0x4440abd9eff38ebf76b8f64c074682acef8c89e77555075478a7582883206604",
      baseFeed: "0x97165ad36d96567a521958cc46914160b968752b",
      loanDecimals: 6,
      collateralDecimals: 18,
    },
    pool: { address: "0xd08f1fb797bfacded23323178672557034c64cfa", venue: "Uniswap v3 pool", factory: "0x33128a8fc17869897dce68ed026d694621f6fdfd" },
    bars: "pool",
    poolTail: true,
  },
};

export const basescan = (address: string) => `https://basescan.org/address/${address}`;
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

// ---------------------------------------------------------------------------------------------
// ABI encoding and decoding (only what we read)
// ---------------------------------------------------------------------------------------------

export const SELECTORS = {
  description: "0x7284e416",
  decimals: "0x313ce567",
  latestRoundData: "0xfeaf968c",
  phaseId: "0x58303b10",
  getRoundData: "0x9a6fc8f5",
  phaseAggregators: "0xc1597304",
  latestRound: "0x668a0f02",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  slot0: "0x3850c7bd",
  price: "0xa035b1fe",
} as const;

const u256 = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
export const hexBlock = (n: number) => `0x${n.toString(16)}`;
export function word(hex: string, i: number): bigint {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const w = h.slice(64 * i, 64 * (i + 1));
  if (w.length !== 64) throw new Error("short ABI answer");
  return BigInt(`0x${w}`);
}
const signed = (x: bigint) => (x >= 1n << 255n ? x - (1n << 256n) : x);
export const wordAddress = (hex: string, i = 0) => `0x${word(hex, i).toString(16).padStart(40, "0")}`;
export function decodeString(hex: string): string {
  const off = Number(word(hex, 0)) / 32;
  const len = Number(word(hex, off));
  const h = hex.slice(2 + (off + 1) * 64, 2 + (off + 1) * 64 + len * 2);
  return new TextDecoder().decode(Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16)));
}

export type RoundData = { roundId: bigint; answer: bigint; updatedAt: number };
export function decodeRound(hex: string): RoundData {
  return { roundId: word(hex, 0), answer: signed(word(hex, 1)), updatedAt: Number(word(hex, 3)) };
}
const PHASE_SHIFT = 64n;
export const phaseOf = (roundId: bigint) => Number(roundId >> PHASE_SHIFT);
export const aggRoundOf = (roundId: bigint) => Number(roundId & ((1n << PHASE_SHIFT) - 1n));
export const proxyRoundId = (phase: number, round: number) => (BigInt(phase) << PHASE_SHIFT) | BigInt(round);

/** USDC per token from a pool's sqrtPriceX96 (token0 USDC with 6 decimals, token1 the asset token). */
export function sqrtPriceToUsd(sqrtPriceX96: bigint, tokenDecimals: number): number {
  const r = Number(sqrtPriceX96) / 2 ** 96;
  return 10 ** (tokenDecimals - USDC.decimals) / (r * r);
}

/**
 * Morpho oracle price to USD per token. Morpho Blue prices are 1e36 times loan-token units per
 * collateral-token unit, so the scale is 10^(36 + loan decimals - collateral decimals): for
 * deSPXA (18) against USDC (6), 1e24.
 */
export const morphoOracleScale = (loanDecimals: number, collateralDecimals: number) => 36 + loanDecimals - collateralDecimals;
export function morphoOraclePrice(raw: bigint, loanDecimals: number, collateralDecimals: number): number {
  return Number(raw) / 10 ** morphoOracleScale(loanDecimals, collateralDecimals);
}

export type Swap = { block: number; logIndex: number; time: number; price: number; usdc: number };
type RawLog = { blockNumber?: string; logIndex?: string; blockTimestamp?: string; data?: string; topics?: string[] };

/** Decodes a Uniswap v3 or Slipstream Swap log: amount0 (USDC) for volume, sqrtPriceX96 for the price after the swap. */
export function decodeSwap(log: RawLog, tokenDecimals: number): Swap | null {
  if (!log.data || log.topics?.[0] !== SWAP_TOPIC || !log.blockNumber || !log.blockTimestamp) return null;
  const amount0 = signed(word(log.data, 0));
  const sqrt = word(log.data, 2);
  if (sqrt === 0n) return null;
  return {
    block: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex ?? "0x0")),
    time: Number(BigInt(log.blockTimestamp)),
    price: sqrtPriceToUsd(sqrt, tokenDecimals),
    usdc: Math.abs(Number(amount0)) / 10 ** USDC.decimals,
  };
}

// ---------------------------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------------------------

export type RpcCall = { method: string; params: unknown[] };
export type RpcAnswer = { result?: unknown; error?: { code?: number; message?: string } };

/** Batched JSON-RPC over `deps.fetch`. Errors never contain the RPC URL (it may hold a key). */
export class RpcClient {
  requests = 0;
  private readonly deps: DataDeps;
  private readonly url: string;
  private readonly timeoutMs: number;
  constructor(deps: DataDeps, url: string, timeoutMs = RPC_TIMEOUT_MS) {
    this.deps = deps;
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  private scrub(msg: string): string {
    return msg.split(this.url).join("(rpc)").slice(0, 160);
  }

  async batch(calls: RpcCall[]): Promise<RpcAnswer[]> {
    if (!calls.length) return [];
    this.requests++;
    const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c.method, params: c.params })));
    let res;
    try {
      res = await this.deps.fetch(this.url, { method: "POST", body, headers: { "Content-Type": "application/json", Accept: "application/json" }, timeoutMs: this.timeoutMs });
    } catch (e) {
      throw new Error(`Base RPC network error: ${this.scrub(e instanceof Error ? e.message : "unknown")}`);
    }
    if (!res.ok) throw new Error(`Base RPC answered HTTP ${res.status}`);
    let raw: unknown;
    try {
      raw = JSON.parse(await res.text());
    } catch {
      throw new Error("Base RPC answered invalid JSON");
    }
    if (!Array.isArray(raw)) {
      const err = (raw as { error?: { message?: string } })?.error?.message;
      throw new Error(`Base RPC refused the batch: ${this.scrub(String(err ?? "unexpected answer"))}`);
    }
    const byId = new Map<number, RpcAnswer>();
    for (const r of raw as { id?: number; result?: unknown; error?: RpcAnswer["error"] }[]) if (typeof r?.id === "number") byId.set(r.id, { result: r.result, error: r.error });
    return calls.map((_, i) => byId.get(i + 1) ?? { error: { message: "missing from the batch answer" } });
  }

  async call(method: string, params: unknown[]): Promise<unknown> {
    const [a] = await this.batch([{ method, params }]);
    if (a.error) throw new Error(`${method}: ${this.scrub(String(a.error.message ?? "error"))}`);
    return a.result;
  }
}

export const ethCall = (to: string, data: string, block: string): RpcCall => ({ method: "eth_call", params: [{ to, data }, block] });

/** The hex result of one answer, or throws with the call's name. */
export function hexResult(a: RpcAnswer, what: string): string {
  if (a.error || typeof a.result !== "string" || a.result === "0x") throw new Error(`${what} failed (${a.error?.message?.slice(0, 80) ?? "empty answer"})`);
  return a.result;
}

// ---------------------------------------------------------------------------------------------
// Rounds and swaps into bars
// ---------------------------------------------------------------------------------------------

/** One Chainlink round: phase, round within the phase, update time (unix seconds), answer in USD. */
export type Round = { phase: number; round: number; updatedAt: number; answer: number };

/**
 * One timeline from several phases. Phases overlap when a new aggregator starts posting before the
 * proxy moves to it (AAPL and NVDA: phase 2 from August 5, phase 1 until August 14, 2026). Rule:
 * a phase's rounds are used until the first round of the next phase, then the next phase.
 */
export function stitchRounds(rounds: Round[]): Round[] {
  const phases = [...new Set(rounds.map((r) => r.phase))].sort((a, b) => a - b);
  const firstOf = new Map(phases.map((p) => [p, Math.min(...rounds.filter((r) => r.phase === p).map((r) => r.updatedAt))]));
  const out = rounds.filter((r) => r.answer > 0 && r.updatedAt > 0).filter((r) => {
    const later = phases.filter((p) => p > r.phase).map((p) => firstOf.get(p)!);
    return later.every((t) => r.updatedAt < t);
  });
  return out.sort((a, b) => a.updatedAt - b.updatedAt || a.phase - b.phase || a.round - b.round);
}

/**
 * Hourly aggregate of swaps (UTC hours). `pvw` is the USDC volume of the priced (non-spike) trades
 * and `vwap` their volume-weighted price; o, h, l, c are pool prices after each priced swap.
 */
export type HourBucket = { t: number; n: number; vol: number; pn: number; pvw: number; vwap?: number; o?: number; h?: number; l?: number; c?: number };

/**
 * Marks single-swap spikes: a price more than `threshold` away from both the previous and the next
 * swap while those two are within half the threshold of each other (a large swap that is
 * immediately arbitraged back). Such swaps count for volume but not for prices.
 */
export function markSpikes(prices: number[], threshold = SPIKE_THRESHOLD): boolean[] {
  return prices.map((p, i) => {
    if (i === 0 || i === prices.length - 1) return false;
    const a = prices[i - 1];
    const b = prices[i + 1];
    return Math.abs(p / a - 1) > threshold && Math.abs(p / b - 1) > threshold && Math.abs(b / a - 1) < threshold / 2;
  });
}

export function bucketSwaps(swaps: Swap[]): { hours: HourBucket[]; spikes: number } {
  const sorted = [...swaps].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const spike = markSpikes(sorted.map((s) => s.price));
  const map = new Map<number, HourBucket & { pv: number }>();
  sorted.forEach((s, i) => {
    const t = Math.floor(s.time / 3600) * 3600;
    let b = map.get(t);
    if (!b) map.set(t, (b = { t, n: 0, vol: 0, pn: 0, pvw: 0, pv: 0 }));
    b.n++;
    b.vol += s.usdc;
    if (spike[i]) return;
    const w = Math.max(s.usdc, 1e-6);
    b.pn++;
    b.pvw += w;
    b.pv += w * s.price;
    b.o ??= s.price;
    b.h = Math.max(b.h ?? -Infinity, s.price);
    b.l = Math.min(b.l ?? Infinity, s.price);
    b.c = s.price;
  });
  const hours = [...map.values()].sort((a, b) => a.t - b.t).map(({ pv, ...b }) => (b.pvw > 0 ? { ...b, vwap: pv / b.pvw } : b));
  return { hours, spikes: spike.filter(Boolean).length };
}

/** Joins two hour lists; an hour present in both (the backfill's last, partial hour) is combined, older list first. */
export function mergeHours(a: HourBucket[], b: HourBucket[]): HourBucket[] {
  const map = new Map<number, HourBucket>(a.map((x) => [x.t, { ...x }]));
  for (const y of b) {
    const x = map.get(y.t);
    if (!x) {
      map.set(y.t, { ...y });
      continue;
    }
    const pvw = x.pvw + y.pvw;
    const vwap = pvw > 0 ? ((x.vwap ?? 0) * x.pvw + (y.vwap ?? 0) * y.pvw) / pvw : undefined;
    map.set(y.t, {
      t: x.t,
      n: x.n + y.n,
      vol: x.vol + y.vol,
      pn: x.pn + y.pn,
      pvw,
      ...(vwap !== undefined ? { vwap } : {}),
      ...(x.o ?? y.o) !== undefined ? { o: x.o ?? y.o } : {},
      ...(x.h !== undefined || y.h !== undefined ? { h: Math.max(x.h ?? -Infinity, y.h ?? -Infinity) } : {}),
      ...(x.l !== undefined || y.l !== undefined ? { l: Math.min(x.l ?? Infinity, y.l ?? Infinity) } : {}),
      ...(y.c ?? x.c) !== undefined ? { c: y.c ?? x.c } : {},
    });
  }
  return [...map.values()].sort((p, q) => p.t - q.t);
}

/**
 * NYSE session windows: each trading day's bar covers from the previous trading day's close to
 * that day's close (16:00 New York, 13:00 on early closes), so evening, overnight and weekend
 * trading on chain lands in the next session's bar and the close is the price at the NYSE close.
 * `t` is the 9:30 New York open of the day, as for every stock bar in this folder.
 * Only windows that have ended by `toMs` are returned.
 */
export type SessionWindow = { date: string; t: string; start: number; end: number };
export function sessionWindows(fromMs: number, toMs: number): SessionWindow[] {
  const out: SessionWindow[] = [];
  let day = addDays(newYorkParts(new Date(fromMs)).date, -10);
  const last = newYorkParts(new Date(toMs)).date;
  let prevClose: number | undefined;
  while (day <= last) {
    const s = isTradingDay("XNYS", day) ? sessionHours(day) : null;
    if (s) {
      const end = s.close.getTime();
      if (prevClose !== undefined && end > fromMs && end <= toMs) out.push({ date: day, t: newYorkTimeToUtc(day, 9, 30).toISOString(), start: prevClose, end });
      prevClose = end;
    }
    day = addDays(day, 1);
  }
  return out;
}

/**
 * Daily bars from Chainlink rounds. For each session window: the open is the price carried in from
 * the last round before the window (or the first round in it), high and low span that price and
 * every round in the window, and the close is the last round at or before the NYSE close. A
 * session with no round at all inside its window is skipped and reported: the feed said nothing
 * that day, so no bar is made up.
 */
export function feedBars(rounds: Round[], windows: SessionWindow[]): { bars: PriceBar[]; noRound: string[] } {
  const bars: PriceBar[] = [];
  const noRound: string[] = [];
  let i = 0;
  let carried: Round | undefined;
  for (const w of windows) {
    while (i < rounds.length && rounds[i].updatedAt * 1000 <= w.start) carried = rounds[i++];
    const inside: Round[] = [];
    while (i < rounds.length && rounds[i].updatedAt * 1000 <= w.end) inside.push(rounds[i++]);
    if (!inside.length) {
      if (carried) noRound.push(w.date);
      continue;
    }
    const prices = [...(carried ? [carried.answer] : []), ...inside.map((r) => r.answer)];
    bars.push({ t: w.t, o: prices[0], h: Math.max(...prices), l: Math.min(...prices), c: inside[inside.length - 1].answer });
    carried = inside[inside.length - 1];
  }
  return { bars, noRound };
}

/** Time ranges (ms) whose swaps were all read. */
export type Coverage = { from: number; to: number }[];
const covered = (cov: Coverage, w: SessionWindow) => cov.some((c) => w.start >= c.from && w.end <= c.to);
const hoursIn = (hours: HourBucket[], w: SessionWindow) => hours.filter((h) => h.t * 1000 >= w.start && (h.t + 3600) * 1000 <= w.end);

/**
 * Daily bars from pool hours: open the volume-weighted price of the first hour with priced trades,
 * close that of the last, high and low the extreme prices after any priced swap, volume all USDC
 * traded. A session with fewer than `minTrades` priced trades is skipped (`thin`); a session whose
 * swaps were not all read is skipped too (`unread`).
 */
export function poolBars(hours: HourBucket[], windows: SessionWindow[], cov: Coverage, minTrades = MIN_POOL_TRADES): { bars: PriceBar[]; thin: string[]; unread: string[] } {
  const bars: PriceBar[] = [];
  const thin: string[] = [];
  const unread: string[] = [];
  for (const w of windows) {
    if (!covered(cov, w)) {
      unread.push(w.date);
      continue;
    }
    const hs = hoursIn(hours, w);
    const priced = hs.filter((h) => h.vwap !== undefined);
    if (priced.reduce((s, h) => s + h.pn, 0) < minTrades) {
      thin.push(w.date);
      continue;
    }
    const o = priced[0].vwap!;
    const c = priced[priced.length - 1].vwap!;
    const h = Math.max(o, c, ...priced.map((x) => x.h ?? -Infinity));
    const l = Math.min(o, c, ...priced.map((x) => x.l ?? Infinity));
    bars.push({ t: w.t, o, h, l, c, v: hs.reduce((s, x) => s + x.vol, 0) });
  }
  return { bars, thin, unread };
}

/** USDC volume per session from pool hours, only for sessions whose swaps were all read. */
export function attachVolume(bars: PriceBar[], windows: SessionWindow[], hours: HourBucket[], cov: Coverage): PriceBar[] {
  const byT = new Map(windows.map((w) => [w.t, w]));
  return bars.map((b) => {
    const w = byT.get(b.t);
    if (!w || !covered(cov, w)) return b;
    return { ...b, v: hoursIn(hours, w).reduce((s, x) => s + x.vol, 0) };
  });
}

// ---------------------------------------------------------------------------------------------
// Backfill file
// ---------------------------------------------------------------------------------------------

/** Hour row in the backfill file: [t, n, vol, pn, pvw, vwap, o, h, l, c] (null where no priced trade). */
export type HourRow = (number | null)[];
export type BackfillAsset = {
  feed?: {
    address: string;
    /** [phase, round, updatedAt (unix seconds), answer in USD] for every round read. */
    rounds: [number, number, number, number][];
    /** Last round read per phase. */
    lastRound: Record<string, number>;
  };
  pool?: {
    address: string;
    fromBlock: number;
    toBlock: number;
    /** Unix seconds of fromBlock and toBlock. */
    fromTime: number;
    toTime: number;
    swaps: number;
    spikes: number;
    hours: HourRow[];
  };
};
export type Backfill = { note: string; generatedAt: string; assets: Record<string, BackfillAsset> };

export const ONCHAIN_BACKFILL = backfillJson as unknown as Backfill;

export const hourToRow = (h: HourBucket): HourRow => [h.t, h.n, cents(h.vol), h.pn, cents(h.pvw), ...[h.vwap, h.o, h.h, h.l, h.c].map((x) => (x === undefined ? null : Number(x.toPrecision(8))))];
export function rowToHour(r: HourRow): HourBucket {
  const [t, n, vol, pn, pvw, vwap, o, h, l, c] = r;
  const opt = (k: string, v: number | null | undefined) => (typeof v === "number" ? { [k]: v } : {});
  return { t: t!, n: n!, vol: vol!, pn: pn!, pvw: pvw!, ...opt("vwap", vwap), ...opt("o", o), ...opt("h", h), ...opt("l", l), ...opt("c", c) };
}
const cents = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Run-time read
// ---------------------------------------------------------------------------------------------

export type OnchainHistory = {
  daily?: PriceBar[];
  source?: Source;
  /** Current on-chain price from the feed or the oracle. */
  current?: { value: number; asOf: IsoDateTime; label: string; source: Source };
  /** Pool price and premium against the current price, at the same block. */
  facts: Fact[];
  problems: string[];
  /** Read cost, for the run log. */
  requests: number;
};

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const r2 = (x: number) => Math.round(x * 100) / 100;
const roundPx = (x: number) => (Math.abs(x) >= 1 ? r2(x) : Number(x.toPrecision(6)));
const feedName = (f: FeedRef) => `Chainlink "${f.description}" feed ${f.address} on Base`;

/**
 * Reads one asset's on-chain price history: backfill plus the tail after it. Never throws:
 * failures are problem lines and a missing part is simply absent.
 */
export async function fetchOnchainHistory(assetId: string, deps: DataDeps, backfill: Backfill = ONCHAIN_BACKFILL): Promise<OnchainHistory> {
  const cfg = ONCHAIN_ASSETS[assetId];
  const problems: string[] = [];
  const facts: Fact[] = [];
  if (!cfg) return { facts, problems: [`${assetId}: no on-chain price source configured`], requests: 0 };
  const rpc = new RpcClient(deps, deps.env[BASE_RPC_ENV]?.trim() || DEFAULT_BASE_RPC_URL);
  const deadline = deps.now().getTime() + ONCHAIN_BUDGET_MS;
  const sym = cfg.token.symbol;
  const bf = backfill.assets[assetId] ?? {};
  const out = (x: Partial<OnchainHistory>): OnchainHistory => ({ facts, problems, requests: rpc.requests, ...x });

  // 1. Head block and chain.
  let head: number;
  let headTime: number;
  try {
    const [chain, blk] = await rpc.batch([
      { method: "eth_chainId", params: [] },
      { method: "eth_getBlockByNumber", params: ["latest", false] },
    ]);
    if (Number(BigInt(String(chain.result))) !== BASE_CHAIN_ID) throw new Error(`chain id ${String(chain.result)} is not Base (8453)`);
    const b = blk.result as { number?: string; timestamp?: string } | undefined;
    if (!b?.number || !b.timestamp) throw new Error("no latest block");
    head = Number(BigInt(b.number));
    headTime = Number(BigInt(b.timestamp));
  } catch (e) {
    problems.push(`${assetId}: on-chain price read failed (${e instanceof Error ? e.message : "unknown"}), no reading`);
    return out({});
  }
  const B = hexBlock(head);

  // 2. Current price, contract checks and the pool price, all at block B.
  const calls: RpcCall[] = [ethCall(cfg.pool.address, SELECTORS.token0, B), ethCall(cfg.pool.address, SELECTORS.token1, B), ethCall(cfg.pool.address, SELECTORS.slot0, B)];
  if (cfg.feed) calls.push(...(["description", "decimals", "latestRoundData", "phaseId"] as const).map((k) => ethCall(cfg.feed!.address, SELECTORS[k], B)));
  if (cfg.oracle) calls.push(ethCall(cfg.oracle.address, SELECTORS.price, B), ethCall(cfg.oracle.baseFeed, SELECTORS.latestRoundData, B));
  let latest: RoundData | undefined;
  let phase = 0;
  let poolPrice: number | undefined;
  const cur: { current?: OnchainHistory["current"] } = {};
  try {
    const a = await rpc.batch(calls);
    const t0 = wordAddress(hexResult(a[0], "pool token0"));
    const t1 = wordAddress(hexResult(a[1], "pool token1"));
    if (t0 !== USDC.address || t1 !== cfg.token.address) throw new Error(`pool ${short(cfg.pool.address)} holds ${short(t0)} and ${short(t1)}, not USDC and ${sym}`);
    try {
      poolPrice = sqrtPriceToUsd(word(hexResult(a[2], "pool slot0"), 0), cfg.token.decimals);
    } catch (e) {
      problems.push(`${assetId}: pool price failed (${e instanceof Error ? e.message : "unknown"}), no pool premium`);
    }
    if (cfg.feed) {
      const desc = decodeString(hexResult(a[3], "feed description"));
      const dec = Number(word(hexResult(a[4], "feed decimals"), 0));
      if (desc !== cfg.feed.description || dec !== cfg.feed.decimals) throw new Error(`feed ${short(cfg.feed.address)} says "${desc.slice(0, 40)}" with ${dec} decimals, expected "${cfg.feed.description}" with ${cfg.feed.decimals}`);
      latest = decodeRound(hexResult(a[5], "latestRoundData"));
      phase = Number(word(hexResult(a[6], "phaseId"), 0));
      const value = Number(latest.answer) / 10 ** dec;
      const rid = `${phaseOf(latest.roundId)}.${aggRoundOf(latest.roundId)}`;
      if (value > 0 && latest.updatedAt > 0) {
        const source: Source = { name: `${feedName(cfg.feed)}, round ${rid} (read at block ${head})`, url: basescan(cfg.feed.address), display: true };
        cur.current = { value: roundPx(value), asOf: iso(Math.min(latest.updatedAt, headTime)), label: `On-chain price of ${sym} on Base (Chainlink "${cfg.feed.description}" feed, round ${rid}), not ${cfg.underlying}`, source };
      }
    }
    if (cfg.oracle) {
      const o = cfg.oracle;
      const i = cfg.feed ? 7 : 3;
      const value = morphoOraclePrice(word(hexResult(a[i], "oracle price"), 0), o.loanDecimals, o.collateralDecimals);
      const upd = decodeRound(hexResult(a[i + 1], "oracle feed latestRoundData")).updatedAt;
      if (value > 0) {
        const scale = morphoOracleScale(o.loanDecimals, o.collateralDecimals);
        const source: Source = {
          name: `Morpho market oracle ${o.address} on Base (market ${short(o.morphoMarket)} on Morpho Blue ${short(MORPHO_BLUE)}), price() at block ${head}, scaled by 1e${scale} (36 + ${o.loanDecimals} USDC decimals - ${o.collateralDecimals} ${sym} decimals)`,
          url: basescan(o.address),
          display: true,
        };
        cur.current = { value: roundPx(value), asOf: iso(upd > 0 ? Math.min(upd, headTime) : headTime), label: `On-chain price of ${sym} on Base (Morpho market oracle, the price Morpho liquidates on), not ${cfg.underlying}`, source };
      }
    }
  } catch (e) {
    problems.push(`${assetId}: on-chain price read failed (${e instanceof Error ? e.message : "unknown"}), no reading`);
    return out({});
  }
  const current = cur.current;
  if (poolPrice !== undefined && poolPrice > 0) {
    const src: Source = { name: `${sym}/USDC ${cfg.pool.venue} ${cfg.pool.address} on Base, slot0 at block ${head}`, url: basescan(cfg.pool.address), display: true };
    facts.push({ id: "px.pool.last", kind: "price", label: `Price in the main ${sym}/USDC pool on Base at block ${head} (on-chain, not ${cfg.underlying})`, value: roundPx(poolPrice), unit: "USD", source: src, asOf: iso(headTime) });
    if (current) {
      const what = cfg.oracle ? "Morpho oracle" : "Chainlink feed";
      facts.push({ id: "px.pool.premium", kind: "price", label: `${sym}/USDC pool price above (+) or below (-) the ${what} price, block ${head}`, value: r2((poolPrice / current.value - 1) * 100), unit: "%", source: { ...src, name: `${src.name}, compared with ${current.source.name}` }, asOf: iso(headTime) });
    }
  }

  // 3. Chainlink rounds after the backfill.
  let rounds: Round[] = (bf.feed?.rounds ?? []).map(([p, r, u, a]) => ({ phase: p, round: r, updatedAt: u, answer: a }));
  if (cfg.feed && latest) {
    try {
      const want: { phase: number; round: number }[] = [];
      const lastBf = Math.max(0, ...Object.keys(bf.feed?.lastRound ?? {}).map(Number));
      for (let p = Math.max(1, lastBf); p <= phase; p++) {
        let end: number;
        if (p === phase) end = aggRoundOf(latest.roundId);
        else {
          const agg = wordAddress(String(await rpc.call("eth_call", [{ to: cfg.feed.address, data: SELECTORS.phaseAggregators + u256(p) }, B])));
          end = Number(word(String(await rpc.call("eth_call", [{ to: agg, data: SELECTORS.latestRound }, B])), 0));
        }
        for (let r = (bf.feed?.lastRound?.[String(p)] ?? 0) + 1; r <= end; r++) want.push({ phase: p, round: r });
      }
      if (want.length > MAX_TAIL_ROUNDS) {
        problems.push(`${assetId}: ${want.length} Chainlink rounds after the backfill, only the newest ${MAX_TAIL_ROUNDS} read; regenerate onchain-backfill.json`);
        want.splice(0, want.length - MAX_TAIL_ROUNDS);
      }
      let failed = 0;
      for (let k = 0; k < want.length; k += ROUNDS_PER_BATCH) {
        if (deps.now().getTime() > deadline) throw new Error(`time budget of ${ONCHAIN_BUDGET_MS / 1000} s used up after ${k} of ${want.length} rounds`);
        const part = want.slice(k, k + ROUNDS_PER_BATCH);
        const ans = await rpc.batch(part.map((w) => ethCall(cfg.feed!.address, SELECTORS.getRoundData + u256(proxyRoundId(w.phase, w.round)), B)));
        ans.forEach((x, j) => {
          try {
            const d = decodeRound(hexResult(x, "getRoundData"));
            rounds.push({ phase: part[j].phase, round: part[j].round, updatedAt: d.updatedAt, answer: Number(d.answer) / 10 ** cfg.feed!.decimals });
          } catch {
            failed++;
          }
        });
      }
      if (failed) problems.push(`${assetId}: ${failed} Chainlink rounds could not be read and were left out`);
    } catch (e) {
      problems.push(`${assetId}: Chainlink rounds after the backfill not read (${e instanceof Error ? e.message : "unknown"}); daily bars end where the backfill ends`);
    }
    rounds = stitchRounds(rounds);
  }

  // 4. Pool swaps after the backfill (only for quiet pools).
  let hours = (bf.pool?.hours ?? []).map(rowToHour);
  const cov: Coverage = bf.pool ? [{ from: bf.pool.fromTime * 1000, to: bf.pool.toTime * 1000 }] : [];
  let poolFrom = bf.pool?.fromBlock;
  let poolTo = bf.pool?.toBlock;
  if (cfg.poolTail) {
    let from = (bf.pool?.toBlock ?? head - MAX_TAIL_LOG_REQUESTS * GETLOGS_MAX_BLOCKS) + 1;
    if (head - from + 1 > MAX_TAIL_LOG_REQUESTS * GETLOGS_MAX_BLOCKS) {
      const newFrom = head - MAX_TAIL_LOG_REQUESTS * GETLOGS_MAX_BLOCKS + 1;
      problems.push(`${assetId}: pool swaps in blocks ${from} to ${newFrom - 1} not read (more than ${MAX_TAIL_LOG_REQUESTS} log requests after the backfill); sessions in that gap have no bar, regenerate onchain-backfill.json`);
      from = newFrom;
    }
    const ranges: [number, number][] = [];
    for (let b = from; b <= head; b += GETLOGS_MAX_BLOCKS) ranges.push([b, Math.min(head, b + GETLOGS_MAX_BLOCKS - 1)]);
    const swaps: Swap[] = [];
    let readTo = from - 1;
    try {
      for (let k = 0; k < ranges.length; k += LOGS_PER_BATCH) {
        if (deps.now().getTime() > deadline) throw new Error(`time budget of ${ONCHAIN_BUDGET_MS / 1000} s used up at block ${ranges[k][0]}`);
        const part = ranges.slice(k, k + LOGS_PER_BATCH);
        const ans = await rpc.batch(part.map(([a, b]) => ({ method: "eth_getLogs", params: [{ address: cfg.pool.address, topics: [SWAP_TOPIC], fromBlock: hexBlock(a), toBlock: hexBlock(b) }] })));
        for (let j = 0; j < ans.length; j++) {
          const x = ans[j];
          if (x.error || !Array.isArray(x.result)) throw new Error(`eth_getLogs for blocks ${part[j][0]} to ${part[j][1]} failed (${x.error?.message?.slice(0, 80) ?? "no list"})`);
          for (const log of x.result as RawLog[]) {
            if (!log.blockTimestamp) throw new Error("the RPC gives no block timestamps on logs");
            const s = decodeSwap(log, cfg.token.decimals);
            if (s) swaps.push(s);
          }
          readTo = part[j][1];
        }
      }
    } catch (e) {
      problems.push(`${assetId}: pool swaps after block ${readTo} not read (${e instanceof Error ? e.message : "unknown"}); sessions after that have no bar`);
    }
    if (readTo >= from) {
      let toTime = headTime;
      if (readTo !== head) {
        try {
          const b = (await rpc.call("eth_getBlockByNumber", [hexBlock(readTo), false])) as { timestamp?: string };
          toTime = Number(BigInt(b.timestamp ?? "0x0"));
        } catch {
          toTime = swaps.length ? swaps[swaps.length - 1].time : 0;
        }
      }
      const fromTime = bf.pool && from === bf.pool.toBlock + 1 ? bf.pool.toTime : Math.min(...swaps.map((s) => s.time), toTime);
      const tail = bucketSwaps(swaps);
      hours = mergeHours(hours, tail.hours);
      if (bf.pool && from === bf.pool.toBlock + 1) cov[0] = { from: cov[0].from, to: toTime * 1000 };
      else cov.push({ from: fromTime * 1000, to: toTime * 1000 });
      poolFrom ??= from;
      poolTo = readTo;
    }
  }

  // 5. Daily bars on the NYSE session calendar.
  const firstMs = cfg.bars === "feed" ? (rounds[0]?.updatedAt ?? headTime) * 1000 : (hours[0]?.t ?? headTime) * 1000;
  const windows = sessionWindows(firstMs, headTime * 1000);
  const poolNote = poolFrom !== undefined && poolTo !== undefined ? `${sym}/USDC ${cfg.pool.venue} ${cfg.pool.address} (swaps in blocks ${poolFrom} to ${poolTo})` : undefined;
  let daily: PriceBar[] = [];
  let source: Source;
  if (cfg.bars === "feed" && cfg.feed) {
    const fb = feedBars(rounds, windows);
    daily = attachVolume(fb.bars, windows, hours, cov);
    if (fb.noRound.length) problems.push(`${assetId}: ${fb.noRound.length} NYSE sessions without any Chainlink round were skipped (${fb.noRound.slice(-3).join(", ")}${fb.noRound.length > 3 ? ", ..." : ""})`);
    const first = rounds[0];
    const last = rounds[rounds.length - 1];
    source = {
      name: `${feedName(cfg.feed)}, rounds ${first ? `${first.phase}.${first.round}` : "?"} to ${last ? `${last.phase}.${last.round}` : "?"}, daily bars on NYSE sessions built by Stackday${poolNote ? `; volume in USDC from the ${poolNote}` : ""}`,
      url: basescan(cfg.feed.address),
      display: true,
    };
    const covEnd = Math.max(0, ...cov.map((c) => c.to));
    if (!cfg.poolTail) {
      problems.push(
        covEnd
          ? `${assetId}: ${sym} pool volume after ${iso(covEnd / 1000).slice(0, 16)} UTC is not read at run time (thousands of swaps a day); later sessions have no volume, regenerate onchain-backfill.json for current volume`
          : `${assetId}: no ${sym} pool volume in the backfill, no volume reading`,
      );
    }
  } else {
    // Sessions that began before the first swap read are before the history, not a gap.
    const covFrom = Math.min(...cov.map((c) => c.from));
    const pb = poolBars(hours, windows.filter((w) => w.start >= covFrom), cov);
    daily = pb.bars;
    if (pb.thin.length) problems.push(`${assetId}: ${pb.thin.length} NYSE sessions with fewer than ${MIN_POOL_TRADES} priced ${sym} pool trades were skipped (${pb.thin.slice(-3).join(", ")}${pb.thin.length > 3 ? ", ..." : ""})`);
    if (pb.unread.length) problems.push(`${assetId}: ${pb.unread.length} NYSE sessions whose pool swaps were not read have no bar`);
    source = {
      name: `${poolNote ?? `${sym}/USDC ${cfg.pool.venue} ${cfg.pool.address}`} on Base, volume-weighted hourly prices, single-swap spikes ignored, sessions with fewer than ${MIN_POOL_TRADES} trades skipped, daily bars on NYSE sessions built by Stackday`,
      url: basescan(cfg.pool.address),
      display: true,
    };
  }
  if (!daily.length) problems.push(`${assetId}: no on-chain daily bars could be built, no reading`);
  return out({ ...(daily.length ? { daily } : {}), source, ...(current ? { current } : {}) });
}
