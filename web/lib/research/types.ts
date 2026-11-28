/**
 * Shared types for the Research engine behind the Themes layer (anchor: "A Themes layer reads
 * market news and sentiment, suggests tokenized stocks by the themes a person cares about, and
 * proposes rebalances from time to time"). Founder spec: docs/research/SPEC.md (PR #73). Plan and
 * branch ownership: docs/research/PLAN.md.
 *
 * Every module under web/lib/research builds on these types. Change them only on the
 * gg/research-core branch so parallel branches stay compatible.
 *
 * Two products from one engine (spec section 2):
 * - the daily note: internal while testing, short, cheaper model with escalation for big movers;
 * - the Monday weekly report: the product, strongest model, full sections (spec section 3).
 *
 * Honesty rules baked into the shapes (spec section 6):
 * - Every number a person sees is a `Fact` with a source and a timestamp. Facts are made by code
 *   from fetched data, never by the model.
 * - Patterns, trend structure, support and resistance, the buy zone, the invalidation level and the
 *   borrowing note are computed in code. The model only describes them.
 * - The model only writes text and picks from fixed options, and every claim cites fact ids. A
 *   claim with no valid fact id is removed by the risk reviewer.
 * - Views are general research for every reader, never a personal instruction.
 */

// ---------------------------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------------------------

/** ISO date "YYYY-MM-DD". */
export type IsoDate = string;
/** ISO date-time with timezone, for example "2026-11-19T21:05:00Z". */
export type IsoDateTime = string;

export type AssetClass = "stock" | "fund" | "commodity" | "crypto";

/** Which market hours apply: US stock exchange days, or every day for crypto and tokenized gold. */
export type MarketCalendar = "XNYS" | "CRYPTO";

export type Confidence = "low" | "medium" | "high";

/**
 * This week's view (spec section 3.7). General research for all readers, not an order.
 * "avoid-new-buys" means no new money for now; it never tells anyone to sell what they hold.
 */
export const VIEWS = ["accumulate", "hold", "reduce", "avoid-new-buys"] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  accumulate: "Accumulate",
  hold: "Hold",
  reduce: "Reduce",
  "avoid-new-buys": "Avoid new buys",
};

