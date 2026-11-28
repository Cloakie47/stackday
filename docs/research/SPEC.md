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
| Model | cheaper model, stronger model only when it matters (end of section 4) | strongest model for every asset and the summary |
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
- **What could we be wrong about?** (added November 28, 2026) The 2 or 3 things most likely to make this week's views wrong, each citing fact ids of the report and naming the assets it affects. The summary step writes it last, after every view is final. Code checks it (2 to 3 items, every fact id and asset id in the report, no promise or advice wording); invalid items are dropped, and when fewer than 2 remain, or the summary step fails, code builds the list from the sections' scenarios against each view and their debate, and the review notes say so. The whole-report check then requires 2 to 3 valid items on a new report with a researched section. Only if code cannot build 2 items either (not expected: every researched section has scenarios and a debate) is the report written without the section, marked not approved, with a note, so a run never produces nothing because of it. A report with no researched section has no list. Reports approved before this date do not have it and still show.
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
   - **Already priced in?** (added November 28, 2026) Code, not the model, measures how far the price moved over the last 5 daily bars in units of the daily ATR14 (from the existing 5-bar change, last close and ATR readings) and gives it as a fact (`ind.1d.move5atr`). The check fires at 3 ATR or more either way, whatever the view. On the recorded Coinbase daily candles in the repo (Bitcoin and Ether since late 2021, gold token PAXG), the median 5-bar move is about 0.8 ATR and 3 ATR or more happens on about 4 to 6 percent of days. When it fires, at least one view reason must say how much of the move may already be in the price and cite that fact; otherwise the view is sent back, even if the model reviewer approved. If the view still does not say so after the send-back, the section stays published with a note and is not auto-approved.
   - **Real or reward driven?** (added November 28, 2026) Crypto only. The engine has no token emission, reward or yield data, so the reviewer answers "reward driven" only when a fact in the report shows it (and must cite it), "real demand" only when a fact shows that, and otherwise "no data". Code turns a claim without a valid cited fact into "no data", and answers "not crypto" for the other assets. The reviewer never writes emission or yield figures. The answer is in the review notes.
   - It can send a section back once.
