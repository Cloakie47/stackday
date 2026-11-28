import type { Fact, IsoDate } from "../types.ts";
import { GENERIC_USER_AGENT, RateLimiter, getJson, type DataDeps } from "./deps.ts";

/**
 * Crypto flows (spec section 3.3), turned into `Fact`s of kind "flow". Server-only, public
 * endpoints only, no keys:
 *
 * - Perpetual futures funding rates: Binance USD-M futures public API, with Deribit's public API
 *   as the fallback (Binance refuses some regions, including US cloud regions, with HTTP 451).
 * - Stablecoin supply: DefiLlama stablecoins API (sum of all USD-pegged stablecoins).
 *
 * Bitcoin and Ether ETF flows are a "no reading" line: we found no free public source with clear
 * terms for automated use. Nothing is estimated or filled in.
 */

const DAY = 86_400_000;
export const flowLimiter = new RateLimiter(300);

export const BINANCE_FUNDING_DOCS = "https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History";
export const DERIBIT_FUNDING_DOCS = "https://docs.deribit.com/#public-get_funding_rate_history";
export const DEFILLAMA_STABLECOINS_DOCS = "https://api-docs.defillama.com/";

export const FLOW_ASSETS: Record<string, { binance: string; deribit: string; name: string }> = {
  mcbBTC: { binance: "BTCUSDT", deribit: "BTC-PERPETUAL", name: "Bitcoin" },
  mWETH: { binance: "ETHUSDT", deribit: "ETH-PERPETUAL", name: "Ether" },
};

export const ETF_FLOWS_PROBLEM = "ETF flows: no free public source with clear terms for automated use, no reading";

/** End of the window: the run date's end, never later than now or the run's cut-off, floored to the hour. */
export function windowEnd(date: IsoDate, now: Date, cutoffMs?: number): number {
  const end = Math.min(now.getTime(), Date.parse(`${date}T23:59:59Z`), cutoffMs ?? Infinity);
  return Math.floor(end / 3_600_000) * 3_600_000;
}

export const binanceFundingUrl = (symbol: string, endMs: number) => `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&endTime=${endMs}&limit=21`;
export const deribitFundingUrl = (instrument: string, endMs: number) =>
  `https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=${instrument}&start_timestamp=${endMs - 7 * DAY}&end_timestamp=${endMs}`;
export const DEFILLAMA_STABLECOINS_URL = "https://stablecoins.llama.fi/stablecoins?includePrices=false";

export type FundingReading = { last8h: number; lastAt: number; annualised7d: number; samples: number; venue: string; url: string };