/** Chart timeframes read in every report (spec section 3.2): daily, weekly and monthly bars. */
export const CHART_INTERVALS = ["1d", "1w", "1mo"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

export const CHART_INTERVAL_LABEL: Record<ChartInterval, string> = { "1d": "Daily", "1w": "Weekly", "1mo": "Monthly" };

/** Bar sizes the data layer fetches. "1h" is only used for the daily note's intraday move. */
export type BarInterval = "1h" | ChartInterval;

// ---------------------------------------------------------------------------------------------
// Market data (produced by web/lib/research/data)
// ---------------------------------------------------------------------------------------------

/** Where a number or article came from. `name` is set by our code, never by a model. */
export type Source = {
  name: string;
  /** http(s) link to the page or API documentation. */
  url?: string;
  /**
   * False when the source's terms do not allow showing its values to users (internal use only).
   * Set on a price series' source so every fact, level and pattern built from it inherits it.
   */
  display?: boolean;
};

/** True when a fact or source may be shown to users and sent to the model (no `display: false`). */
export function isDisplayable(x: { display?: boolean; source?: { display?: boolean } }): boolean {
  return x.display !== false && x.source?.display !== false;
}

/** One OHLCV bar in USD. `t` is the bar's opening time. */
export type PriceBar = { t: IsoDateTime; o: number; h: number; l: number; c: number; v?: number };

export type PriceSeries = {
  assetId: string;
  interval: BarInterval;
  bars: PriceBar[];
  source: Source;
  fetchedAt: IsoDateTime;
};

/** Technical readings computed in code from one price series. Missing when there is not enough history. */
export type Indicators = {
  last: number;
  /** Change over 1 bar, 5 bars and 20 bars of this series, 0.05 = +5%. */
  changePct: { bar1?: number; bar5?: number; bar20?: number };
  sma20?: number;
  sma50?: number;
  sma200?: number;
  rsi14?: number;
  macd?: { macd: number; signal: number; histogram: number };
  /** Average true range over 14 bars, in USD. */
  atr14?: number;
  /** Annualised volatility of returns, 0.25 = 25%. */
  volatility?: number;
  /** Largest fall from a peak within the window, 0.4 = -40%. */
  maxDrawdown?: number;
  high52w?: number;
  low52w?: number;
};

/** Trend structure of swing points (spec section 3.2). */
export type TrendStructure = "higher-highs-higher-lows" | "lower-highs-lower-lows" | "range";

export const PATTERN_KINDS = [
  "breakout",
  "breakdown",
  "range",
  "bull-flag",
  "bear-flag",
  "double-top",
  "double-bottom",
  "head-and-shoulders",
  "inverse-head-and-shoulders",
  "golden-cross",
  "death-cross",
  "rsi-bullish-divergence",
  "rsi-bearish-divergence",
  "macd-bullish-divergence",
  "macd-bearish-divergence",
] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

/** A chart pattern found by code. The model may describe it, never invent one. */
export type Pattern = {
  /** Fact id of the pattern, for example "pat.1d.double-bottom". */
  id: string;
  kind: PatternKind;
  interval: ChartInterval;
  direction: "bullish" | "bearish" | "neutral";
  confidence: Confidence;
  /** Price that would prove the pattern wrong, in USD. */
  invalidation: number;
  /** Bar time when the pattern completed or was last confirmed. */
  asOf: IsoDateTime;
  /** One line written by code, for example "two lows near 92,100 and 92,400, neckline 98,000". */
  detail: string;
};

export type VolatilityRegime = {
  /** Where today's ATR sits against its own last year, 0 (lowest) to 1 (highest). */
  atrPercentile?: number;
  /** Same for realized volatility. */
  volPercentile?: number;
  regime: "low" | "normal" | "high" | "unknown";
};

/** The code half of a chart read for one timeframe. The model adds text that cites these fact ids. */
export type ChartRead = {
  interval: ChartInterval;
  trend: TrendStructure;
  /** Nearest levels first, in USD. */
  support: number[];
  resistance: number[];
  /** Where the last close sits between nearest support (0) and nearest resistance (1); null if one side is missing. */
  positionInRange: number | null;
  patterns: Pattern[];
  volatility: VolatilityRegime;
  /** Fact ids that back this read (prices, indicators, patterns). */
  factIds: string[];
};

export type FactKind =
  | "price"
  | "indicator"
  | "pattern"
  | "fundamental"
  | "news"
  | "filing"
  | "macro"
  | "flow"
  | "calendar";

/**
 * One checkable piece of evidence. Ids are stable within a run, for example "px.1d.last",
 * "ind.1w.rsi14", "pat.1d.breakout", "macro.dgs10", "news.3". Claims cite these ids.
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
  /** Topic tags set by code, for example "geopolitics", "tariffs", "export-controls", "fed". */
  tags?: string[];
  /** False when the source's terms do not allow showing this value to users (internal use only). */
  display?: boolean;
  /**
   * How sure the item is, for news, filings and calendar events (see `Certainty`). Set by code from
   * the source; the model may only lower it. Missing on facts stored before this field existed.
   */
  certainty?: Certainty;
};

/**
 * Catalyst labels, most certain first. Set in code from the source:
 * - "confirmed": official sources (Fed, SEC, Treasury), company press releases, SEC filings and
 *   scheduled calendar events (Fed meetings, published data releases, options expiry);
 * - "reported": a reputable news outlet reporting it, not the primary source;
 * - "speculation": outlet headlines worded as a rumour, an expectation or an opinion
 *   (`speculativeWording`).
 * The model may only move a label down this list, never up (`lowerCertainty`).
 */
