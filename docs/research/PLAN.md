# Research engine for Themes: plan

Owner: growthmindsetgg. Started 2026-11-19. Reworked 2026-11-20 to follow the founder's spec in `docs/research/SPEC.md` (PR #73). Status: on `gg/research-*` branches, waiting for founder review. The spec wins wherever this plan and the spec differ.

## Why it is in the anchor

The anchor says: "A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time." This engine is that reading and suggesting, done properly, for the assets a person can also borrow against.

## Scope (spec section 1)

Borrowable assets only: Bitcoin (cbBTC), Ether (WETH), Gold (PAXG), NVIDIA, Apple and the S&P 500 (deSPXA). `checkResearchable` in `web/lib/research/universe.ts` refuses any asset that is not in this list or not borrowable in `web/lib/deployment.json`. Alphabet and Meta can be added later; invest-only assets and SpaceX stay out.

## Two products from one engine (spec section 2)

| | Daily note | Monday weekly report |
|---|---|---|
| Who sees it | founder and growth only while testing | everyone, as a free "beta" preview until the quality bar holds; then paid |
| When | each trading day after the US close (22:30 UTC) | Monday about 12:00 UTC |
| Model | `claude-haiku-5-5`, escalating big movers to `claude-sonnet-5-5` | `claude-opus-5-5` for every asset and the summary |
| Content | what changed, levels, one-line view | recap, chart read on daily, weekly and monthly bars, market conditions, geopolitics and news, week-ahead calendar, scenarios with probabilities, this week's view, borrowing note; then ideas and last week's scorecard |

Views are Accumulate, Hold, Reduce or Avoid new buys, each with a conviction level, a buy zone if any and an invalidation level. They are general research for everyone, never a personal instruction.

## How a run works (spec section 4)

1. **Data, code only:** prices, indicators, chart patterns, trend structure, support and resistance, volatility regime, macro series (FRED), official calendars (Fed, BLS), news and geopolitics, filings (EDGAR), crypto flows. Every number is a `Fact` with a source and a time.
2. **Four analysts**, each seeing only its own facts: technical, macro and geopolitics, news and sentiment, fundamentals.
3. **Bull and bear**, one round of rebuttal, facts and analyst notes only.
4. **Risk reviewer:** every claim cites a fact id, probabilities add to 100, the view matches the evidence, no promises, no personal advice. It can send a section back once.
5. **Editor:** final plain-language text as strict JSON, then rendered.

Daily notes use a short version (one technical-plus-news pass, then the risk check). The weekly run uses all five steps.

## Honesty rules (non-negotiable, spec section 6)

- Code makes every number. The model only interprets and must cite fact ids; uncited claims are removed.
- Levels, patterns and the borrowing note are computed in code and say how.
- News, filings and web text are untrusted: inside the `<untrusted_news>` block and through the injection screen.
- The agent has no wallet, no keys and no tool that moves money.
- Spend caps per daily run (`RESEARCH_MAX_RUN_COST_USD`, default $2), per weekly run (`RESEARCH_MAX_WEEKLY_RUN_COST_USD`, default $4) and per day (`RESEARCH_MAX_DAY_COST_USD`, default $6). A failed run writes nothing.
- Model ids, prompt version and a hash of the data are logged per run so any report can be reproduced.
- The scorecard is public and complete, wrong calls included. No claims of beating the market.
- Every page and report carries `RESEARCH_DISCLAIMER`; the weekly report carries `BETA_LABEL` until the quality bar holds.

## Quality bar (spec section 7)

Each daily note is scored automatically after 1 and 5 trading days (direction, levels, facts share) and graded 1 to 5 by a person. Calibration is tracked by conviction. The weekly report becomes paid only after four Mondays in a row with every fact sourced, no corrections, an average human grade of 4 or more, and calibration not clearly off.

## Branches and who owns which files

All branch from `gg/research-core` (this branch: shared types in `web/lib/research/types.ts`, the universe and its check, the borrowing note, flags and the `research_*` tables in `supabase/schema.sql`).

