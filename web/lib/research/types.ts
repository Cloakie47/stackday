/**
 * Shared types for the Research engine behind the Themes layer (anchor: "A Themes layer reads
 * market news and sentiment, suggests tokenized stocks by the themes a person cares about, and
 * proposes rebalances from time to time"). Plan and rules: docs/research/PLAN.md.
 *
 * Every module under web/lib/research builds on these types. Change them only on the
 * gg/research-core branch so parallel branches stay compatible.
 *
 * Honesty rules baked into the shapes:
 * - Every number a person sees is a `Fact` with a source and a timestamp. Facts are made by code
 *   from fetched data, never by the model.
 * - The model only writes text and picks from fixed options, and every reason it gives must cite
 *   fact ids. Entry, target and stop levels are computed in code (see `Levels.basis`).
 * - A note is research, not advice: `action` is a suggestion with a confidence, risks and
 *   alternative scenarios, never a promise of returns.
 */

/** Research horizons, shortest first. "1h" is intraday (hourly bars). */
export const TIMEFRAMES = ["1h", "1d", "1w", "1m", "1y", "5y"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  "1h": "Intraday (1 hour)",
  "1d": "Daily",
  "1w": "Weekly",
  "1m": "Monthly",
  "1y": "1 year outlook",
  "5y": "5 year outlook",
};

/** Suggested action. "watch" means no position change yet, keep an eye on a named trigger. */
export const ACTIONS = ["buy", "hold", "sell", "watch"] as const;
export type Action = (typeof ACTIONS)[number];

export type AssetClass = "stock" | "fund" | "commodity" | "crypto";

/** Which market hours apply: US stock exchange days, or every day for crypto. */
export type MarketCalendar = "XNYS" | "CRYPTO";

/** ISO date "YYYY-MM-DD". */
export type IsoDate = string;
/** ISO date-time with timezone, for example "2026-11-19T21:05:00Z". */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------------------------
// Market data (produced by web/lib/research/data)
// ---------------------------------------------------------------------------------------------

/** Where a number or article came from. `name` is set by our code, never by a model. */
export type Source = {
  name: string;
  /** http(s) link to the page or API documentation. */
  url?: string;
};

/** One OHLCV bar in USD. `t` is the bar's opening time. */
export type PriceBar = {
  t: IsoDateTime;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
};

export type BarInterval = "1h" | "1d" | "1w" | "1mo";

export type PriceSeries = {
  assetId: string;
  interval: BarInterval;
  bars: PriceBar[];
  source: Source;
  fetchedAt: IsoDateTime;
};

/** Technical readings computed in code from a price series. Missing when there is not enough history. */
export type Indicators = {
  last: number;
  changePct: Partial<Record<Timeframe, number>>;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  rsi14?: number;
  macd?: { macd: number; signal: number; histogram: number };
  /** Average true range over 14 bars, in USD. */
  atr14?: number;
  /** Annualised volatility of daily returns, 0.25 = 25%. */
  volatility?: number;
  /** Largest fall from a peak within the window, 0.4 = -40%. */
  maxDrawdown?: number;
  high52w?: number;
  low52w?: number;
  support?: number[];
  resistance?: number[];
};

export type FactKind = "price" | "indicator" | "fundamental" | "news" | "filing" | "macro" | "calendar";

/**
 * One checkable piece of evidence. Ids are stable within a note, for example "px.last",
 * "ind.rsi14", "news.3". Reasons and outlooks cite these ids.
 */
export type Fact = {
  id: string;
  kind: FactKind;
  label: string;
  value: string | number;
  unit?: string;
  source: Source;
  asOf: IsoDateTime;
  /** For news and filings: at most 25 words copied from the source. */
  quote?: string;
};

// ---------------------------------------------------------------------------------------------
// Research notes (produced daily by web/lib/research/engine)
// ---------------------------------------------------------------------------------------------

export type Confidence = "low" | "medium" | "high";
export type Stance = "positive" | "neutral" | "negative" | "no-view";

/** A sentence of analysis and the facts it rests on. Text without fact ids is dropped. */
export type Reasoned = { text: string; factIds: string[] };

export type Outlook = Reasoned & { stance: Stance };

export type Scenario = Reasoned & { likelihood: Confidence };

/** Entry, target and stop in USD of the underlying. Computed in code, never by the model. */
export type Levels = {
  entry: number;
  target: number;
  stop: number;
  /** How the levels were computed, for example "entry = last close, stop = 2 x ATR14 below, target = nearest resistance". */
  basis: string;
};

export type NoteStatus =
  /** Fresh research for this date. */
  | "ok"
  /** Data or model failed for this asset today: shown as "no reading", nothing invented. */
  | "no-reading"
  /** Market closed today: the last trading day's note is carried forward and labelled. */
  | "carried";