export const CERTAINTIES = ["confirmed", "reported", "speculation"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export const CERTAINTY_LABEL: Record<Certainty, string> = { confirmed: "Confirmed", reported: "Reported", speculation: "Speculation" };

/**
 * Headline wording that makes an outlet item speculation rather than a report: rumours, "could",
 * "may" (the verb, not the month), expectations, unnamed sources, analysts' views, opinion pieces
 * and question headlines. Kept small on purpose and tested (headlines.test.ts).
 */
export const SPECULATION_WORDS: RegExp[] = [
  /\breportedly\b/i,
  /\brumou?r(s|ed)?\b/i,
  /\b(could|might)\b/i,
  // "may" the verb: not the month ("in May", "May 2026", "May 5").
  /(?<!\b(in|since|until|from|through|of|last|next|early|mid|late|end of)\s)\bmay\b(?!\s+\d)/i,
  /\b(likely|unlikely|poised to|expected to|set to)\b/i,
  /\banalysts?\s+(say|says|said|expect|expects|see|sees|predict|predicts|forecast|forecasts|warn|warns|estimate|estimates)\b/i,
  /\b(sources?|insiders?)\s+(say|says|said)\b|\bpeople familiar\b|\baccording to (people|sources|a person)\b/i,
  /^\s*(opinion|analysis|column|commentary|breakingviews|editorial|view)\s*[:|-]/i,
  /\bop-ed\b/i,
  /\?\s*$/,
];

export const speculativeWording = (text: string): boolean => SPECULATION_WORDS.some((re) => re.test(text));

/**
 * Label for a headline from its source tags (set by our code in data/headlines.ts) and its text:
 * official and press-release items are confirmed; anything else (outlets) is reported, or
 * speculation when the wording says so. An item with no source tag is never confirmed.
 */
export function newsCertainty(tags: string[] | undefined, text: string): Certainty {
  const t = tags ?? [];
  if (t.includes("official") || t.includes("press-release")) return "confirmed";
  return speculativeWording(text) ? "speculation" : "reported";
}

/** The label after a model proposal: the proposal only counts when it is less certain (a downgrade). */
export function lowerCertainty(current: Certainty, proposed: Certainty): Certainty {
  return CERTAINTIES.indexOf(proposed) > CERTAINTIES.indexOf(current) ? proposed : current;
}

export type CalendarEventKind = "fomc" | "fed-speech" | "cpi" | "jobs" | "pce" | "gdp" | "earnings" | "token-unlock" | "options-expiry" | "other";

/** A dated event for the week-ahead calendar (spec section 3.5). From official calendars only. */
export type CalendarEvent = {
  /** Fact id, for example "cal.2026-11-26.pce". */
  id: string;
  date: IsoDate;
  /** Time in UTC when published by the source. */
  timeUtc?: string;
  kind: CalendarEventKind;
  name: string;
  /** Assets this event matters for; empty means all. */
  assetIds: string[];
  source: Source;
  /** "confirmed" for scheduled official events, set in code. Missing on events stored before this field existed. */
  certainty?: Certainty;
};

/**
 * Everything data/ gathers for one asset on one run, produced by `gatherAsset` in
 * web/lib/research/data and consumed by engine/. Facts already carry sources and times.
 * Each analyst pass sees only its own fact kinds (spec section 4.2): technical gets price,
 * indicator and pattern; macro gets macro and calendar; news gets news and filing; fundamentals
 * gets fundamental, flow and filing.
 */
export type AssetResearchInput = {
  assetId: string;
  /** Trading date the run is for. */
  date: IsoDate;
  /** False when the asset's market is closed today (holiday or weekend): engine carries the last note. */
  marketOpenToday: boolean;
  series: Partial<Record<BarInterval, PriceSeries>>;
  indicators: Partial<Record<BarInterval, Indicators>>;
  /** Chart read in code for daily, weekly and monthly bars. Missing timeframe means "no reading". */
  chart: Partial<Record<ChartInterval, ChartRead>>;
  facts: Fact[];
  /** Upcoming events that matter for this asset in the next 7 days. */
  calendar: CalendarEvent[];
  /** Sources that failed, in plain words, for the run log. */
  problems: string[];
  /**
   * The cut-off the data step applied (12:00 UTC on the run date, or the daily note's real run
   * time). The engine drops any fact published after it (engine/cutoff.ts). Missing on inputs
   * logged before this field existed; the engine then works it out from the run date.
   */
  cutAt?: IsoDateTime;
};

/** Market-wide inputs gathered once per run: rates, dollar, VIX, S&P trend, week-ahead calendar. */
export type MarketResearchInput = {
  date: IsoDate;
  facts: Fact[];
  calendar: CalendarEvent[];
  problems: string[];
  /** The cut-off the data step applied, as on `AssetResearchInput`. */
  cutAt?: IsoDateTime;
};

/**
 * Words in a data problem line that mean the current price could not be read and the bars came
 * from stored history only (data/onchain.ts, when the Base RPC is down). The daily run treats it as
 * a stale price feed and may escalate (engine/daily.ts `escalationTriggers`).
 */
export const NO_CURRENT_PRICE = "no current price";

// ---------------------------------------------------------------------------------------------
// Shared building blocks for notes and reports
// ---------------------------------------------------------------------------------------------

/** A sentence of analysis and the facts it rests on. Text without valid fact ids is removed. */
export type Reasoned = { text: string; factIds: string[] };

/** Buy zone and invalidation computed in code from support, resistance and ATR. */
export type Levels = {
  /** Null when the view is not accumulate or there is no sensible zone. */
  buyZone: { low: number; high: number } | null;
  /** Price that would prove the view wrong. */
  invalidation: number;
  support: number[];
  resistance: number[];
  /** How the levels were computed, for example "zone = nearest daily support to +0.5 ATR, invalidation = 1.5 ATR below support". */
  basis: string;
};

/**
 * What a large drop would mean for someone borrowing against the asset (spec section 3.8).
 * Computed in code from the market's liquidation limit (LLTV).
 */
export type BorrowNote = {
  assetId: string;
  /** Liquidation limit of the asset's lending market, 0.625 = 62.5%. */
  lltv: number;
  /**
   * For example { drop: 0.2, fromLimitUse: 0.5, toLimitUse: 0.625 }: a 20% fall moves a loan at 50%
   * of the limit to 62.5% of the limit. A value of 1 or more means the loan can be liquidated.
   */
  examples: { drop: number; fromLimitUse: number; toLimitUse: number }[];
  /** Fall from today's price at which a loan at 50% of the limit reaches the limit. */
  dropToLimitAtHalfUse: number;
  /** Plain text written by code, including the emergency rule reminder. */
  text: string;
};

// ---------------------------------------------------------------------------------------------
// Daily note (internal while testing, spec section 2)
// ---------------------------------------------------------------------------------------------

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
  /** Short: what changed today and the one-line view. Max 420 characters. */
  summary: string;
  view: View;
  conviction: Confidence;
  /** Null when there is too little data. */
  levels: Levels | null;
  /** What changed and why the view, every item citing facts. */
  reasons: Reasoned[];
  risks: Reasoned[];
  facts: Fact[];
  /** Code chart read used by the note, for the asset page. */
  chart: Partial<Record<ChartInterval, ChartRead>>;
  /** Which model ids wrote the text, for example { triage: "claude-haiku-5-5", escalated: "claude-sonnet-5-5" }. */
  model: { triage: string; escalated?: string };
  /** View on the previous trading day, so changes can be highlighted. */
  previousView?: View;
};

