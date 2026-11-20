/**
 * SAMPLE DATA for the Research pages, used only when /api/research/weekly is missing or fails.
 * `kind: "sample"` makes every page show a "Sample data" label.
 *
 * No real market prices are invented here: the only prices are the Stackday testnet mock start
 * prices from web/lib/contracts.ts, and each fact says so in its source. Levels, patterns and
 * events are made up for the demo and say so. The text is hand-written demo copy, not model
 * output and not a view on any real asset.
 */
import type {
  CalendarEvent,
  ChartInterval,
  ChartReadSection,
  Confidence,
  ExampleSplit,
  Fact,
  InvestmentIdea,
  Levels,
  Pattern,
  PatternKind,
  Scorecard,
  TrendStructure,
  View,
  WeeklyAssetSection,
  WeeklyReport,
} from "@/lib/research/types";
import { CHART_INTERVALS, RESEARCH_DISCLAIMER } from "@/lib/research/types";
import { UNIVERSE, universeAsset } from "@/lib/research/universe";
import { borrowNote } from "@/lib/research/borrow";
import { ASSETS } from "@/lib/contracts";

export const SAMPLE_WEEK = "2026-11-16";
export const SAMPLE_AT = "2026-11-16T12:04:00Z";
const DATA_AT = "2026-11-14T21:00:00Z";

const MOCK_SOURCE = { name: "Stackday testnet mock feed (sample, not a market price)" };
const DEMO_SOURCE = { name: "Sample fixture (demo text, no real source)" };

export function mockPrice(assetId: string): number | undefined {
  const a = ASSETS.find((x) => x.symbol === assetId);
  return a ? Number(a.startPrice) / 1e8 : undefined;
}

const round = (x: number) => (x >= 1000 ? Math.round(x) : Math.round(x * 100) / 100);

type Seed = {
  view: View;
  conviction: Confidence;
  trend: Record<ChartInterval, TrendStructure>;
  pattern: { interval: ChartInterval; kind: PatternKind; direction: Pattern["direction"]; confidence: Confidence };
  reason: string;
  probs: [number, number, number];
};

const SEEDS: Record<string, Seed> = {
  mcbBTC: {
    view: "hold",
    conviction: "low",
    trend: { "1d": "range", "1w": "higher-highs-higher-lows", "1mo": "higher-highs-higher-lows" },
    pattern: { interval: "1d", kind: "range", direction: "neutral", confidence: "medium" },
    reason: "Sample: daily bars sit in a range inside a weekly uptrend, so the demo view waits for a break.",
    probs: [30, 45, 25],
  },
  mWETH: {
    view: "avoid-new-buys",
    conviction: "low",
    trend: { "1d": "lower-highs-lower-lows", "1w": "lower-highs-lower-lows", "1mo": "range" },
    pattern: { interval: "1w", kind: "bear-flag", direction: "bearish", confidence: "low" },
    reason: "Sample: lower highs on daily and weekly bars in the demo data, no new money until that changes.",
    probs: [20, 45, 35],
  },
  mPAXG: {
    view: "accumulate",
    conviction: "medium",
    trend: { "1d": "higher-highs-higher-lows", "1w": "higher-highs-higher-lows", "1mo": "higher-highs-higher-lows" },
    pattern: { interval: "1w", kind: "bull-flag", direction: "bullish", confidence: "medium" },
    reason: "Sample: uptrend on all three timeframes in the demo data, with a buy zone near daily support.",
    probs: [35, 45, 20],
  },
  mNVDA: {
    view: "avoid-new-buys",
    conviction: "medium",
    trend: { "1d": "range", "1w": "range", "1mo": "higher-highs-higher-lows" },
    pattern: { interval: "1d", kind: "rsi-bearish-divergence", direction: "bearish", confidence: "low" },
    reason: "Sample: a demo earnings date sits inside the week, so the demo view holds off new buys until after it.",
    probs: [25, 40, 35],
  },
  mAAPL: {
    view: "hold",
    conviction: "medium",
    trend: { "1d": "range", "1w": "higher-highs-higher-lows", "1mo": "higher-highs-higher-lows" },
    pattern: { interval: "1mo", kind: "golden-cross", direction: "bullish", confidence: "medium" },
    reason: "Sample: steady longer trend, price mid-range on daily bars, no reason in the demo data to change.",
    probs: [25, 55, 20],
  },
  mSPX: {
    view: "accumulate",
    conviction: "high",
    trend: { "1d": "higher-highs-higher-lows", "1w": "higher-highs-higher-lows", "1mo": "higher-highs-higher-lows" },
    pattern: { interval: "1w", kind: "breakout", direction: "bullish", confidence: "medium" },
    reason: "Sample: broad market uptrend in the demo data; regular buying inside the zone fits this view.",
    probs: [30, 50, 20],
  },
};

const MARKET_FACTS: Fact[] = [
  { id: "macro.demo.rates", kind: "macro", label: "Demo 10-year yield reading", value: "sample", source: DEMO_SOURCE, asOf: DATA_AT },
  { id: "macro.demo.vix", kind: "macro", label: "Demo volatility index reading", value: "sample", source: DEMO_SOURCE, asOf: DATA_AT },
];