export type ResearchNote = {
  /** Stackday asset symbol, for example "mAAPL". */
  assetId: string;
  /** Trading date this note is for. */
  date: IsoDate;
  generatedAt: IsoDateTime;
  /** Time of the newest market data used. */
  dataAsOf: IsoDateTime;
  status: NoteStatus;
  /** The 2 to 3 line summary: position and developments, opportunity and risk, suggested action. Max 420 characters. */
  summary: string;
  action: Action;
  confidence: Confidence;
  /** Null when levels make no sense (cash-like funds, no public price, too little data). */
  levels: Levels | null;
  /** Why this action. Every item cites facts. */
  reasons: Reasoned[];
  opportunities: Reasoned[];
  risks: Reasoned[];
  scenarios: { bull: Scenario; base: Scenario; bear: Scenario };
  outlook: Record<Timeframe, Outlook>;
  facts: Fact[];
  /** The model ids that wrote the text, for example { triage: "claude-haiku-5-5", escalated: "claude-sonnet-5-5" }. */
  model: { triage: string; escalated?: string };
  /** Action on the previous trading day, so changes can be highlighted. */
  previousAction?: Action;
};

export type MarketOverview = {
  date: IsoDate;
  summary: string;
  developments: Reasoned[];
  facts: Fact[];
};

/**
 * Everything the engine produced for one date. `kind: "sample"` is hand-made demo data and must be
 * shown with a "Sample data" label; it never contains invented prices presented as real.
 */
export type ResearchSnapshot = {
  kind: "live" | "sample";
  date: IsoDate;
  generatedAt: IsoDateTime;
  runId: string;
  market: MarketOverview;
  notes: ResearchNote[];
  /** What the run cost in model usage, in USD. */
  costUsd?: number;
};

// ---------------------------------------------------------------------------------------------
// Portfolio analysis (web/lib/research/portfolio)
// ---------------------------------------------------------------------------------------------

export type Horizon = "short" | "medium" | "long";
export type RiskTolerance = "low" | "medium" | "high";

export type Holding = {
  assetId: string;
  /** Units of the asset (already divided by its decimals). */
  amount: number;
  /** Where the holding came from: read from the person's vault, or typed in by hand. */
  origin: "vault" | "manual";
  /** What the person paid in total, if known, in USD. */
  costUsd?: number;
};

export type PortfolioInput = {
  holdings: Holding[];
  horizon: Horizon;
  risk: RiskTolerance;
  /** Planned new money per month in USD, used for new-money-only rebalance ideas. */
  monthlyNewMoneyUsd?: number;
  /** Open loan against the vault, in USD, if any. */
  loanUsd?: number;
};

export type AllocationSlice = { key: string; label: string; valueUsd: number; share: number };

export type HoldingVerdict = {
  assetId: string;
  valueUsd: number;
  share: number;
  /** The daily note's action for this asset, read from the snapshot. */
  action: Action;
  verdict: "keep" | "review" | "trim-new-buys" | "add-with-new-money";
  why: Reasoned;
};

export type PortfolioAnalysis = {
  asOf: IsoDateTime;
  totalUsd: number;
  byAsset: AllocationSlice[];
  byClass: AllocationSlice[];
  bySector: AllocationSlice[];
  byRisk: AllocationSlice[];
  /** 0 (all in one asset) to 1 (evenly spread). */
  diversification: number;
  /** Plain-language flags: one asset over a cap, overlap between a fund and its top holdings, etc. */
  concentration: Reasoned[];
  overlaps: Reasoned[];
  holdings: HoldingVerdict[];
  /** Ideas that only redirect new money, never sell (founder rule: caps are targets for new buys). */
  rebalanceIdeas: Reasoned[];
  /** 0 to 100 with the parts that make it up. */
  health: { score: number; parts: { label: string; score: number; why: string }[] };
  facts: Fact[];
};

// ---------------------------------------------------------------------------------------------
// Reports (web/lib/research/reports)
// ---------------------------------------------------------------------------------------------

export type ReportScope = "market" | "asset" | "portfolio" | "full";
export type ReportPeriod = "daily" | "weekly" | "monthly" | "on-demand";

export type Report = {
  id: string;
  scope: ReportScope;
  period: ReportPeriod;
  /** Wallet that asked for it (lowercase), or null for the public market report. */
  owner: string | null;
  createdAt: IsoDateTime;
  /** Snapshot date the report was built from. */
  snapshotDate: IsoDate;
  premium: boolean;
  market?: MarketOverview;
  notes: ResearchNote[];
  /** What changed since the previous report of the same period. */
  changes: Reasoned[];
  portfolio?: PortfolioAnalysis;
  /** Shown at the top and bottom of every report. */
  disclaimer: string;
};

export const RESEARCH_DISCLAIMER =
  "Research for information only, not investment advice. AI-written analysis is marked as such and every number shows its source and time. Suggested actions can be wrong, past performance does not predict future results, and nothing here is a promise of returns. Stackday runs on Base Sepolia testnet with mock tokens.";

// ---------------------------------------------------------------------------------------------
// Access and payments (web/lib/research/access)
// ---------------------------------------------------------------------------------------------

export const PLANS = ["free", "pay-per-report", "monthly", "yearly"] as const;
export type Plan = (typeof PLANS)[number];

export type Entitlement = {
  owner: string;
  plan: Plan;
  /** Subscription end, or null for free and pay-per-report. */
  validUntil: IsoDateTime | null;
  /** Paid single reports not used yet. */
  reportCredits: number;
  /** Deeper analysis, all timeframes and full portfolio insights. */
  premium: boolean;
};

/** What a request needs, checked on the server before a report is built. */
export type AccessCheck =
  | { allowed: true; consumesCredit: boolean }
  | { allowed: false; reason: "sign-in" | "payment-required" | "premium-required" | "rate-limited" };