export type MarketOverview = {
  date: IsoDate;
  summary: string;
  developments: Reasoned[];
  facts: Fact[];
};

/**
 * Daily notes for one date. `kind: "sample"` is hand-made demo data and must be shown with a
 * "Sample data" label; it never contains invented prices presented as real.
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
// Monday weekly report (the product, spec section 3)
// ---------------------------------------------------------------------------------------------

/** Scenario for the week with a rough probability; the three add up to 100. */
export type WeeklyScenario = Reasoned & {
  /** 0 to 100. */
  probability: number;
  /** Price levels involved, chosen from the code chart read. */
  levels: number[];
  /** What would trigger it. */
  trigger: string;
};

export type WeeklyView = {
  view: View;
  conviction: Confidence;
  /** Computed in code. */
  levels: Levels | null;
  /** The two or three reasons that matter most. */
  reasons: Reasoned[];
};

export type ChartReadSection = ChartRead & { text: Reasoned[] };

export type WeeklyAssetSection = {
  assetId: string;
  status: "ok" | "no-reading";
  /** 1. Last week recap: move, volume, drivers. */
  recap: Reasoned[];
  /** 2. Chart read on daily, weekly and monthly bars. */
  chart: Partial<Record<ChartInterval, ChartReadSection>>;
  /** 3. Market conditions that matter for this asset. */
  market: Reasoned[];
  /** 4. Geopolitics and news, every item with a dated source. */
  news: Reasoned[];
  /** 5. Week-ahead events (from code). */
  weekAhead: CalendarEvent[];
  /** 6. Bull, base and bear for the week. */
  scenarios: { bull: WeeklyScenario; base: WeeklyScenario; bear: WeeklyScenario };
  /** 7. This week's view. */
  view: WeeklyView;
  /** 8. Borrowing note (from code). */
  borrowing: BorrowNote;
  /** Strongest case each way from the debate step, kept for transparency. */
  debate?: { bull: Reasoned[]; bear: Reasoned[] };
  facts: Fact[];
};

