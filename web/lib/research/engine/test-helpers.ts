import type { AssetResearchInput, ChartRead, Fact, MarketResearchInput } from "../types.ts";
import type { ModelFn, ModelRequest } from "./model.ts";

/** Small hand-made inputs for tests. Numbers here are test fixtures, not market data. No network. */

const src = { name: "Test fixture" };
const asOf = "2026-11-19T21:00:00Z";

export function chartRead(interval: "1d" | "1w" | "1mo", last = 100, over: Partial<ChartRead> = {}): ChartRead {
  return {
    interval,
    trend: "range",
    support: [last * 0.97, last * 0.94],
    resistance: [last * 1.04, last * 1.08],
    positionInRange: 0.43,
    patterns: [],
    volatility: { regime: "normal", atrPercentile: 0.5, volPercentile: 0.5 },
    factIds: ["px.1d.last"],
    ...over,
  };
}

export function makeFacts(last = 100): Fact[] {
  return [
    { id: "px.1d.last", kind: "price", label: "Last daily close", value: last, unit: "USD", source: src, asOf },
    { id: "ind.1d.atr14", kind: "indicator", label: "ATR 14", value: last * 0.02, unit: "USD", source: src, asOf },
    { id: "ind.1d.rsi14", kind: "indicator", label: "RSI 14", value: 58.2, source: src, asOf },
    { id: "news.1", kind: "news", label: "Company reports quarterly results", value: "headline", source: { name: "Reuters" }, asOf, quote: "Revenue rose from a year earlier." },
    { id: "news.geo", kind: "news", label: "New export rules discussed", value: "headline", source: { name: "Reuters" }, asOf, tags: ["geopolitics", "export-controls"] },
    { id: "filing.1", kind: "filing", label: "Quarterly report filed", value: "10-Q", source: { name: "SEC EDGAR" }, asOf },
    { id: "fund.pe", kind: "fundamental", label: "Price to earnings", value: 31.5, source: src, asOf },
    { id: "flow.etf", kind: "flow", label: "Fund flows over the week", value: "inflow", source: src, asOf },
  ];
}

export function makeInput(assetId: string, date: string, opts: { last?: number; bar1?: number; marketOpenToday?: boolean; facts?: Fact[]; chart?: AssetResearchInput["chart"] } = {}): AssetResearchInput {
  const last = opts.last ?? 100;
  return {
    assetId,
    date,
    marketOpenToday: opts.marketOpenToday ?? true,
    series: {},
    indicators: { "1d": { last, changePct: { bar1: opts.bar1 ?? 0.005 }, atr14: last * 0.02, rsi14: 58.2 } },
    chart: opts.chart ?? { "1d": chartRead("1d", last), "1w": chartRead("1w", last), "1mo": chartRead("1mo", last) },
    facts: opts.facts ?? makeFacts(last),
    calendar: [{ id: "cal.2026-11-26.pce", date: "2026-11-26", kind: "pce", name: "PCE inflation", assetIds: [], source: src }],
    problems: [],
  };
}

export function makeMarket(date: string): MarketResearchInput {
  return {
    date,
    facts: [
      { id: "macro.dgs10", kind: "macro", label: "10-year Treasury yield", value: 4.1, unit: "%", source: { name: "FRED" }, asOf },
      { id: "macro.vix", kind: "macro", label: "VIX", value: 17.4, source: src, asOf },
    ],
    calendar: [],
    problems: [],
  };
}

/** A fake model: answers with `answer(req)` and records every request. Never touches the network. */
export function fakeModel(answer: (req: ModelRequest) => unknown, costUsd = 0.002) {
  const calls: ModelRequest[] = [];
  const fn: ModelFn = async (req) => {
    calls.push(req);
    const a = answer(req);
    if (a instanceof Error) throw a;
    const text = typeof a === "string" ? a : JSON.stringify(a);
    return { text, model: req.model, stopReason: "end_turn", usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }, costUsd };
  };
  return { fn, calls };
}

