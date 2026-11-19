# Research engine for Themes: plan

Owner: growthmindsetgg. Started 2026-11-19. Status: building on `gg/research-*` branches, waiting for founder review.

## Why it is in the anchor

The anchor says: "A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time." This engine is that reading and suggesting, done properly. Every day it researches each Stackday asset (stocks, the S&P 500 and Treasury funds, gold, Bitcoin and Ether), writes a short note with a suggested action, and turns it into market and portfolio reports on demand. It extends the founder's binding answers on PR #3 (issue #22) and does not replace them.

## What a person gets

1. **Research list** (`/research`): every asset, searchable, each with a 2 to 3 line summary: where it stands and what happened, the opportunity and the risk, and a suggested action (Buy, Hold, Sell or Watch). Where it makes sense it also shows an entry, a target and a stop, with a confidence level.
2. **Asset page**: outlook for 1 hour, 1 day, 1 week, 1 month, 1 year and 5 years. Every reason cites its facts, and each fact shows its source and time. Bull, base and bear scenarios. The history of past suggestions and how each one turned out.
3. **Portfolio report**: reads the person's vault holdings (plus anything they type in) and checks allocation, diversification by asset class, sector and risk, concentration, overlap (for example the S&P 500 fund already holds Apple and NVIDIA), whether each holding still looks worth keeping, ideas to redirect new money, and an overall health score.
4. **Reports on demand and on a schedule**: market, single asset, portfolio, or everything, daily, weekly or monthly.
5. **Plans** (behind a switch until the founder agrees pricing): free tier, pay per report, monthly or yearly plans, and premium depth. All payments are test USDC on Base Sepolia.

## Honesty rules (non-negotiable)

- Code fetches every number and turns it into a `Fact` with a source and a timestamp. The model never writes a price, a metric or a link.
- The model returns strict JSON: picks from fixed lists plus short text, and each reason cites fact ids. A reason with no valid fact id is dropped. Anything that fails the schema becomes "no reading", and nothing is invented to fill the gap.
- Entry, target and stop are computed in code from price data (ATR, support and resistance) and show how they were computed. They are never shown for SpaceX (no public price) or the Treasury fund (cash-like).
- AI-written text carries an "AI analysis" label. Facts carry "Data". Every report starts and ends with `RESEARCH_DISCLAIMER`.
- No claims of beating the market (docs/07 found no evidence that a weekly signal does). Each suggestion goes into a log next to plain weekly buying, so its track record is public, good or bad.
- News text is untrusted. The founder's PR #3 rules apply: primary sources first (SEC EDGAR with a User-Agent, company press-release RSS), no scraping, and an article flagged as a possible prompt injection gets zero weight.
- Founder failure policy: up to 2 assets may show "no reading". More failures, a failed whole-run check, or the cost guard (`RESEARCH_MAX_RUN_COST_USD`, default $2) means the run writes nothing and the last good snapshot stays live.
- Suggestions never move money. Themes caps stay "targets for new buys", and rebalance ideas only redirect new money.

## Architecture

```
cron (weekdays + crypto daily) -> /api/research/run (CRON_SECRET)
   data/      prices, indicators, calendars, news + filings   -> Fact[]
   engine/    Haiku 5.5 triage, Sonnet 5.5 escalation, one swappable server function -> ResearchNote[]
              validate -> write research_* tables (or keep last good snapshot)
/api/research/snapshot   public, latest notes + market overview (falls back to the labelled sample)
/api/research/history    notes over time for one asset
/api/research/report     builds a Report; checks access first
/api/research/portfolio  saves manual holdings, horizon, risk (signed in)
/api/research/access     plans, credits, verify a test-USDC payment
/research pages          list, asset page, portfolio, reports, plans
```

The site must keep working with no keys set: it then shows the labelled sample snapshot and no paywall.

## Branches and who owns which files

All branch from `gg/research-core` (this branch: shared types in `web/lib/research/types.ts`, the universe, flags and the `research_*` tables in `supabase/schema.sql`). Each later branch only adds files in its own folders. If one needs a change to a shared type, it goes into `gg/research-core` first.

| Branch | Owns | Delivers |
|---|---|---|
| `gg/research-data` | `web/lib/research/data/**` | Price history by interval, indicators, NYSE plus crypto trading calendar with holidays, EDGAR filings and RSS news turned into `Fact[]`, source terms listed for the founder |
| `gg/research-engine` | `web/lib/research/engine/**`, `web/app/api/research/run`, `snapshot`, `history`, `web/lib/research/sample-snapshot.json` | Model prompts and strict parsing, levels in code, daily run with cost guard and failure policy, storage, labelled sample snapshot, suggestion log |
| `gg/research-portfolio` | `web/lib/research/portfolio/**`, `web/lib/research/reports/**`, `web/app/api/research/report`, `portfolio` | Portfolio analysis, report builder (market, asset, portfolio, full; daily, weekly, monthly), schedules |
| `gg/research-access` | `web/lib/research/access/**`, `web/app/api/research/access` | Plans, credits, entitlement check, test-USDC payment check on Base Sepolia, all behind `RESEARCH_PAYWALL_ENABLED` |
| `gg/research-ui` | `web/app/(app)/research/**`, `web/components/research/**` | List with search, asset page, portfolio report, report builder, plans page, nav entry |

## Needs the founder

1. Agree that this engine is the Themes weekly refresh from issue #22, now run daily, with the suggestions labelled as research.
2. Pricing for reports and plans (a new revenue line beyond the fee rule in issue #45). Until then `RESEARCH_PAYWALL_ENABLED` stays off.
3. Set `ANTHROPIC_API_KEY`, `CRON_SECRET`, `SEC_USER_AGENT` and an account spend limit, plus `RESEARCH_ENGINE_ENABLED=true`.
4. Apply the new `research_*` tables from `supabase/schema.sql`.
5. Read the terms of the price data source we pick (listed in the data branch's PR) before it goes live.