export type InvestmentIdea = {
  rank: number;
  assetId: string;
  view: View;
  reasons: Reasoned[];
  /** How much the idea depends on past and current market conditions. */
  dependsOn: Reasoned;
  mainRisk: Reasoned;
};

/** General example split, never an order for a specific person. Shares add up to 1. */
export type ExampleSplit = {
  profile: "cautious" | "growth";
  slices: { assetId: string; share: number }[];
  why: Reasoned;
};

/** One thing that could make this week's views wrong, tied to facts and to the assets it affects. */
export type WrongAboutItem = { text: string; factIds: string[]; assetIds: string[] };

export type WeeklyReport = {
  kind: "live" | "sample";
  /** Monday the report is for. */
  weekOf: IsoDate;
  generatedAt: IsoDateTime;
  runId: string;
  /** True until the quality bar in spec section 7 has held for four Mondays in a row. */
  beta: boolean;
  /** Market-wide conditions (rates, dollar, VIX, S&P trend). */
  market: MarketOverview;
  assets: WeeklyAssetSection[];
  ideas: { ranked: InvestmentIdea[]; exampleSplits: ExampleSplit[] };
  /**
   * "What could we be wrong about?": the 2 or 3 things most likely to make this week's views wrong,
   * each citing report fact ids (asset facts as "assetId:factId", market facts as is) and the asset
   * ids it affects. Written last, by the summary step after every view is final, or built in code
   * from the sections' opposing scenarios when that step fails. Optional: reports approved before
   * this field existed do not have it, and every reader must work without it.
   */
  wrongAbout?: WrongAboutItem[];
  /** Last week's views and what happened. Wrong calls stay visible. */
  scorecard: Scorecard | null;
  /** Result of the risk reviewer pass. */
  review: { approved: boolean; sentBack: number; removedClaims: number; notes: string[] };
  model: { analysts: string; editor: string };
  costUsd?: number;
  disclaimer: string;
};

// ---------------------------------------------------------------------------------------------
// Scoring and track record (spec section 7)
// ---------------------------------------------------------------------------------------------

/** Automatic score of one daily note, filled in once 1 and 5 trading days have passed. */
export type DailyScore = {
  assetId: string;
  date: IsoDate;
  view: View;
  conviction: Confidence;
  priceAtNote: number;
  change1d?: number;
  change5d?: number;
  /** Did price move the way the view implied (accumulate up, reduce or avoid down, hold within 1 ATR). */
  direction1d?: boolean;
  direction5d?: boolean;
  /** Did the nearest support and resistance hold as described over 5 days. */
  levelsHeld?: boolean;
  /** Share of claims that cited a valid fact, 1 = 100%. */
  factsShare: number;
  /** Founder or growth grade, 1 to 5: would I pay for this. */
  humanGrade?: number;
};

export type ScorecardRow = {
  assetId: string;
  view: View;
  conviction: Confidence;
  priceAtCall: number;
  priceAfter: number | null;
  change: number | null;
  invalidated: boolean;
  result: "right" | "wrong" | "mixed" | "no-data";
  why: string;
};

export type Scorecard = {
  /** Monday of the week being scored. */
  weekOf: IsoDate;
  rows: ScorecardRow[];
  /** Calibration so far: for each conviction, how often it came true. */
  calibration: { conviction: Confidence; calls: number; right: number }[];
  /**
   * Brier score of the bull, base and bear probabilities of recent approved weekly reports
   * (engine/scores.ts `brierFromReports`). Optional: scorecards written before it existed do not
   * have it, and every reader must work without it. Shown only from BRIER_MIN_CALLS scored calls.
   */
  brier?: BrierSummary;
};

/** One Brier figure: the mean score and how many scored calls it rests on. */
export type BrierFigure = { score: number; calls: number };

export type BrierSummary = BrierFigure & {
  /** How many weekly reports the scored calls came from. */
  weeks: number;
  /** The same figure for each asset (its own calls only). */
  byAsset: ({ assetId: string } & BrierFigure)[];
};

/** A Brier score is shown only once it rests on at least this many scored calls. */
export const BRIER_MIN_CALLS = 8;

