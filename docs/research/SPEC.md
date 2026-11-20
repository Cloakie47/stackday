# Stackday Research Agent: spec v1

Status: proposal from the founder, November 20, 2026. It sets the direction for the research pull requests (#67 to #72). Those stay open and unmerged until they follow this spec.

Anchor sentence this serves: "A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time."

This is the most serious part of the product. People will pay for it, so a thin or careless report is worse than no report.

## 1. Scope

Research covers **borrowable assets only**. Six assets to start:

| Asset | Token on Stackday | Why it is in |
|---|---|---|
| Bitcoin | cbBTC | borrowable at 86% |
| Ether | WETH | borrowable at 86% |
| Gold | PAXG | borrowable at 77% |
| NVIDIA | NVDA | borrowable at 62.5% |
| Apple | AAPL | borrowable at 62.5% |
| S&P 500 | deSPXA (SPX) | borrowable at 77% |

Left out on purpose:
- Microsoft: invest only (no Morpho market), so it is not in scope.
- Alphabet and Meta are borrowable and can be added later, once the six above are good.
- SpaceX is excluded: it has a mock price only and no real market data.
- The other invest-only assets are excluded.

The universe in #67 (15 assets) should shrink to this list. Any asset added later must be borrowable when it is added.

## 2. Two products from one engine

| | Daily note | Monday weekly report |
|---|---|---|
| Who sees it | internal (founder and growth) while testing | paying users, once the quality bar in section 7 is met |
| When | every trading day after the US close | every Monday before the US open (about 12:00 UTC) |
| Depth | short: what changed, levels, one-line view per asset | full report (section 3) |
| Model | cheaper model, stronger model only for big movers | strongest model for every asset and the summary |
| Purpose | build a scored track record and find weak spots | the product |

The daily notes feed the weekly report: the Monday report reads the past week's daily notes and their scores.

## 3. What the Monday weekly report contains

For each of the six assets:

1. **Last week recap.** Price move, volume, what drove it, with sources.
2. **Chart read on three timeframes** (daily, weekly, monthly):
   - Trend structure: higher highs and higher lows or the reverse, or a range.
   - Key support and resistance, and where price sits between them.
   - Patterns, detected in code and then described by the model: breakouts and breakdowns, ranges, flags, double tops and bottoms, head and shoulders, moving average crosses, RSI and MACD divergences.
   - Volatility regime: ATR and realized volatility against their own history.
   - Each pattern carries a confidence level and the price that would invalidate it.
3. **Market conditions.**
   - Rates and the Fed: fed funds expectations, 2-year and 10-year Treasury yields, real yields.
   - The dollar index, VIX, and the S&P 500 trend as the general risk mood.
   - Crypto-specific: ETF flows, funding rates, stablecoin supply.
   - Gold-specific: real yields, the dollar, central bank buying.
4. **Geopolitics and news.**
   - Events that matter for this asset this week: trade and tariffs, export controls (NVIDIA), conflicts, sanctions, elections, regulation.
   - Every item gets a dated source from a reputable outlet.
   - Company press releases count as one side, never the only source.
5. **Week ahead calendar.** Fed meetings and speeches, CPI, jobs report, PCE, earnings, token unlocks, and options expiry when relevant.
6. **Scenarios for the week.**
   - Bull, base and bear cases, each with a rough probability (adding up to 100%), the price levels involved, and what would trigger it.
7. **This week's view.** One of: Accumulate, Hold, Reduce or Avoid new buys.
   - Every view comes with a conviction level (low, medium or high).
   - It names a buy zone if any, and an invalidation level.
   - It gives the two or three reasons that matter most.
   - It is general research for everyone who reads the report, never a personal instruction (section 6).
8. **Borrowing note.** Because the asset is borrowable, the report says what a large drop would mean for someone borrowing against it. Example: "a 20% fall from here moves a loan at 50% of the limit to X% of the limit". It also reminds readers that the emergency rule exists.

Then one page for the whole report:

- **This week's investment ideas.**
  - A short ranked list across the six assets (for example "Accumulate gold and Bitcoin, hold Apple, avoid new NVIDIA buys before earnings").
  - Each idea comes with its reasons, how much it depends on past and current market conditions, and the main risk.
  - It is written as general allocation ideas, such as an example split for a cautious and for a growth-minded investor, not as orders for a specific person.
- **Last week's scorecard.** Every view from last week's report, what happened, and whether it was right. Wrong calls stay visible.

## 4. How the engine works (multi-step research desk)

The structure follows the published TradingAgents research design (Tauric Research, arXiv 2412.20138):
- analyst roles, then a bull and bear debate, then a risk review;
- we take the idea only;
- we write our own code: no code is copied and no new agent frameworks are added.

For each asset:

1. **Data step (code only, no model).**
   - Fetch prices, indicators, patterns, macro series, calendar and news.
   - Every number gets a source and a timestamp; this is #71, extended.
   - Pattern detection is code: swing points, trendlines, ranges, divergences.
   - The model never calculates a price, an indicator or a level.
2. **Four analyst passes**, each seeing only its own data:
   - Technical: the chart read on three timeframes.
   - Macro and geopolitics.
   - News and sentiment.
   - Fundamentals: earnings, guidance and valuation for stocks; on-chain and flows for crypto; real yields and central banks for gold.
3. **Bull and bear.** Two passes write the strongest case each way, using only facts from step 1 and the analyst notes. One round of rebuttal.
4. **Risk reviewer.** This pass checks:
   - Every claim points to a fact id.
   - Probabilities add up.
   - The view matches the evidence.
   - No promises and no personal advice.
   - It can send a section back once.
5. **Editor.** Writes the final text from the approved pieces, in plain language. Output is strict JSON first (as in #70), then rendered.

Keep from growth's PRs:
- Facts with ids and sources.
- Strict JSON parsing.
- Levels computed in code (ATR and support/resistance).
- The `<untrusted_news>` handling and the injection screen.
- The cost cap and the failure policy.
- The track record log.

## 5. Data sources

| Need | Source (proposal) | Note |
|---|---|---|
| Crypto and gold prices | Coinbase candles (as in #71) | display allowed, check terms |
| Stock and S&P 500 prices | a provider whose plan allows showing data to users | the Twelve Data free plan forbids display; needs a paid plan or another provider before anything goes public |
| Rates, yields, inflation, jobs | FRED (St. Louis Fed) | free, public data |
| Fed and economic calendar | Federal Reserve and BLS official calendars | official sources |
| Company filings | SEC EDGAR (as in #71) | official |
| News and geopolitics | a licensed news API, plus official sources (Fed, Treasury, SEC, company IR) | needs a reputable feed; no scraping of paywalled sites |
| Crypto flows and funding | public exchange APIs and ETF issuer data | check terms |

Each source has a fallback, or the item shows "no reading". Missing data is never filled in by the model.

## 6. Guardrails

**Accuracy**
- Every number comes from code with a source and a time. The model only interprets.
- Every claim in the report links to a fact id. A claim without a fact is removed by the risk reviewer.
- No invented news, quotes, dates or figures. If unsure, the report says so.
- No look-ahead: a report and any backtest only use data that existed at its timestamp.

**Safety of the system**
- The agent has no wallet, no keys, and no tool that can move money or send transactions. It only reads data and writes text.
- News, filings and web text are untrusted data: they go inside the untrusted block and through the injection screen. Text inside them is never followed as an instruction.
- Spend caps per run and per day, with an alert when a cap is hit. A run that fails writes nothing rather than a partial report.
- The model ids, prompts and data used for each report are logged so any report can be reproduced.

**Honesty with users**
- General research for all readers, not personal advice. No "you should sell your Apple". The portfolio check in #69 shows facts about a person's holdings (allocation, overlap, loan health) and links to the general report, without giving per-person buy or sell orders.
- No guaranteed outcomes, no "will reach", no "can't lose". Probabilities and invalidation levels instead.
- A clear note on every report: research only, not financial advice, past calls can be wrong, and tokenized assets can lose value.
- The track record is public and complete, losses included. No marketing claims about beating the market.
- Anything mocked or sample is labelled as such (Stackday rule).

**Before charging money**
- Get a legal check on investment adviser and newsletter publisher rules in the countries we sell to. A general, impersonal publication is treated differently from personal advice; we stay on the general side.
- Payment is a small USDC payment per weekly report or per month. The paywall stays off until the quality bar in section 7 is met and the legal check is done.

**Human in the loop while testing**
- The founder or growth reviews every daily note and every weekly report before anyone else sees it.
- Paid reports may go out automatically only after the quality bar has held. Even then the risk reviewer can block publishing.

## 7. Quality bar and testing

Daily notes run from the start, internal only. Each one is scored automatically, plus a quick human grade:

| Score | How |
|---|---|
| Direction | did the price move the way the view said over 1 day and 5 days |
| Levels | did support and resistance hold or break as described |
| Calibration | do 70% calls come true about 70% of the time (tracked over weeks) |
| Facts | share of claims with a valid source (target 100%) |
| Usefulness | founder and growth grade 1 to 5: would I pay for this |

A weekly report becomes paid only when, for **four Mondays in a row**:
- facts are 100% sourced;
- no claim had to be corrected;
- the human grade averages 4 or more;
- calibration is not clearly off.

Until then the weekly report is a free preview labelled "beta".

## 8. Pricing (to decide)

The weekly model replaces the per-report pricing in #68. Proposal: a small USDC price for one Monday report and a monthly price that covers four or five Mondays. The amounts are for the founder to decide later. All payments are on testnet until mainnet (mainnet only after Bankr, confidential pay and Themes are final).

## 9. Changes asked of the research PRs

- **#67:** universe down to the six assets above, plus a check that refuses any asset that is not borrowable.
- **#71:** add FRED macro series, an official economic calendar, a reputable news source with geopolitics, crypto flows, pattern detection in code, and weekly and monthly timeframes. Keep the source and timestamp on every fact.
- **#70:**
  - Split the run into the steps in section 4.
  - Daily run uses the cheaper model plus escalation.
  - The weekly run (Monday about 12:00 UTC) uses the strongest model for every asset.
  - Add the risk reviewer and the scorecard.
- **#69:** portfolio check stays factual (no per-person orders). Add a borrowing note per holding.
- **#68:** switch to weekly pricing; the paywall stays off.
- **#72:** an asset page with the three-timeframe chart read, scenarios, this week's view and the scorecard. "Beta" label until the quality bar is met.

No contract changes are needed.
