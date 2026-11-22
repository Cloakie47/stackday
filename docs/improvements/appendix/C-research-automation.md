> Checked on 2026-11-21: the Vercel limits (docs: Hobby 300s maximum, Pro 800s), `maxDuration = 800` on the weekly route, the missing already-ran guard in `weekly.ts`, the X API prices (docs.x.com pricing) and the xAI prices (docs.x.ai models).

# Research automation plan for Stackday (weekly report, Grok, selected stocks)

Written 2026-11-21. Research and planning only. No repo files were edited. Not investment advice. Items marked **[unverified]** could not be confirmed against a primary source.

## 0. Short answers

1. **The automation already exists.** A Vercel cron calls the weekly engine every Monday, the engine writes an unapproved report, a reviewer approves it, and everyone (or everyone who paid, once the paywall is on) reads the same report. What is missing is small: a "selected stocks" view, a notification when the report is published, a retry after a failed run, and (optional) an X posting job.
2. **Can the existing Grok bot do the weekly research?** Not as the engine. The founder spec fixes the Claude models, and changing them needs founder approval. Grok is a good fit as a **distribution channel** (post the approved summary on X) and, later and optionally, as an **extra source of X posts** that goes through the injection screen like any other news. We could not find any "Grok bot" in the repo or notes, so what the team means by it is unknown (section 3).
3. **One shared report, not per user.** That is exactly how it is built. "Selected stocks" should be a filter on the page, not a new generation.
4. **Honesty rule.** A backtest found the code's levels, patterns and views did no better than random on 3.5 years of prices. No page, post or email may claim an edge, "alpha" or "beats the market". The product is organised, sourced reading material with a public scorecard.
5. **One real risk found.** The weekly route sets `maxDuration = 800` seconds. Vercel's Hobby plan caps functions at 300 seconds, so the weekly run needs a Vercel **Pro** project or must be split (section 4 and 6).

## 1. Each team ask mapped to what exists

| Team ask | Status | Where it lives | What is left |
|---|---|---|---|
| "Plan how exactly the agent research can be automated" | **Built** | `web/vercel.json` crons: daily run `30 22 * * 1-5` to `/api/research/run`, weekly run `0 12 * * 1` to `/api/research/weekly/run`, score update `0 23 * * 1-5` to `/api/research/scores/run`. Engine in `web/lib/research/engine/` (weekly.ts, daily.ts, budget.ts, review.ts, reviewers.ts). | This document's runbook (section 5). Add: retry after failure, publish notification, optional X post. |
| "Can we use our existing Grok bot to automate weekly market research?" | **Not built, and not advised as the engine** | Engine is Claude only: `RESEARCH_MODELS` in `web/lib/research/flags.ts` (haiku-5-5, sonnet-5-5, opus-5-5). | Decide Grok's role (section 3). Founder approval needed to change any model. |
| "When a customer pays, they can view the weekly report for their selected stocks" | **Partly** | Payment and entitlements built: `web/lib/research/access/` (gate, entitlement, pay, store), `GET/POST /api/research/access`, `/access/pay`, Supabase `research_entitlements` and `research_payments`. Weekly route calls `checkReportAccess` before returning the report. Report page already shows one card per asset. Paywall is off (`RESEARCH_PAYWALL_ENABLED`). | "Selected stocks" choice and filtered view (section 2). Mainnet payments are out of scope until the team decides. |
| "Generate one weekly report for all listed stocks, share with everyone who pays" | **Built** | `runWeekly` writes one row in `research_weekly` (one `body` JSON, keyed by `week_of`). `GET /api/research/weekly` serves it to all. | Nothing to build. Keep it this way. |
| "Research the best agents and tools" | **Done here** | Section 4. | Founder reads and picks. |
| Reviewer approval before publish | **Built** | `POST /api/research/weekly/approve`, wallets in `RESEARCH_REVIEWERS`, page `/research/review`. | Add a reminder to reviewers when a report is waiting (section 5). |
| Spend caps | **Built** | `budget.ts`, `RESEARCH_MAX_WEEKLY_RUN_COST_USD` default $4, `RESEARCH_MAX_DAY_COST_USD` default $6. | Set an account limit at Anthropic too. |
| Notify paying users | **Missing** | No email or push code exists in the repo (searched `lib`, `app`, `components`). | Choose in-app banner first, email later (section 5). |
| Post on X | **Missing** | None. | Optional (section 3). |