/** Binance: rows of { fundingTime (ms), fundingRate (string, per 8 hours) }, oldest first. */
export function parseBinanceFunding(raw: unknown): { t: number; rate: number }[] {
  if (!Array.isArray(raw)) throw new Error("Binance funding: unexpected shape");
  return raw
    .map((r) => ({ t: Number((r as { fundingTime?: unknown }).fundingTime), rate: Number((r as { fundingRate?: unknown }).fundingRate) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.rate))
    .sort((a, b) => a.t - b.t);
}

/** Deribit: hourly rows of { timestamp, interest_8h, interest_1h }. */
export function parseDeribitFunding(raw: unknown): { t: number; i8h: number; i1h: number }[] {
  const res = (raw as { result?: unknown })?.result;
  if (!Array.isArray(res)) throw new Error("Deribit funding: unexpected shape");
  return res
    .map((r) => ({ t: Number(r.timestamp), i8h: Number(r.interest_8h), i1h: Number(r.interest_1h) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.i8h) && Number.isFinite(r.i1h))
    .sort((a, b) => a.t - b.t);
}

/**
 * Latest 8-hour funding rate and the 7-day average, annualised: Binance 8-hour rates times
 * 3 x 365; Deribit hourly rates times 24 x 365. Both as percent.
 */
export async function fetchFunding(assetId: string, date: IsoDate, deps: DataDeps, cutoffMs?: number): Promise<{ reading?: FundingReading; problems: string[] }> {
  const cfg = FLOW_ASSETS[assetId];
  if (!cfg) return { problems: [] };
  const end = windowEnd(date, deps.now(), cutoffMs);
  const headers = { "User-Agent": GENERIC_USER_AGENT, Accept: "application/json" };
  const errors: string[] = [];
  try {
    await flowLimiter.wait(deps);
    const url = binanceFundingUrl(cfg.binance, end);
    const rows = parseBinanceFunding(await getJson(deps, url, headers)).filter((r) => r.t <= end && r.t > end - 7 * DAY);
    if (rows.length < 3) throw new Error("too few funding periods");
    const mean = rows.reduce((s, r) => s + r.rate, 0) / rows.length;
    const last = rows[rows.length - 1];
    return { reading: { last8h: last.rate * 100, lastAt: last.t, annualised7d: mean * 3 * 365 * 100, samples: rows.length, venue: `Binance USD-M futures (${cfg.binance})`, url: BINANCE_FUNDING_DOCS }, problems: [] };
  } catch (e) {
    errors.push(`Binance: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  try {
    await flowLimiter.wait(deps);
    const rows = parseDeribitFunding(await getJson(deps, deribitFundingUrl(cfg.deribit, end), headers)).filter((r) => r.t <= end);
    if (rows.length < 24) throw new Error("too few funding samples");
    const mean = rows.reduce((s, r) => s + r.i1h, 0) / rows.length;
    const last = rows[rows.length - 1];
    return { reading: { last8h: last.i8h * 100, lastAt: last.t, annualised7d: mean * 24 * 365 * 100, samples: rows.length, venue: `Deribit (${cfg.deribit})`, url: DERIBIT_FUNDING_DOCS }, problems: [] };
  } catch (e) {
    errors.push(`Deribit: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  return { problems: [`${assetId}: funding rate failed on every venue, no reading (${errors.join("; ")})`] };
}

export function fundingFacts(assetId: string, r: FundingReading): Fact[] {
  const name = FLOW_ASSETS[assetId]?.name ?? assetId;
  const source = { name: `${r.venue} public funding rate history`, url: r.url };
  const asOf = new Date(r.lastAt).toISOString();
  return [
    { id: "flow.funding.last", kind: "flow", label: `${name} perpetual funding rate, latest 8 hours (positive: longs pay shorts)`, value: Number(r.last8h.toFixed(4)), unit: "% per 8h", source, asOf, tags: ["funding"] },
    { id: "flow.funding.avg7d", kind: "flow", label: `${name} perpetual funding rate, 7-day average, annualised (${r.samples} readings)`, value: Math.round(r.annualised7d * 100) / 100, unit: "% a year", source, asOf, tags: ["funding"] },
  ];
}

export type StablecoinSupply = { total: number; prevDay: number; prevWeek: number; prevMonth: number; count: number };

/** Sums `circulating.peggedUSD` (and the previous day, week and month) over USD-pegged stablecoins. */
export function parseStablecoins(raw: unknown): StablecoinSupply {
  const list = (raw as { peggedAssets?: unknown })?.peggedAssets;
  if (!Array.isArray(list)) throw new Error("DefiLlama stablecoins: unexpected shape");
  const sum = { total: 0, prevDay: 0, prevWeek: 0, prevMonth: 0, count: 0 };
  const usd = (o: unknown) => {
    const v = Number((o as { peggedUSD?: unknown } | undefined)?.peggedUSD);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  for (const a of list as Record<string, unknown>[]) {
    if (a.pegType !== "peggedUSD") continue;
    const cur = usd(a.circulating);
    if (!cur) continue;
    sum.total += cur;
    sum.prevDay += usd(a.circulatingPrevDay);
    sum.prevWeek += usd(a.circulatingPrevWeek);
    sum.prevMonth += usd(a.circulatingPrevMonth);
    sum.count += 1;
  }
  if (!sum.count) throw new Error("DefiLlama stablecoins: no USD stablecoins");
  return sum;
}

/**
 * Stablecoin supply now. DefiLlama gives current figures only, so a run for an earlier date gets
 * a "no reading" line instead of today's numbers.
 */
export async function fetchStablecoins(date: IsoDate, deps: DataDeps): Promise<{ facts: Fact[]; problems: string[] }> {
  const now = deps.now();
  if (date < now.toISOString().slice(0, 10)) return { facts: [], problems: [`Stablecoin supply: only current figures are available, no reading for ${date}`] };
  try {
    await flowLimiter.wait(deps);
    const s = parseStablecoins(await getJson(deps, DEFILLAMA_STABLECOINS_URL, { "User-Agent": GENERIC_USER_AGENT, Accept: "application/json" }));
    const source = { name: "DefiLlama stablecoins API (sum of USD-pegged stablecoins)", url: DEFILLAMA_STABLECOINS_DOCS };
    const asOf = now.toISOString();
    const pct = (prev: number) => (prev > 0 ? Math.round((s.total / prev - 1) * 10000) / 100 : undefined);
    const facts: Fact[] = [{ id: "flow.stablecoins.total", kind: "flow", label: `Total USD stablecoin supply (${s.count} stablecoins)`, value: Math.round(s.total / 1e7) / 100, unit: "billion USD", source, asOf, tags: ["stablecoins"] }];
    for (const [k, prev, label] of [["chg7d", s.prevWeek, "7 days"], ["chg30d", s.prevMonth, "30 days"]] as const) {
      const v = pct(prev);
      if (v !== undefined) facts.push({ id: `flow.stablecoins.${k}`, kind: "flow", label: `Change in USD stablecoin supply over ${label}`, value: v, unit: "%", source, asOf, tags: ["stablecoins"] });
    }
    return { facts, problems: [] };
  } catch (e) {
    return { facts: [], problems: [`Stablecoin supply failed, no reading (${e instanceof Error ? e.message : "unknown error"})`] };
  }
}

/**
 * All flow facts for one asset. Only crypto assets have flows; gold's drivers come from FRED.
 * `cutoffMs`: the run's cut-off, so the funding window never reaches past it. The stablecoin supply
 * is a current reading only (see `fetchStablecoins`).
 */
export async function fetchFlows(assetId: string, date: IsoDate, deps: DataDeps, cutoffMs?: number): Promise<{ facts: Fact[]; problems: string[] }> {
  if (!FLOW_ASSETS[assetId]) return { facts: [], problems: [] };
  const funding = await fetchFunding(assetId, date, deps, cutoffMs);
  const stable = await fetchStablecoins(date, deps);
  return {
    facts: [...(funding.reading ? fundingFacts(assetId, funding.reading) : []), ...stable.facts],
    problems: [...funding.problems, ...stable.problems, `${assetId}: ${ETF_FLOWS_PROBLEM}`],
  };
}