/** The plain-words tip next to the Brier score (three-outcome form, scale 0 to 2). */
export const BRIER_TIP =
  "Three-case Brier score: for each weekly call, the squared gaps between our bull, base and bear probabilities and what happened (1 for the case that happened, 0 for the other two), added up and averaged over calls. 0 is perfect and 2 is the worst; one third on each case every week would score 0.67.";

/** True when a Brier figure is complete and rests on enough calls to show. */
export function showableBrier(b: unknown): b is BrierFigure {
  if (typeof b !== "object" || b === null) return false;
  const { score, calls } = b as { score?: unknown; calls?: unknown };
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 2 && typeof calls === "number" && Number.isInteger(calls) && calls >= BRIER_MIN_CALLS;
}

// ---------------------------------------------------------------------------------------------
// Portfolio check (web/lib/research/portfolio): factual, no per-person orders (spec section 6)
// ---------------------------------------------------------------------------------------------

export type Holding = {
  assetId: string;
  /** Units of the asset (already divided by its decimals). */
  amount: number;
  /** Where the holding came from: read from the person's vault, or typed in by hand. */
  origin: "vault" | "manual";
  /** What the person paid in total, if known, in USD. */
  costUsd?: number;
  /** USD borrowed against this holding, if any. */
  loanUsd?: number;
  /**
   * Units locked as loan collateral (vault holdings), already divided by decimals. Loan health uses
   * only this, because the lending market counts only locked collateral, never idle tokens. When
   * missing, the whole `amount` is treated as collateral (manual entries).
   */
  collateralAmount?: number;
};

export type PortfolioInput = {
  holdings: Holding[];
};

export type AllocationSlice = { key: string; label: string; valueUsd: number; share: number };

/** Facts about one holding plus a link to the general view. Never a personal buy or sell order. */
export type HoldingFacts = {
  assetId: string;
  valueUsd: number;
  share: number;
  /** The general view from the latest research, for everyone, linked not personalised. */
  generalView: View | null;
  /** Borrowing note at this holding's own loan, or at 50% of the limit if there is no loan. */
  borrowing: BorrowNote | null;
  /** Loan against this holding as a share of its limit, if there is a loan. */
  limitUse?: number;
};

export type PortfolioAnalysis = {
  asOf: IsoDateTime;
  totalUsd: number;
  byAsset: AllocationSlice[];
  byClass: AllocationSlice[];
  /** 0 (all in one asset) to 1 (evenly spread). */
  diversification: number;
  /** Plain facts: one asset is a large share, the S&P 500 fund already holds Apple and NVIDIA, etc. */
  concentration: Reasoned[];
  overlaps: Reasoned[];
  holdings: HoldingFacts[];
  /** Loan health across the portfolio, if any loan. */
  loans: { totalLoanUsd: number; worstLimitUse: number | null; facts: Reasoned[] };
  facts: Fact[];
};

// ---------------------------------------------------------------------------------------------
// Access and payments (web/lib/research/access): paywall OFF until quality bar and legal check
// ---------------------------------------------------------------------------------------------

/** Spec section 8: one Monday report, or a month of Mondays. Amounts are the founder's to set. */
export const PLANS = ["free", "weekly-single", "monthly"] as const;
export type Plan = (typeof PLANS)[number];

export type Entitlement = {
  owner: string;
  plan: Plan;
  /** Monthly plan end, or null. */
  validUntil: IsoDateTime | null;
  /** Mondays bought one at a time and not opened yet. */
  weeklyCredits: number;
  /** Mondays already unlocked by a single purchase, so reopening is free. */
  unlockedWeeks: IsoDate[];
};

/** What a request needs, checked on the server before a paid report is shown. */
export type AccessCheck =
  | { allowed: true; consumesCredit: boolean }
  | { allowed: false; reason: "sign-in" | "payment-required" | "rate-limited" };

// ---------------------------------------------------------------------------------------------
// Wording shown on every page and report
// ---------------------------------------------------------------------------------------------

export const RESEARCH_DISCLAIMER =
  "Research only, not financial advice. This is general research for every reader, not a recommendation for you. AI-written analysis is marked as such and every number shows its source and time. Past calls can be wrong and are all shown in the scorecard, nothing here is a promise of returns, and tokenized assets can lose value. Stackday runs on Base Sepolia testnet with mock tokens.";

/** Shown next to the weekly report and asset pages until the quality bar has held. */
export const BETA_LABEL = "Beta: free preview while we prove the quality. Not yet a paid product.";
