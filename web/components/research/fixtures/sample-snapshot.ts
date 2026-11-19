/**
 * SAMPLE DATA for local development of the Research pages. Used only when /api/research/snapshot
 * returns 404 (the engine branch is not merged yet). Every page that shows it carries a visible
 * "Sample data" banner because `kind` is "sample".
 *
 * No real market prices are invented here: the only prices are the Stackday testnet mock start
 * prices from web/lib/contracts.ts, and each fact says so in its source. The text is hand-written
 * demo copy, not model output and not a view on any real asset.
 */
import type { Action, Confidence, Fact, Outlook, ResearchNote, ResearchSnapshot, Stance, Timeframe } from "@/lib/research/types";
import { TIMEFRAMES } from "@/lib/research/types";
import { UNIVERSE } from "@/lib/research/universe";
import { ASSETS } from "@/lib/contracts";

export const SAMPLE_DATE = "2026-11-19";
export const SAMPLE_AT = "2026-11-19T21:05:00Z";

const MOCK_SOURCE = { name: "Stackday testnet mock feed (sample, not a market price)" };
const DEMO_SOURCE = { name: "Sample fixture (demo text, no real source)" };

type Seed = { action: Action; confidence: Confidence; stance: Stance; summary: string };

const SEEDS: Record<string, Seed> = {
  mAAPL: { action: "hold", confidence: "medium", stance: "neutral", summary: "Sample note. Steady trend in this demo data, with a product event as the opportunity and a high valuation as the risk. Suggested action: hold." },
  mNVDA: { action: "watch", confidence: "low", stance: "neutral", summary: "Sample note. Large swings in this demo data. Opportunity: demand for chips. Risk: a crowded trade. Suggested action: watch for a calmer entry." },
  mGOOGL: { action: "buy", confidence: "medium", stance: "positive", summary: "Sample note. Demo trend is up with room to the next level. Opportunity: search and cloud. Risk: regulation. Suggested action: buy with new money." },
  mMETA: { action: "hold", confidence: "medium", stance: "neutral", summary: "Sample note. Sideways in this demo data. Opportunity: ad growth. Risk: heavy spending plans. Suggested action: hold." },
  mMSFT: { action: "buy", confidence: "medium", stance: "positive", summary: "Sample note. Demo trend is steady. Opportunity: cloud demand. Risk: a slower quarter. Suggested action: buy with new money." },
  mAMZN: { action: "hold", confidence: "low", stance: "neutral", summary: "Sample note. Mixed signals in this demo data. Opportunity: margins. Risk: consumer spending. Suggested action: hold." },
  mTSLA: { action: "watch", confidence: "low", stance: "negative", summary: "Sample note. Falling in this demo data and very volatile. Opportunity: new products. Risk: sharp drops. Suggested action: watch." },
  mAMD: { action: "watch", confidence: "low", stance: "neutral", summary: "Sample note. Demo data near a resistance level. Opportunity: data centre chips. Risk: competition. Suggested action: watch for a break." },
  mMSTR: { action: "sell", confidence: "low", stance: "negative", summary: "Sample note. Moves with bitcoin, and the demo trend is down. Opportunity: a bitcoin rebound. Risk: deeper falls. Suggested action: sell or avoid new buys." },
  mSPCX: { action: "watch", confidence: "low", stance: "no-view", summary: "Sample note. Private company, so there is no public price and no levels. News only. Suggested action: watch." },
  mSPX: { action: "buy", confidence: "high", stance: "positive", summary: "Sample note. Broad market fund. Opportunity: steady regular buying. Risk: a market-wide fall. Suggested action: buy with new money." },
  mSGOV: { action: "hold", confidence: "high", stance: "neutral", summary: "Sample note. Cash-like Treasury fund: price barely moves and the return is interest. Suggested action: hold as a cushion." },
  mPAXG: { action: "hold", confidence: "medium", stance: "positive", summary: "Sample note. Gold is calm in this demo data. Opportunity: a hedge. Risk: no income. Suggested action: hold." },
  mcbBTC: { action: "watch", confidence: "low", stance: "neutral", summary: "Sample note. Bitcoin swings widely in this demo data. Opportunity: a rebound. Risk: deep falls. Suggested action: watch." },
  mWETH: { action: "watch", confidence: "low", stance: "negative", summary: "Sample note. Ether is weak in this demo data. Opportunity: network use. Risk: further falls. Suggested action: watch." },
};

const PREV: Partial<Record<string, Action>> = { mGOOGL: "hold", mMSTR: "hold", mWETH: "hold" };

function mockPrice(assetId: string): number | undefined {
  const a = ASSETS.find((x) => x.symbol === assetId);
  return a ? Number(a.startPrice) / 1e8 : undefined;
}

