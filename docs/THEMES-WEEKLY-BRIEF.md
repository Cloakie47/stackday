# Themes: weekly research and rebalance, brief for growthmindsetgg

From the founder, November 16, 2026. Paste this into your Claude session.

## What we want

The anchor says: "A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time."

The founder's words: a consumer app that understands market sentiment and news and helps people buy tokenized stocks by theme. It knows what the person is into, reads the markets each week and rebalances their buy suggestions. It is for people who buy stocks every week, so the research has to be fresh every week, not a frozen snapshot.

You own the research and the design for this. Come back with a short written plan (a new section in your docs PR #3 is fine) before building, so the founder can approve it.

## What already exists (your open PRs)

- #3 Themes research and policy docs
- #10 deterministic basket engine with caps
- #11 rebalance proposals using new money only
- #12 /themes page
- #13 market mood scoring (NewsItem schema, aggregateMood, materialRiskFlag) and a hand-built snapshot dated November 15

Important: these branches were cut from an old main. Comparing #13 with main today shows it would delete the account flow, sign-in nonce, rate limiting, origin check and security headers. Before anything else, merge the current main into each branch (no force push), keep both sides, and make sure CI passes. Then the founder can review them in order: #3, #10, #11, #13, #12.

Since then main also has real asset logos (#19) and a collateral basket on the Borrow page (#20). Track and partner research is in docs/PARTNERS-SHORT.md and docs/PARTNERS-DETAILED.md: it suggests Bankr's AI gateway as one option for scoring news, and notes that Themes as a real agent would fit the Agentic Stock Finance track.

## Questions to answer in your plan

1. News source. Which feed gives dated headlines for our catalog tickers with terms that allow this use, and what does it cost? Compare a few (for example SEC EDGAR for filings, a news API with a free tier, company press-release RSS). Free or near free is preferred for the hackathon.
2. Weekly job. How the refresh runs once a week. Likely a Vercel Cron route under web/app/api that fetches news, scores it and stores a dated snapshot. Say how it is protected (a secret header from Vercel Cron, not callable by the public).
3. Scoring. If a language model scores articles into the existing NewsItem schema, which model, the exact prompt, how the output is validated with parseNewsItem, and the cost per weekly run. Article text is untrusted input: the model output must only ever be data that passes the schema, never instructions.
4. Storage. A Supabase table for weekly snapshots (and per-user theme picks if needed), added to supabase/schema.sql with RLS on and no public policies, read through our server routes like the other tables. The site must keep working, using the last good snapshot or the hand-built one, when the job fails or the database is not set.
5. What the person sees each week. The suggested buys for the themes they chose, what changed since last week and why (the headlines behind it, with links), and one button to accept the new split for their recurring plan. Nothing changes without the person confirming in their own wallet.
6. Honesty. Every screen says the date of the reading, that it is not investment advice, and what is mocked on testnet. Keep the caps from #10 and the new-money-only rule from #11.

## Rules that still apply

- No contract changes without an agreed issue first.
- Server-only keys (news API, model API) go in Vercel environment variables, set by the founder. Never put keys in chat or in the repo.
- Branch as gg/<topic>, open a pull request, wait for review and CI.
- No em dashes in any user-facing or submission writing.
- Only the founder publishes the live site and touches the live database.