const r = (text: string, ...factIds: string[]) => ({ text, factIds });

export function goodDaily(over: Record<string, unknown> = {}) {
  return {
    view: "accumulate",
    conviction: "medium",
    summaryLines: ["Price closed near 100 after a quiet day.", "View: accumulate with medium conviction."],
    reasons: [r("Price holds above its nearest support with RSI near 58.", "px.1d.last", "ind.1d.rsi14")],
    risks: [r("Results news could swing the price.", "news.1")],
    injectionFactIds: [],
    ...over,
  };
}

export const analystAnswer = (role: string) => {
  const cite: Record<string, string> = { technical: "px.1d.last", macro: "macro.dgs10", news: "news.1", fundamentals: "fund.pe" };
  const base = { stance: "neutral", points: [r(`The ${role} picture is mixed.`, cite[role])], injectionFactIds: [] };
  return role === "technical" ? { ...base, chart: { "1d": [r("Daily bars show a range.", "px.1d.last")], "1w": [], "1mo": [] } } : base;
};

export function goodDraft(over: Record<string, unknown> = {}, probs: [number, number, number] = [35, 45, 20]) {
  return {
    recap: [r("Price rose over the week on results news.", "px.1d.last", "news.1")],
    chart: { "1d": [r("Daily bars show a range between support and resistance.", "px.1d.last")], "1w": [], "1mo": [] },
    market: [r("Yields held steady near 4.1%.", "macro.dgs10")],
    news: [r("Export rules were discussed during the week.", "news.geo")],
    scenarios: {
      bull: { text: "Price clears resistance on firm demand.", factIds: ["px.1d.last"], probability: probs[0], levels: [104], trigger: "A daily close above resistance" },
      base: { text: "Price stays in the range.", factIds: ["ind.1d.atr14"], probability: probs[1], levels: [97, 104], trigger: "No surprise in the data" },
      bear: { text: "Weak data pushes price below support.", factIds: ["macro.dgs10"], probability: probs[2], levels: [97], trigger: "A daily close below support" },
    },
    view: { view: "accumulate", conviction: "medium", reasons: [r("Support held and results were firm.", "px.1d.last", "news.1")] },
    ...over,
  };
}

export function goodSummary(ids: string[]) {
  return {
    marketSummaryLines: ["Yields steady and volatility near normal."],
    developments: [r("The 10-year yield held steady.", "macro.dgs10")],
    ranking: [...ids].reverse(),
    ideas: ids.map((id) => ({ assetId: id, reasons: [r("Support held this week.", `${id}:px.1d.last`)], dependsOn: r("Depends on calm yields.", `${id}:macro.dgs10`), mainRisk: r("A weak data print.", `${id}:news.1`) })),
    splitWhy: { cautious: r("Leans on core assets while yields are calm.", "macro.dgs10"), growth: r("Gives more room to growth assets.", "macro.vix") },
  };
}

/** Routes a fake weekly answer by step name. `over` replaces the answer for a step. */
export function weeklyAnswers(over: Record<string, (req: ModelRequest) => unknown> = {}) {
  return (req: ModelRequest): unknown => {
    if (over[req.step]) return over[req.step](req);
    if (req.step.startsWith("weekly.analyst.")) return analystAnswer(req.step.split(".")[2]);
    if (req.step === "weekly.bull" || req.step === "weekly.bull.rebuttal") return { points: [r("Results were firm.", "news.1")] };
    if (req.step === "weekly.bear" || req.step === "weekly.bear.rebuttal") return { points: [r("Yields could rise.", "macro.dgs10")] };
    if (req.step === "weekly.editor" || req.step === "weekly.revise") return goodDraft();
    if (req.step === "weekly.review") return { approve: true, sendBack: "none", notes: [] };
    if (req.step === "weekly.summary") {
      const ids = ((req.schema as { properties: { ranking: { items: { enum: string[] } } } }).properties.ranking.items.enum);
      return goodSummary(ids);
    }
    throw new Error(`unexpected step ${req.step}`);
  };
}