function chartRead(assetId: string, interval: ChartInterval, p: number, s: Seed): ChartReadSection {
  const w = interval === "1d" ? 1 : interval === "1w" ? 2 : 3.5;
  const support = [round(p * (1 - 0.04 * w)), round(p * (1 - 0.08 * w))];
  const resistance = [round(p * (1 + 0.04 * w)), round(p * (1 + 0.09 * w))];
  const patterns: Pattern[] =
    s.pattern.interval === interval
      ? [
          {
            id: `pat.${interval}.${s.pattern.kind}`,
            kind: s.pattern.kind,
            interval,
            direction: s.pattern.direction,
            confidence: s.pattern.confidence,
            invalidation: s.pattern.direction === "bearish" ? resistance[0] : support[0],
            asOf: DATA_AT,
            detail: `Sample pattern for the demo, levels from the mock price, not a real chart.`,
          },
        ]
      : [];
  const factIds = [`px.${interval}.last`, ...patterns.map((x) => x.id)];
  return {
    interval,
    trend: s.trend[interval],
    support,
    resistance,
    positionInRange: 0.5,
    patterns,
    volatility: { atrPercentile: 0.5, volPercentile: 0.45, regime: "normal" },
    factIds,
    text: [{ text: `Sample chart read for ${universeAsset(assetId)?.name}: demo text describing the code reading above.`, factIds }],
  };
}

function section(assetId: string): WeeklyAssetSection {
  const u = universeAsset(assetId)!;
  const s = SEEDS[assetId];
  const p = mockPrice(assetId) ?? 100;
  const chart: WeeklyAssetSection["chart"] = {};
  for (const iv of CHART_INTERVALS) chart[iv] = chartRead(assetId, iv, p, s);
  const d = chart["1d"]!;
  const facts: Fact[] = [
    ...CHART_INTERVALS.map((iv) => ({ id: `px.${iv}.last`, kind: "price" as const, label: `Testnet mock price, ${iv} bars (sample)`, value: p, unit: "USD", source: MOCK_SOURCE, asOf: DATA_AT })),
    ...CHART_INTERVALS.flatMap((iv) =>
      chart[iv]!.patterns.map((x) => ({ id: x.id, kind: "pattern" as const, label: `Demo pattern: ${x.kind}`, value: x.detail, source: DEMO_SOURCE, asOf: DATA_AT })),
    ),
    { id: "news.demo.1", kind: "news", label: "Demo headline (not a real article)", value: `Sample headline about ${u.name}`, source: DEMO_SOURCE, asOf: "2026-11-13T15:00:00Z" },
    ...MARKET_FACTS,
  ];
  const levels: Levels = {
    buyZone: s.view === "accumulate" ? { low: d.support[0], high: round(d.support[0] * 1.015) } : null,
    invalidation: d.support[1],
    support: d.support,
    resistance: d.resistance,
    basis: "Sample only: levels from the testnet mock start price. Real levels use daily support, resistance and ATR.",
  };
  const cite = ["px.1d.last"];
  const weekAhead: CalendarEvent[] = [
    { id: "cal.demo.pce", date: "2026-11-20", kind: "pce", name: "Sample event: inflation release (demo date)", assetIds: [], source: DEMO_SOURCE },
    ...(assetId === "mNVDA"
      ? [{ id: "cal.demo.earn", date: "2026-11-18", kind: "earnings" as const, name: "Sample event: quarterly results (demo date)", assetIds: ["mNVDA"], source: DEMO_SOURCE }]
      : []),
  ];
  const [bull, base, bear] = s.probs;
  return {
    assetId,
    status: "ok",
    recap: [{ text: `Sample recap: ${u.name} moved little in the demo data last week. Real reports give the move, volume and drivers with sources.`, factIds: [...cite, "news.demo.1"] }],
    chart,
    market: [{ text: "Sample market conditions: demo rates and volatility readings, no real figures.", factIds: ["macro.demo.rates", "macro.demo.vix"] }],
    news: [{ text: `Sample news item about ${u.name}, dated, from a demo source only.`, factIds: ["news.demo.1"] }],
    weekAhead,
    scenarios: {
      bull: { text: "Sample bull case: price clears the first resistance.", factIds: cite, probability: bull, levels: [d.resistance[0], d.resistance[1]], trigger: `Daily close above ${d.resistance[0].toLocaleString("en-US")} (demo level)` },
      base: { text: "Sample base case: price stays between the nearest levels.", factIds: cite, probability: base, levels: [d.support[0], d.resistance[0]], trigger: "No close outside the range (demo)" },
      bear: { text: "Sample bear case: price loses the first support.", factIds: cite, probability: bear, levels: [d.support[0], d.support[1]], trigger: `Daily close below ${d.support[0].toLocaleString("en-US")} (demo level)` },
    },
    view: { view: s.view, conviction: s.conviction, levels, reasons: [{ text: s.reason, factIds: cite }, { text: "Sample second reason from the demo chart read.", factIds: d.factIds }] },
    borrowing: borrowNote(assetId, u.name, u.lltv),
    debate: { bull: [{ text: "Sample strongest bull point.", factIds: cite }], bear: [{ text: "Sample strongest bear point.", factIds: cite }] },
    facts,
  };
}

