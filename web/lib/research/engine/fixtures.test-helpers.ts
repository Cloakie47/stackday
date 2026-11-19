import type { AssetResearchInput, Fact } from "../types.ts";
import type { ModelFn, ModelRequest } from "./model.ts";

/** Small hand-made inputs for tests. Numbers here are test fixtures, not market data. */

const src = { name: "Test fixture" };

export function makeFacts(assetId: string, last = 100): Fact[] {
  const asOf = "2026-11-18T21:00:00Z";
  return [
    { id: "px.last", kind: "price", label: `${assetId} last close`, value: last, unit: "USD", source: src, asOf },
    { id: "px.chg.1d", kind: "price", label: "Change over 1 day", value: 1.5, unit: "%", source: src, asOf },
    { id: "ind.rsi14", kind: "indicator", label: "RSI 14", value: 58.2, source: src, asOf },
    { id: "ind.sma50", kind: "indicator", label: "50 day average", value: last * 0.95, unit: "USD", source: src, asOf },
    { id: "news.1", kind: "news", label: "Company reports quarterly results", value: "headline", source: { name: "Reuters" }, asOf, quote: "Revenue rose from a year earlier." },
  ];
}

export function makeInput(assetId: string, date: string, opts: Partial<AssetResearchInput> & { last?: number; changePct?: number } = {}): AssetResearchInput {
  const last = opts.last ?? 100;
  return {
    assetId,
    date,
    marketOpenToday: opts.marketOpenToday ?? true,
    series: {},
    indicators: {
      "1d": { last, changePct: { "1d": opts.changePct ?? 1.5 }, atr14: last * 0.02, support: [last * 0.97], resistance: [last * 1.06] },
    },
    facts: opts.facts ?? makeFacts(assetId, last),
    problems: [],
  };
}

export function goodReading(over: Record<string, unknown> = {}) {
  const r = (text: string, ids = ["px.last"]) => ({ text, factIds: ids });
  return {
    action: "hold",
    confidence: "medium",
    summaryLines: ["Price closed near 100 after a 1.5% day.", "Momentum is steady with RSI near 58; results news is the main swing factor.", "Suggested action: hold."],
    reasons: [r("Price sits above its 50 day average.", ["px.last", "ind.sma50"]), r("RSI is neutral.", ["ind.rsi14"])],
    opportunities: [r("Results news was positive.", ["news.1"])],
    risks: [r("A reversal below the average would weaken the trend.", ["ind.sma50"])],
    scenarios: {
      bull: { ...r("Trend continues."), likelihood: "medium" },
      base: { ...r("Range holds.", ["ind.rsi14"]), likelihood: "medium" },
      bear: { ...r("Average breaks.", ["ind.sma50"]), likelihood: "low" },
    },
    outlook: {
      "1h": { text: "", factIds: [], stance: "no-view" },
      "1d": { text: "Steady after a 1.5% gain.", factIds: ["px.chg.1d"], stance: "neutral" },
      "1w": { text: "Momentum neutral.", factIds: ["ind.rsi14"], stance: "neutral" },
      "1m": { text: "Above the average.", factIds: ["ind.sma50"], stance: "positive" },
      "1y": { text: "", factIds: [], stance: "no-view" },
      "5y": { text: "", factIds: [], stance: "no-view" },
    },
    materialEvent: false,
    injectionFactIds: [],
    ...over,
  };
}

/** A fake model: answers with `answer(req)` and records every request. */
export function fakeModel(answer: (req: ModelRequest) => unknown, costUsd = 0.002) {
  const calls: ModelRequest[] = [];
  const fn: ModelFn = async (req) => {
    calls.push(req);
    const a = answer(req);
    const text = typeof a === "string" ? a : JSON.stringify(a);
    return { text, model: req.tier, stopReason: "end_turn", usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }, costUsd };
  };
  return { fn, calls };
}