## 2. "Selected stocks": design (small)

**Principle.** The report is generated once for all six assets. A paying user picks which of the six they care about. The page shows only those sections. Nothing is regenerated and no model is called per user.

**What stays the same.** Payment and access checks stay at the report level: `checkReportAccess` still decides "paid or not" for the whole weekly report. Selection does not change what a person paid for, it only changes what they see. If the team wants "pay per stock" pricing, that is a pricing change for the founder (spec section 8), not part of this design.

**Storage.** Add one small table to `supabase/schema.sql` next to `research_portfolios`, same style (wallet key, row security on, no policies, server only):

```
research_watchlists (
  wallet     text primary key  -- lowercase 0x address, same check as research_entitlements
  asset_ids  text[] not null default '{}'   -- for example {mBTC, mNVDA}; each must pass checkResearchable
  updated_at timestamptz not null default now()
)
```

Why a table and not only the browser: a person signs in with a wallet on several devices, and the email or X notice later needs to know who cares about what. Fallback for signed-out people: keep the choice in the browser (localStorage) and do not save it.

**Route.** New `GET` and `PUT /api/research/watchlist`, modelled on the existing `/api/research/portfolio` route: signed in with the wallet session, body `{ assetIds: string[] }`, every id checked with `checkResearchable` from `universe.ts`, at most six. Returns `{ assetIds }`. Estimated size: one route file, one small store file, tests.

**Page changes (all in `web/app/(app)/research/` and `web/components/research/`).**
- `weekly-report.tsx`: after loading the report, filter `report.assets`, `report.ideas.ranked` and `report.scorecard.rows` to the selected ids. Keep the market overview, the disclaimer and the beta label always visible. Show a line "Showing 2 of 6 assets. Show all."
- Add a small "My stocks" checkbox row (six assets, reuse `ResearchAssetIcon`) at the top of the weekly page, saved with `PUT`. Default for a new payer: all six selected, so nobody sees an empty page.
- `[asset]/page.tsx`: no change (a direct link to any asset still works for a payer).
- `plans-page.tsx`: after payment succeeds, send the person to the weekly page with the picker open.

**Server filtering later (optional).** To avoid sending all six sections to someone who chose two, add `?assets=mAAPL,mNVDA` to `GET /api/research/weekly` and trim the JSON there. Do this only if pricing ever depends on the number of stocks, because anyone can ask for all six otherwise.

**Do not** let selection change the scorecard's honesty: the public track record stays complete for all assets, wrong calls included. Filtering only applies to a payer's own page.

## 3. Grok and X: what the options really are

We found no Grok bot in the repo, the docs folder, or the memory notes, so these are the three likely meanings. **Ask the team which one they mean.**

### (a) An xAI API key (programmable)