const IDEAS: InvestmentIdea[] = [
  ["mSPX", "accumulate"],
  ["mPAXG", "accumulate"],
  ["mAAPL", "hold"],
  ["mcbBTC", "hold"],
  ["mWETH", "avoid-new-buys"],
  ["mNVDA", "avoid-new-buys"],
].map(([assetId, view], i) => ({
  rank: i + 1,
  assetId,
  view: view as View,
  reasons: [{ text: `Sample idea: ${SEEDS[assetId].reason.replace(/^Sample: (.)/, (_, c: string) => c.toLowerCase())}`, factIds: ["px.1d.last"] }],
  dependsOn: { text: "Sample: depends on the demo trend holding; a change in rates or risk mood would change it.", factIds: ["macro.demo.rates"] },
  mainRisk: { text: "Sample main risk: a market-wide fall would hit this along with everything else.", factIds: ["macro.demo.vix"] },
}));

const SPLITS: ExampleSplit[] = [
  {
    profile: "cautious",
    slices: [
      { assetId: "mSPX", share: 0.5 },
      { assetId: "mPAXG", share: 0.3 },
      { assetId: "mAAPL", share: 0.15 },
      { assetId: "mcbBTC", share: 0.05 },
    ],
    why: { text: "Sample: mostly the broad market fund and gold, with a small slice of the more volatile assets.", factIds: [] },
  },
  {
    profile: "growth",
    slices: [
      { assetId: "mSPX", share: 0.35 },
      { assetId: "mAAPL", share: 0.2 },
      { assetId: "mcbBTC", share: 0.2 },
      { assetId: "mPAXG", share: 0.15 },
      { assetId: "mNVDA", share: 0.1 },
    ],
    why: { text: "Sample: more in single stocks and Bitcoin, which swing more both ways.", factIds: [] },
  },
];

const SCORECARD: Scorecard = {
  weekOf: "2026-11-09",
  rows: [
    { assetId: "mSPX", view: "accumulate", conviction: "high", priceAtCall: 742, priceAfter: 742, change: 0, invalidated: false, result: "mixed", why: "Sample: flat in the demo data, the zone held." },
    { assetId: "mPAXG", view: "accumulate", conviction: "medium", priceAtCall: 4060, priceAfter: 4060, change: 0, invalidated: false, result: "right", why: "Sample: stayed above the invalidation level." },
    { assetId: "mAAPL", view: "hold", conviction: "medium", priceAtCall: 357, priceAfter: 357, change: 0, invalidated: false, result: "right", why: "Sample: moved less than one ATR, as a hold implies." },
    { assetId: "mcbBTC", view: "accumulate", conviction: "low", priceAtCall: 100000, priceAfter: 100000, change: 0, invalidated: true, result: "wrong", why: "Sample wrong call: the demo invalidation level broke during the week." },
    { assetId: "mWETH", view: "hold", conviction: "low", priceAtCall: 3500, priceAfter: 3500, change: 0, invalidated: false, result: "wrong", why: "Sample wrong call: moved more than one ATR against a hold." },
    { assetId: "mNVDA", view: "hold", conviction: "medium", priceAtCall: 190, priceAfter: null, change: null, invalidated: false, result: "no-data", why: "Sample: no price after the call in the demo data." },
  ],
  calibration: [
    { conviction: "low", calls: 6, right: 2 },
    { conviction: "medium", calls: 9, right: 6 },
    { conviction: "high", calls: 3, right: 2 },
  ],
};

export const SAMPLE_WEEKLY: WeeklyReport = {
  kind: "sample",
  weekOf: SAMPLE_WEEK,
  generatedAt: SAMPLE_AT,
  runId: "sample-fixture",
  beta: true,
  market: {
    date: SAMPLE_WEEK,
    summary:
      "Sample market conditions for the demo. In a live report this covers rates and the Fed, the dollar, volatility and the S&P 500 trend, with every number linked to its source.",
    developments: [
      { text: "Sample: demo rates reading, no real figure.", factIds: ["macro.demo.rates"] },
      { text: "Sample: demo volatility reading, no real figure.", factIds: ["macro.demo.vix"] },
    ],
    facts: MARKET_FACTS,
  },
  assets: UNIVERSE.map((u) => section(u.assetId)),
  ideas: { ranked: IDEAS, exampleSplits: SPLITS },
  scorecard: SCORECARD,
  review: { approved: true, sentBack: 0, removedClaims: 0, notes: ["Sample fixture, not reviewed by the risk pass."] },
  model: { analysts: "none (sample fixture)", editor: "none (sample fixture)" },
  disclaimer: RESEARCH_DISCLAIMER,
};