5. **Editor.** Writes the final text from the approved pieces, in plain language. Output is strict JSON first (as in #70), then rendered.

Keep from growth's PRs:
- Facts with ids and sources.
- Strict JSON parsing.
- Levels computed in code (ATR and support/resistance).
- The `<untrusted_news>` handling and the injection screen.
- The cost cap and the failure policy.
- The track record log.

### Daily note: the stronger model only when it matters (added November 28, 2026)

The daily note runs on the cheaper model (`RESEARCH_MODELS.dailyTriage`) and sends a note to `RESEARCH_MODELS.dailyEscalation` for one more pass when:
- the cheaper model's answer failed the checks;
- the asset is a big mover (a one-day move above 2 daily ATR, or a pattern completed that day);
- **market crisis** (every asset): Bitcoin down more than 7%, or the S&P 500 fund token (its on-chain price, not the index) down more than 3%, in a day. "In a day" is the worse of the last closed daily bar's change and the move from that close to the latest price; for crypto at 22:30 UTC the last closed daily bar is yesterday's, so today's fall shows in the second part. Why 7 and 3: on the recorded Coinbase daily candles in the repo, Bitcoin fell 7% or more on 21 of 1,840 days since November 2021; in the recorded FRED S&P 500 series (288 trading days from September 2025) the index fell 3% or more once. Both mark a rare, broad sell-off. One fall can fire on two runs in a row (today through the latest price, the next day through the closed daily bar), so it fires somewhat more often than those day counts;
- **stale price feed** (that asset): the data step says it could not read the current price ("no current price", for example when the Base RPC is down and the bars come from stored history only), or for crypto the latest price is more than 3 hours old at the run time;
- **low conviction near invalidation** (that asset): the checked conviction is low and the latest price is within 1.5 daily ATR of the view's invalidation level. The levels code puts invalidation at least 1 ATR (1.5 for Accumulate) from the daily close, so this fires only when price sits on its nearest level or has already moved toward invalidation since that close.

Hard limits, in code: at most `maxEscalations` (default 3) escalations per run. Failed answers and big movers may use every slot, as before; the three newer triggers leave the last slot for them, so a crisis day that fires for every asset uses at most 2 slots. Every call still goes through the run and day budget (`budget.ts`); an escalation that the budget left cannot cover, together with the cheap first pass of every asset not finished yet, is skipped with a line in the run log instead of stopping the run. Thresholds live in `ESCALATION_TRIGGERS` in `web/lib/research/flags.ts`, model names only in `RESEARCH_MODELS`. Each escalation, and each one skipped, is logged with its reason.

## 5. Data sources

| Need | Source (proposal) | Note |
|---|---|---|
| Crypto and gold prices | Coinbase candles (as in #71) | display allowed, check terms |
| Stock and S&P 500 prices | on-chain prices on Base (founder decision, November 25, 2026): Chainlink "Coinbase AAPL" and "Coinbase NVDA" feeds and their round history, the deSPXA Morpho oracle, and the main AAPLc, NVDAc and deSPXA pools | public on-chain data, free to show. Label them as the token's on-chain price, not the exchange price. Twelve Data is no longer used |
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
- Catalyst labels (added November 28, 2026): every news item, filing and calendar event carries one of three labels, set in code from the source. **Confirmed**: official sources (Fed, SEC, Treasury), company press releases, SEC filings and scheduled calendar events. **Reported**: a reputable outlet reports it, not the primary source. **Speculation**: outlet headlines worded as a rumour, an expectation or an opinion (a small keyword rule in code: "reportedly", "rumor", "could", "may" the verb, "might", "likely", "expected to", "set to", "poised to", "analysts say or expect", "sources say", "people familiar", opinion or analysis headlines, question headlines). The news analyst may lower a label, never raise it; code ignores a raise. The label shows as a badge next to each cited fact and on the week-ahead calendar.
- No look-ahead: a report and any backtest only use data that existed at its timestamp. Rule (added November 28, 2026), checked in code (`web/lib/research/engine/cutoff.ts`) before any model sees the facts, with a line in the run log for every fact dropped:
  - Every run has a cut-off, the one the data step already uses: 12:00 UTC on the run date for every slot of the Monday weekly report, the real run time for the daily note.
  - News: dropped when published after the cut-off (the item's publishedAt). Filings: when accepted by the SEC after it (or filed on a later date). Macro: when its observation is dated after it (the data step only keeps releases out by the cut-off). The headline, filing and funding fetchers already stop at the cut-off, so the engine check is a second line.
  - Market readings (prices, indicators, patterns, flows): price bars are cut at the cut-off by the data step. A live run also reads current values (on-chain feed and pool price, stablecoin supply) stamped with the time they were read; as decided in PR #82 these are kept up to the moment the run read its data, never later. A run for an earlier date keeps readings up to the cut-off only.
  - Calendar events are never dropped by their date: a Fed meeting or data release scheduled for next week is the point of the Week ahead calendar. Their time in our data is the moment we read the calendar or the event's own date, not a publication time, and the official calendars publish dates well in advance.

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
| Brier score (added November 28, 2026) | how well the weekly bull, base and bear probabilities matched what happened, lower is better (below) |
| Facts | share of claims with a valid source (target 100%) |
| Usefulness | founder and growth grade 1 to 5: would I pay for this |

A weekly report becomes paid only when, for **four Mondays in a row**:
- facts are 100% sourced;
- no claim had to be corrected;
- the human grade averages 4 or more;
- calibration is not clearly off.

Until then the weekly report is a free preview labelled "beta".

**Brier score of the weekly scenarios** (added November 28, 2026). Form: the three-case Brier score. For each scored weekly call, add up (p minus o) squared over bull, base and bear, where p is the published probability as a share and o is 1 for the case that happened and 0 for the other two; then average over calls. 0 is perfect and 2 the worst; one third on each case every week scores 0.67. On this scale a 50/50 guess between two cases scores 0.5: the familiar "0.25 is a coin flip" belongs to the single yes-or-no form, which is half of this one, and the tip on the page says which form is shown. It is computed in code each Monday over the approved live reports of the last 16 weeks (about the 120 days of daily scores the calibration reads), for all assets and for each asset, and shown on the weekly scorecard (all assets) and on the asset page (that asset only) only from 8 scored calls. Scorecards written before this have no Brier score and show no line.

Which case happened (outcome rule agreed by the founder on PR #103), from the section's own published numbers, never a model. Every level closer to the price at the call than 1 daily ATR (the ATR fact, else 2 percent of the price) is skipped, the same as the daily level scoring, so a level sitting right on the price cannot decide the outcome:
- upper line: the lowest level of the bull scenario above the price at the call; without one, the nearest resistance above that price (the view's code levels, else the daily chart read); without one either, the invalidation level when it is above the price;
- lower line: the mirror for bear (highest bear level below the price, else the nearest support, else the invalidation level when it is below the price);
- the week's close: the last fresh daily price of that asset from the report's Monday to the day before the next Monday, at least 3 of them;
- bull happened when that close is above the upper line, bear when it is below the lower line, base otherwise.

A call without both lines, without a price at the call, or with probabilities that do not add up to 100 is not scored.

Risk reviewer checklist for every weekly section (the step in section 4.4, run by code checks plus the model reviewer):
- every claim cites a valid fact id;
- scenario probabilities add up to 100 and fit the evidence;
- the view matches the evidence and the scenarios;
- no promises and no personal advice;
- already priced in: when the code check fires (a move of 3 daily ATR or more over 5 daily bars), the view says how much of the move may already be in the price, or the view is sent back;
- real or reward driven (crypto): flagged only when a fact in the report shows reward-driven activity, otherwise "no data"; no invented emission or yield figures.

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
