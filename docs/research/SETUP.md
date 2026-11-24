# Research bot: setup and first-run runbook

How to turn on the research engine from PRs #67 to #72 (daily notes, Monday weekly report, scores) with real model calls. This is what we did for the preview on 2026-11-22 to 2026-11-25. Not investment advice.

The rule throughout: whoever owns an account does every payment and types every secret themselves. Never paste a key into GitHub, Discord or chat.

## 1. Anthropic API credits

- **A Claude subscription and the API are billed separately.** Source: https://support.claude.com/en/articles/9876003
- **Max, Ultra and Team plans include monthly API credits.** Max gets $100, Ultra $200, and Team $20 or $100 per seat, capped at $500. Pro gets none. Source: https://support.claude.com/en/articles/17154008
  - You can claim after seven days on the plan.
  - The credits refresh each billing cycle and do not roll over.
  - When they run out, API calls stop unless you have bought credits or turned on auto-reload.
- **How to claim.** On claude.ai, open Settings > Billing > API credits > Link organization. Pick or create a Console organization, then accept the Supplemental Credit Terms. You can link only one organization.
- **Free alternatives.** None land before the hackathon deadline. The Claude for Startups program is closed to new applicants (https://claude.com/programs/startups). The Stocks Maxxing page and the Base Builder Stack list no Claude credits.

## 2. Console setup

All steps are in https://platform.claude.com.

1. **Workspace.** Settings > Workspaces > Create workspace, named `stackday-research`.
2. **Spend limit.** Settings > Spend limits > Workspace limits, then pick `stackday-research`.
   - Monthly spend limit: **$20**. Email alert: **$10**.
   - Source: https://platform.claude.com/docs/en/manage-claude/workspaces
3. **API key.** Settings > API keys > Create key, named `stackday-research-vercel`, in workspace **`stackday-research`**. Otherwise the workspace limit does not apply.
   - The key is shown once, so paste it straight into Vercel.
4. **Leave auto-reload off and add no card**, so spend can never go past the credit.

Tiers are now Start ($500 a month cap), Build ($1,000) and Scale ($200,000), set automatically from usage history. New organizations may start in a lower Evaluation tier. Source: https://platform.claude.com/docs/en/api/rate-limits

## 3. Expected cost

Prices per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing:

| Model | Input | Output |
|---|---|---|
| Haiku 5.5 | $0.10 | $0.50 |
| Sonnet 5.5 | $2 | $10 |
| Opus 5.5 | $4 | $20 |

These match `PRICES` in `web/lib/research/engine/model.ts`.

| Run | Low | Expected | High |
|---|---|---|---|
| Daily (6 assets on Haiku, at most 3 escalations to Sonnet) | $0.01 | $0.02 to $0.06 | $0.30 |
| Weekly (Opus) | $1.50 | $2.50 | $4 (code cap) |
| Scores | $0 | $0 | $0 (no model calls) |

- **Measured.** The first real daily run cost $0.019, with 9 model calls (3 escalated).
- **Monthly.** Expect about $15 a month. The worst case from crons alone is about $27.
- **Code caps.** `RESEARCH_MAX_RUN_COST_USD` $2, `RESEARCH_MAX_WEEKLY_RUN_COST_USD` $4, `RESEARCH_MAX_DAY_COST_USD` $6.

## 4. Supabase

1. **Tables.** In the project's SQL Editor, run the research part of `supabase/schema.sql`: from `create table if not exists research_runs` to the end.
   - Use the copy on `gg/research-engine` (#70), then the `research_record_payment` function block from `gg/research-access` (#68). The copy on `gg/research-core` (#67) is older.
   - This only adds 9 `research_*` tables (row security on, no policies, server only) and one function. No existing table changes.
2. **Check that it worked.** Run this read-only query:

   ```sql
   select c.relname, c.relrowsecurity,
          (select count(*) from pg_policies p where p.tablename = c.relname) as policies
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'research_%'
   order by 1;
   ```

   Expect 9 rows, each with `true` and `0`.
3. **Key.** Project Settings > API Keys > create a secret key just for this deployment, for example `stackday-research-preview`.
   - It starts with `sb_secret_` and goes into `SUPABASE_SERVICE_ROLE_KEY`. `createClient` accepts it.
   - Every secret key has full database access. A separate one can be revoked without affecting other apps. Source: https://supabase.com/docs/guides/api/api-keys
   - Legacy `service_role` keys are deprecated by the end of 2026.

Note: connecting a deployment to a database turns on its account routes as well as research. That covers sign-in, profiles, employees, attendance and business (`configured()` in `web/lib/server/backend.ts`).

## 5. Vercel environment variables (Production)

| Variable | Secret | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Key from step 2.3 |
| `RESEARCH_ENGINE_ENABLED` | no | `true`. The engine needs this and the key |
| `SUPABASE_URL` | no | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | The `sb_secret_` key |
| `SESSION_SECRET` | yes | Needed by `configured()` |
| `CRON_SECRET` | yes | Protects the cron routes |
| `RESEARCH_PRICE_API_KEY` | yes | Twelve Data. Without it, stock notes use news only and conviction is capped at low. The free plan forbids showing the data to users (`web/lib/research/data/SOURCES.md`) |
| `SEC_USER_AGENT` | no | Company name plus a contact email. Without it, EDGAR filings are skipped |
| `RESEARCH_REVIEWERS` | no | Lowercase wallets, comma-separated. They approve the weekly report |

Changes apply only to new deployments, so redeploy after editing. Source: https://vercel.com/docs/environment-variables

## 6. First-run test

1. In Vercel, open the project > Schedules > Cron Jobs. On `/api/research/run`, open the actions menu and choose **Run**. The cron secret is sent for you.
2. Check the logs: `vercel logs --environment production --since 30m` should show `GET /api/research/run 200`. A 503 means a variable is missing, and the response says which.
3. Check the database:

   ```sql
   select run_id, kind, status, cost_usd, left(detail, 300)
   from research_runs order by started_at desc limit 5;
   ```

4. Check the Console: Billing (credit balance) and Spend limits (`stackday-research`).

**First result (2026-11-24 UTC):**
- Run `2026-11-24-daily-…`: status `ok`, cost $0.0190, detail "6 ok, 0 carried, 0 no reading, 3 escalated, 9 model calls".
- 6 notes: mcbBTC avoid-new-buys, mWETH hold, mPAXG avoid-new-buys, mNVDA hold, mAAPL hold, mSPX hold.

## 7. Schedule (UTC)

- Daily notes at 22:30 on weekdays. A rerun on the same date replaces that date's notes.
- Scores at 23:00 on weekdays.
- Weekly report on Mondays in nine slots from 12:00 to 20:00, one asset per call (300 second limit). The final call writes the report unapproved, and a reviewer approves it.