| Branch | Owns | Delivers |
|---|---|---|
| `gg/research-data` (#71) | `web/lib/research/data/**` | Prices on daily, weekly and monthly bars, indicators, pattern detection and chart read in code, FRED macro, Fed and BLS calendars, news and geopolitics, EDGAR filings, crypto flows |
| `gg/research-engine` (#70) | `web/lib/research/engine/**`, `web/app/api/research/run`, `weekly`, `snapshot`, `history`, `scores` | Analyst desk, bull and bear, risk reviewer, editor, daily and weekly runs, cost caps, scorecard and track record |
| `gg/research-portfolio` (#69) | `web/lib/research/portfolio/**`, `web/app/api/research/portfolio` | Factual portfolio check with a borrowing note per holding, no per-person orders |
| `gg/research-access` (#68) | `web/lib/research/access/**`, `web/app/api/research/access` | Weekly pricing (one Monday or a month), paywall off |
| `gg/research-ui` (#72) | `web/app/(app)/research/**`, `web/components/research/**` | Weekly report page, asset page with the chart read, scenarios, view and scorecard, portfolio check, beta label |

## API contract between branches

Reviewers are the wallets in `RESEARCH_REVIEWERS` (comma-separated, lowercase), signed in with the existing wallet sign-in. Every route keeps working with no keys or database: it then serves the labelled sample.

| Route | Who | Returns |
|---|---|---|
| `GET /api/research/weekly?weekOf=YYYY-MM-DD` (engine) | everyone | `{ report: WeeklyReport, access: AccessCheck }`. Latest approved report when `weekOf` is missing. Unapproved reports only for reviewers. Falls back to the sample report (`kind: "sample"`). |
| `POST /api/research/weekly/approve` `{ weekOf }` (engine) | reviewers | `{ ok: true }`: marks the report approved and published |
| `GET /api/research/snapshot` (engine) | reviewers for live daily notes, everyone for the sample | `{ snapshot: ResearchSnapshot, internal: boolean }` |
| `GET /api/research/history?asset=mAAPL` (engine) | reviewers (live), everyone (sample) | `{ assetId, kind: "live" \| "sample", notes: { date, view, conviction, price, summary }[], track: { calls, right } }` |
| `GET /api/research/scores?asset=mAAPL` (engine) | everyone | `{ scores: DailyScore[], calibration: Scorecard["calibration"] }` |
| `POST /api/research/scores/grade` `{ date, assetId, grade }` (engine) | reviewers | `{ ok: true }` |
| `GET /api/research/run`, `GET /api/research/weekly/run` (engine) | Vercel cron with `CRON_SECRET` | run summary |
| `POST /api/research/portfolio/preview` `PortfolioInput` (portfolio) | everyone, nothing saved | `{ analysis: PortfolioAnalysis, reportKind: "live" \| "sample" }` |
| `GET/PUT /api/research/portfolio` (portfolio) | signed in | saved manual holdings |
| `GET /api/research/access` (access) | everyone | `{ paywallEnabled, prices, entitlement \| null, payment: { enabled, payTo, usdc } }` |
| `POST /api/research/access/pay` `{ txHash, purpose }` (access) | signed in | verifies a test-USDC payment for `weekly-single` or `monthly` |

Crons (in `web/vercel.json`, engine branch): daily run `30 22 * * 1-5`, weekly run `0 12 * * 1`, score update `0 23 * * 1-5`. Never the founder's keeper cron on our own Vercel project.

## Needs the founder

1. Amounts for the single Monday report and the monthly plan (spec section 8).
2. A licensed news feed. (Stock prices: decided on November 25, 2026, the tokens' on-chain prices on Base, see web/lib/research/data/SOURCES.md section 2.)
3. `ANTHROPIC_API_KEY` with an account spend limit, `CRON_SECRET`, `SEC_USER_AGENT`, `RESEARCH_ENGINE_ENABLED=true`.
4. Apply the `research_*` tables from `supabase/schema.sql`.
5. The legal check before the paywall is switched on.