- Models and prices, per million tokens, from the xAI models page (https://docs.x.ai/docs/models): grok-4.7 is $2.00 input, $0.50 cached, $6.00 output below 200k tokens; grok-4.3 is $1.25 input and $2.50 output. Compared with the Claude prices we use (Opus 5.5 $4 in / $20 out, Sonnet 5.5 $2 / $10, https://platform.claude.com/docs/en/about-claude/pricing), Grok is cheaper per token. Quote: "grok-4.7 ... is the most capable model we've built" (paraphrase of the page, which calls Grok 4.7 its most capable).
- **Live Search is gone.** The old "Live Search" API (configured with `search_parameters`) was deprecated, and one forum post says it now returns HTTP 410 (https://community.make.com/t/x-ai-node-integration-error-410-live-search-deprecated-switch-to-agent-tools-api/102097). The replacement is two server-side tools in the Responses API, `web_search` and `x_search`. Quote from xAI: "Tool requests are priced based on two components: token usage and tool invocations." (https://docs.x.ai/docs/guides/tools/overview). The exact retirement date differs between sources (December 15, 2025 deprecation, January 12, 2026 shutdown) **[unverified, third party]**; it does not matter because both are past.
- **X Search tool.** Lets Grok "run keyword search, semantic search, user search, and thread fetch on X", with handle filters (up to 20 handles) and `from_date` / `to_date` (https://docs.x.ai/developers/tools/x-search). Cost: "$5 per 1k" posts fetched and "$10 per 1k" profiles fetched, on top of tokens (same page). Web Search is "$5 per 1,000 calls" (https://docs.x.ai/developers/pricing).
- **Rate limits.** Spend tiers from Tier 0 ($0) to Tier 4 ($5,000); quote: "Tiers unlock automatically as your spend increases." grok-4.7 gets 150 requests per second at Tier 0 (https://docs.x.ai/docs/key-information/consumption-and-rate-limits). Far above our needs (about 30 to 60 calls a week).
- **Terms on financial content.** We could not read the current xAI terms (the pages returned 403 to our fetch). Search snippets of older versions say output "is not professional advice" and customers must check accuracy (https://x.ai/legal/terms-of-service, archived 2025 versions) **[unverified for the current text]**. Founder or a lawyer should read https://x.ai/legal/terms-of-service-enterprise before use, since the API is covered by the enterprise terms.
- **Security lesson from our own research.** In May 2026 Grok's wallet on Bankr was drained after Grok decoded a Morse-code message that Bankrbot executed (our `docs/07-research-agent.md`, sources https://cointelegraph.com/news/grok-bankr-wallet-free-nft-prompt-injection and https://giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet). Rule for any Grok or X bot of ours: no wallet, no keys, no tool that moves money, and text from X replies is never an instruction.

### (b) X Premium with Grok inside the X app (not programmable)

This is a consumer subscription. You can ask Grok questions in the app, but you cannot schedule it, call it from code, or have it publish our report. Whether a paid Grok subscription also includes API credits is **unclear**: xAI's pricing page lists "Grok API access" under a shared usage pool, while several third-party guides say API billing is separate (https://x.ai/pricing, summary from a search; **[unverified]**). Do not plan on it. If the team's "Grok bot plan" is this, it cannot automate anything and should be treated as a manual research helper only.

### (c) A paid X API tier for a bot account (programmable, this is the "bot on X")

- The X API pricing page now describes only pay-per-usage: "pay-per-usage pricing with no subscriptions" (https://docs.x.com/x-api/getting-started/pricing). Reads: $0.005 per post, $0.010 per user. Writes: $0.015 per post, and "$0.200" for a post that contains a URL. Capped at 3 million post reads per month on this plan. The older Basic and Pro tiers are not on that page **[unverified whether they still exist]**.
- **What this costs us.** One weekly summary post with a link to the report is about $0.20 a post, so under $1 a month for posting. Reading X posts for sentiment is the larger item: 300 posts a week would be about $1.50 a week at $0.005 each.
- **Automation rules.** Primary page https://help.x.com/en/rules-and-policies/x-automation returned 403 to us, so these quotes come from a search summary of that page and the developer guidelines **[quotes unverified against the live page]**: "Automating these actions to reach many users on an unsolicited basis is an abuse of the feature, and is not permitted." Also: sending automated replies "based on keyword searches alone is not permitted." Bots must "Enable the 'Automated' profile label" (https://docs.x.com/developer-guidelines). Deceptive behavior such as "misleading links/redirects" is prohibited (same page).
- **What this means for us.** Posting our own approved summary from our own account is allowed in principle. Mass unsolicited replies and mentions are not. The account needs the Automated label, a bio that says it is a bot and names the operator, and the standard "research only, not advice" line. A paid-promotion or tipster style post about financial products can also raise legal questions, which is part of the legal check the spec already requires before charging.

### Recommended role for Grok (honest version)

| Option | Verdict | Why |
|---|---|---|
| Replace the Claude engine | **No** | Spec fixes the models. It would also throw away the reviewed pipeline and cost caps. Needs founder approval at minimum. |
| **Distribution channel on X** | **Yes, optional, low risk** | After a reviewer approves the report, one scheduled job posts a short summary and link from an X account that is labelled Automated. About $0.20 a post. The poster is plain code that formats approved text. Grok is not needed for this at all. |
| Extra X-sentiment source | **Maybe later** | Use `x_search` (about $5 per 1,000 posts plus tokens) to fetch posts for the six assets. Every post must be stored as a `Fact` with its URL and time, put inside the `<untrusted_news>` block, and pass the injection screen. Grok's own summary of sentiment is not a sourced fact and must not be cited. Hackathon timing says skip. |
| Second opinion reviewer (different vendor) | **Maybe, needs approval** | A non-Claude pass could catch Claude's blind spots in the risk-review step, but it adds a second vendor, key and terms review. Not for this deadline. |

If the answer to "what is the Grok bot" is (a) or (c), start with the X posting job only.

## 4. Best agents and tools for the pipeline

Prices from https://platform.claude.com/docs/en/about-claude/pricing (Claude) and other pages as linked.

| Option | Fit | Cost | Verdict |
|---|---|---|---|
| **Vercel cron + Anthropic API, as built** | Already coded, tested, spend-capped, writes nothing on failure | Opus 5.5 $4 in / $20 out per million tokens; weekly cap $4 (code). Vercel crons: "100 cron jobs" per project on all plans (https://vercel.com/docs/cron-jobs/usage-and-pricing). Hobby timing is "Per-hour (±59 min)"; Pro is per-minute. | **Keep.** Needs Pro for the 800 s run (below). |
| Anthropic **Batch API** | 50% off: Opus 5.5 batch is $2 in / $10 out. Results arrive asynchronously. | About half the weekly model cost. Our own earlier estimate says savings are only a few dollars a year at our size (`docs/07`, section 5.2). Weekly run uses send-back loops and per-step dependencies, so it would need a rewrite into submit and collect steps. | **No for now.** Revisit if the universe grows past about 50 assets. |
| **Claude Managed Agents** | Hosted agent sessions with a sandbox | Tokens at normal rates plus "$0.08 USD per session-hour"; no batch discount (same pricing page). | **No.** We do not need an open-ended agent. A fixed pipeline with no money tools is safer and cheaper. |
| Claude Agent SDK / scheduled cloud agents (Claude Code routines) | Good for developer chores such as a weekly check that the report looks sane | Subscription or token cost | **Use only for ops**: e.g. a Monday routine that reads the published report and flags empty sections. Not for generating the product. |
| n8n / Zapier | Glue: "when approved, send email and post to X" | n8n and Zapier pricing **[unverified, not looked up]**; adds another account holding secrets | **Not needed.** One more cron route in our app does the same with fewer secrets. |
| xAI / Grok | See section 3 | grok-4.7 $2 / $6 per million tokens | **Distribution first, data source later.** |
| Email sender (Resend, Postmark etc.) | Needed only if we email payers | Price and free tier **[unverified, not looked up]** | In-app banner first. Pick a provider only if the founder wants email. |

**Vercel duration finding.** Vercel's table says Hobby has a maximum of "300s (5 minutes)" and Pro up to "800s" (https://vercel.com/docs/functions/configuring-functions/duration). The weekly route exports `maxDuration = 800`. On Hobby that will not work, or will be clamped, and a six-asset Opus run may not finish in 300 seconds **[run time not measured]**. Options: (1) put the project on Pro, (2) split the run into one request per asset plus one summary step, saving partial results and publishing only when all are present. Option 1 is far less work; Pro also gives exact-minute cron timing.

## 5. Weekly runbook (all times UTC)

Until the deadline the US is on winter time, so on Mondays the US stock market opens at 14:30 UTC.

**Every trading day (already built)**
- 22:30 daily run writes internal daily notes (cheap models). Reviewers only.
- 23:00 scores update. Nobody approves; it fills the scorecard.

**Monday (weekly report)**
| Time | What happens | Who | If it fails |
|---|---|---|---|
| 12:00 | Cron calls `/api/research/weekly/run` with `CRON_SECRET`. Gathers data, runs analysts, bull and bear, risk reviewer, editor. Writes an **unapproved** report. | Automatic | The run writes nothing, returns an error, and the cost guard stops spending past the cap. On Hobby the start may slip up to 59 minutes. |
| 12:00 to 13:00 | Report appears in `/research/review` for reviewers only. | Automatic | See next row. |
| 13:00 | **Add (new):** a retry cron `0 13 * * 1` that calls the same route only if no report exists for this week. The route has no "already ran" check today (searched `weekly.ts`), so add one first, otherwise a second run costs another report and budget. | Developer | If the retry also fails, the page keeps showing last week's report plus a note, never the sample as if it were live. Founder is alerted (below). |
| 13:00 to 14:00 | Reviewer opens the report, checks sources, fixes nothing in place, then approves or rejects. Reject means "no report this week", not a patched one. | Reviewers (wallets in `RESEARCH_REVIEWERS`) | If nobody approves by 14:15, the report simply is not published and last week's stays up. |
| On approve | Report becomes visible to everyone (beta) or to payers (paywall on). **Add (new):** same approve call triggers notifications (below). | Automatic after approval | A failed notification must not undo publishing. Log it and retry once. |
| 14:30 | US market opens. | | |

**Alerts to the founder.** Today there is none, only the cron's HTTP status in Vercel logs. Minimum: turn on Vercel's failed-cron notifications and add a spend alert in the Anthropic Console **[exact Vercel setting not checked]**.

**How payers learn the report is out**
1. **In-app (build first):** a "New weekly report: week of ..." banner on the app home and the `/research` page for any signed-in wallet with access. No new service.
2. **X post (optional):** after approve, one job posts "This week's Stackday research is out" with the link and the disclaimer line. About $0.20 per post. Posts go only after a reviewer has approved. Not a tip, not a call to action to buy.
3. **Email (later):** needs an address from the user (the app is wallet-only today, so this is a new data field and a privacy notice) and an email provider. Skip unless the founder asks.

**Weekly honesty checklist for the reviewer (copy into the review page).** Every number has a source. No "will reach". No claim of beating the market. Wrong calls from last week are visible in the scorecard. Beta label still on until the four-Monday bar holds.

**Environment variables the founder must set (Vercel dashboard, never in chat)**

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` (with an account spend limit set in the Anthropic Console) | engine |
| `RESEARCH_ENGINE_ENABLED=true` | turns the engine on |
| `CRON_SECRET` | protects cron routes |
| `RESEARCH_REVIEWERS` (comma-separated lowercase wallets) | who can approve |
| `SEC_USER_AGENT` | EDGAR filings |
| `RESEARCH_PRICE_PROVIDER` and `RESEARCH_PRICE_API_KEY` | AAPL, NVDA, S&P prices; the free Twelve Data plan forbids showing data to users |
| `FRED_API_KEY` (optional) | macro data |
| a licensed news feed key, if one is chosen | news (currently GDELT plus official feeds) |
| Supabase URL and service key (existing) and the `research_*` tables applied | storage |
| `RESEARCH_PAYWALL_ENABLED` (leave off until the quality bar and legal check) | paywall |
| `RESEARCH_MAX_RUN_COST_USD`, `RESEARCH_MAX_WEEKLY_RUN_COST_USD`, `RESEARCH_MAX_DAY_COST_USD` (defaults $2 / $4 / $6) | spend caps; the day cap must be at least the weekly cap |
| New, only if X posting is built: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` (names are suggestions) | posting from the bot account |
| New, only if Grok data is built: `XAI_API_KEY` | `x_search` |

## 6. Does it fit before Dec 5, 2026? What Justin must do

**Fits, with the right scope.** Today is Nov 21, so there are two Mondays before the deadline (Nov 23 and Nov 30), and Dec 5 is a Saturday. The engine is built but waits for founder review of the research PRs. Realistic plan:

| Item | Size | Before Dec 5? |
|---|---|---|
| Founder review and merge of the research PRs, set env vars, apply tables | founder action | Yes, this is the critical path |
| Pro plan (or split the weekly run) | founder action or 1 to 2 days | Yes if Pro |
| Idempotency check plus retry cron | small | Yes |
| Selected stocks (table, route, page filter) | small, about 1 day | Yes |
| In-app "new report" banner | small | Yes |
| X posting job | small code, but needs an X developer account, Automated label, bio | Yes if the account is ready, otherwise show as roadmap |
| Grok `x_search` data source | medium, needs terms read and injection-screen work | **No**, list as next step |
| Email notices | medium, new data and provider | **No** |
| Paywall on | needs four good Mondays plus legal check | **No.** Four Mondays cannot finish before Dec 5, so the demo shows the beta label and test-USDC payment, which is what the spec intends |

**Needs from Justin (founder)**
1. Decide Grok's role: which of (a), (b), (c) the team means, and approve "distribution channel only" (recommended) or something larger. Approve any model change explicitly.
2. Upgrade the Vercel project to Pro, or approve splitting the weekly run.
3. Set the env vars above and an Anthropic account spend limit.
4. Pick the price provider and news feed that allow showing data to users.
5. Name who the reviewers are and agree the Monday review window (13:00 to 14:15 UTC).
6. Prices for the single Monday report and monthly plan (spec section 8).
7. If X posting: create or confirm the X developer account and bot account, label it Automated, name the human operator in the bio, and read the automation rules page (we could not load it).
8. Read the xAI terms and the legal check before the paywall (the spec's own rule).
9. Confirm the wording rule: no claim of an edge, because the 3.5-year backtest showed none.

## 7. Sources used

- xAI models and prices: https://docs.x.ai/docs/models
- xAI tool pricing: https://docs.x.ai/developers/pricing
- xAI X Search: https://docs.x.ai/developers/tools/x-search
- xAI tools overview: https://docs.x.ai/docs/guides/tools/overview
- xAI rate limits: https://docs.x.ai/docs/key-information/consumption-and-rate-limits
- Live Search retirement (third party): https://community.make.com/t/x-ai-node-integration-error-410-live-search-deprecated-switch-to-agent-tools-api/102097
- xAI pricing and subscriptions (search summary only): https://x.ai/pricing
- X API pricing: https://docs.x.com/x-api/getting-started/pricing
- X developer guidelines: https://docs.x.com/developer-guidelines
- X automation rules (page blocked for us, quoted via search summary): https://help.x.com/en/rules-and-policies/x-automation
- Claude pricing, Batch, Managed Agents: https://platform.claude.com/docs/en/about-claude/pricing
- Vercel cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel function duration: https://vercel.com/docs/functions/configuring-functions/duration
- Internal: `C:\Stackday\team-repo\wt-research-core\docs\research\PLAN.md`, spec in PR 73 (`docs/research/SPEC.md`), `C:\Stackday\docs\07-research-agent.md`, code under `C:\Stackday\team-repo\wt-preview-research\web\lib\research\`.