function outlook(stance: Stance): Record<Timeframe, Outlook> {
  const out = {} as Record<Timeframe, Outlook>;
  for (const tf of TIMEFRAMES) {
    const s: Stance = tf === "1h" ? "no-view" : stance;
    out[tf] = {
      stance: s,
      text:
        s === "no-view"
          ? "Sample: not enough intraday data in this demo to form a view."
          : `Sample outlook for this horizon: ${s === "positive" ? "leaning up" : s === "negative" ? "leaning down" : "no clear direction"} in the demo data.`,
      factIds: s === "no-view" ? [] : ["px.last", "demo.trend"],
    };
  }
  return out;
}

function note(assetId: string): ResearchNote {
  const u = UNIVERSE.find((x) => x.assetId === assetId)!;
  const seed = SEEDS[assetId];
  const price = u.publicPrice ? mockPrice(assetId) : undefined;
  const facts: Fact[] = [
    ...(price !== undefined
      ? [{ id: "px.last", kind: "price" as const, label: "Testnet mock price (sample)", value: price, unit: "USD", source: MOCK_SOURCE, asOf: SAMPLE_AT }]
      : []),
    { id: "demo.trend", kind: "indicator", label: "Demo trend reading", value: seed.stance === "no-view" ? "none" : seed.stance, source: DEMO_SOURCE, asOf: SAMPLE_AT },
    { id: "demo.news", kind: "news", label: "Demo headline (not a real article)", value: `Sample headline about ${u.name}`, source: DEMO_SOURCE, asOf: SAMPLE_AT },
  ];
  const cite = price !== undefined ? ["px.last", "demo.trend"] : ["demo.news"];
  const levels =
    price !== undefined && u.risk !== "cash-like"
      ? {
          entry: price,
          target: Math.round(price * 1.1 * 100) / 100,
          stop: Math.round(price * 0.92 * 100) / 100,
          basis: "Sample only: entry = testnet mock start price, target 10% above, stop 8% below. Real levels use ATR and support and resistance.",
        }
      : null;
  return {
    assetId,
    date: SAMPLE_DATE,
    generatedAt: SAMPLE_AT,
    dataAsOf: SAMPLE_AT,
    status: "ok",
    summary: seed.summary,
    action: seed.action,
    confidence: seed.confidence,
    levels,
    reasons: [
      { text: "Sample reason: the demo trend reading points this way.", factIds: cite },
      { text: "Sample reason: a demo headline adds context.", factIds: ["demo.news"] },
    ],
    opportunities: [{ text: "Sample opportunity written for the demo.", factIds: ["demo.news"] }],
    risks: [{ text: "Sample risk written for the demo. Prices can fall.", factIds: cite }],
    scenarios: {
      bull: { text: "Sample bull case: the demo trend continues.", factIds: cite, likelihood: "low" },
      base: { text: "Sample base case: little changes.", factIds: cite, likelihood: "medium" },
      bear: { text: "Sample bear case: the demo trend reverses.", factIds: cite, likelihood: "low" },
    },
    outlook: outlook(seed.stance),
    facts,
    model: { triage: "none (sample fixture)" },
    previousAction: PREV[assetId],
  };
}

export const SAMPLE_SNAPSHOT: ResearchSnapshot = {
  kind: "sample",
  date: SAMPLE_DATE,
  generatedAt: SAMPLE_AT,
  runId: "sample-fixture",
  market: {
    date: SAMPLE_DATE,
    summary:
      "Sample market overview for the demo. When the daily research runs, this explains what moved across stocks, funds, gold and crypto, with every number linked to its source.",
    developments: [
      { text: "Sample development: broad market fund steady in the demo data.", factIds: ["demo.market"] },
      { text: "Sample development: crypto swings wider than stocks in the demo data.", factIds: ["demo.market"] },
    ],
    facts: [{ id: "demo.market", kind: "macro", label: "Demo market reading", value: "sample", source: DEMO_SOURCE, asOf: SAMPLE_AT }],
  },
  notes: UNIVERSE.map((u) => note(u.assetId)),
};

/** Sample history: the same note on earlier dates with older actions, for the "past suggestions" table. */
export function sampleHistory(assetId: string): ResearchNote[] {
  const base = SAMPLE_SNAPSHOT.notes.find((n) => n.assetId === assetId);
  if (!base) return [];
  const days = ["2026-11-19", "2026-11-18", "2026-11-17", "2026-11-14", "2026-11-13"];
  const cycle: Action[] = [base.action, base.previousAction ?? base.action, "hold", "watch", "hold"];
  return days.map((date, i) => ({ ...base, date, generatedAt: `${date}T21:05:00Z`, dataAsOf: `${date}T21:00:00Z`, action: cycle[i] }));
}
