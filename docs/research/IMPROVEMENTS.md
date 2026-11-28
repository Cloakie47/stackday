# Research agent: next improvements (founder request, November 28, 2026)

Six improvements for the research engine (web/lib/research). They make the reports more honest and easier to trust. None of them changes contracts, the paywall or the asset list, and none adds a new outside service or API key.

Owner: growth. Please reply on this pull request with any you disagree with or want to size differently before starting.

Suggested order: items 1 to 3 in one pull request first (prompt and display changes). Items 4 to 6 after that.

## 1. "What could we be wrong about?" in every weekly report

**What:** The Monday report ends with a short section, "What could we be wrong about?". It lists the 2 or 3 things most likely to make this week's views wrong, each one tied to a fact id and to the asset it affects.

**Why:** It is cheap, honest, and it is what a careful human analyst would write. We already have a bear case and an invalidation level per asset. This is one plain summary across the whole report.

**Where:**
- Weekly schema and types: `web/lib/research/types.ts` (a new `wrongAbout: { text, factIds, assetIds }[]` field on the weekly report, 2 to 3 items).
- Editor prompt: `web/lib/research/engine/prompts.ts` (ask for it last, after the views are final).
- Code check in `web/lib/research/engine/validate.ts`: 2 to 3 items, every fact id exists, no personal advice wording.
- Display: `web/components/research/weekly-report.tsx`, as the last card before the scorecard.
- Sample data: `web/lib/research/sample-weekly.json` and `web/components/research/fixtures/sample-weekly.ts` (keep both in step).

**Done when:** a sample and a live run both show the section, and a report with a missing or invalid list fails validation the same way other sections do.

## 2. Label each catalyst "confirmed" or "speculation"

**What:** Every catalyst or news item that a view rests on gets a label:
- **Confirmed:** scheduled or filed, for example an earnings date, an 8-K, a Fed meeting, a token unlock on a published schedule.
- **Speculation:** rumours, opinion pieces, "reportedly", analyst expectations.

**Why:** Readers and judges can see at a glance what is fact and what is a guess. We already read SEC filings, calendars and headlines, so most of the label can be set in code from the source, not by the model.

**Where:**
- Fact kinds and sources: `web/lib/research/engine/facts.ts` and `web/lib/research/data/news.ts`, `headlines.ts`, `events.ts`, `calendar.ts`. Set the label in code where the source makes it obvious (SEC EDGAR, calendars = confirmed; opinion-tagged headlines = speculation). The model may only downgrade a label, never upgrade it.
- Display: a small "Confirmed" or "Speculation" badge in `CitedFacts` and on the "Week ahead" calendar (`web/components/research/bits.tsx`, `asset-research.tsx`).

**Done when:** every cited news or event fact on an asset page shows one of the two labels.

## 3. Two more questions for the risk reviewer

**What:** Add two checks to the risk reviewer step (`REVIEW_ROLE` in `web/lib/research/engine/prompts.ts`):
1. **Is it already priced in?** If the price has already moved a lot on the catalyst (use the existing price and range facts), the view must say so.
2. **Is the move real or reward driven?** For crypto assets, flag when activity, yield or volume is mostly paid by token rewards rather than real demand. Example: on Aerodrome most of the high pool yield is AERO emissions, not trading fees.

**Why:** These are the two most common ways an upbeat view turns out wrong.

**Where:** `prompts.ts` (review role), and a note in the review output that the editor must answer. Add both to the reviewer checklist in `docs/research/SPEC.md` section 6 or 7.

**Done when:** a test fixture where the price already jumped makes the reviewer send the section back.

## 4. A Brier score for calibration

**What:** Track calibration as a Brier score each week, next to the existing calibration by conviction.

- Brier score in plain words: for each call, take the probability we gave (for example the bull scenario at 60 percent), compare with what happened (1 if it happened, 0 if not), square the difference, and average over all calls. 0 is perfect, 0.25 is a coin flip, lower is better.
- Use the bull, base and bear scenario probabilities we already publish, and the levels we already score.

**Why:** One number that shows whether "we said 70 percent" really means 70 percent. It makes the scorecard harder to game.

**Where:** `web/lib/research/engine/scores.ts` (a `brier()` function next to `calibration()` and `calibrationClearlyOff()`), tests in `scores.test.ts`, the weekly scorecard in `weekly-report.tsx`, and the asset page track record in `asset-research.tsx`. Show it only once there are at least 8 scored calls, with a short tip explaining it.

**Done when:** the scorecard shows "Brier score (lower is better)" with its call count, and tests cover a perfect, a coin-flip and a badly calibrated set.

## 5. Use the strongest model only when it matters

**What:** Keep cheap models by default and send work to the strongest model only when a trigger fires.

- The daily run already does this: Haiku first, Sonnet for answers that fail the checks, with a cap on escalations (`web/lib/research/engine/daily.ts`, `RESEARCH_MODELS` in `web/lib/research/flags.ts`).
- Add two more triggers: the market looks like a crisis (for example BTC or the S&P 500 down more than a set percent in a day, or a price feed stale), or the view's conviction is low while the price is near an invalidation level.
- Keep the escalation cap and the run budget (`budget.ts`) as hard limits in code.

**Why:** Better notes on the days readers care most, without raising the daily cost.

**Where:** `daily.ts` (trigger function, unit tested), `flags.ts` for the thresholds.

**Done when:** tests show each trigger escalates, and the cap still holds.

## 6. Nothing from the future can leak into a report

**What:** Every fact must be stamped no later than the run's cut-off time. The engine drops any fact stamped after it and logs why.

**Why:** It keeps the scorecard honest. A report graded later must only have used what was known when it was written. Today facts carry an `asOf`, and stale prices are rejected (`price-fresh` checks in `facts.ts`), but there is no check for facts dated after the cut-off.

**Where:** `web/lib/research/engine/facts.ts` or `validate.ts` (a `cutoff` passed in from `daily.ts` and `weekly.ts`), with a test in `guards.test.ts`. Also check the news fetchers sort and filter by `publishedAt` against the same cut-off.

**Done when:** a fact stamped one minute after the cut-off is dropped in tests.

## Not included, on purpose

These came up in a trading-bot prompt the founder looked at and do not fit Stackday:
- **Automatic trading or auto-buying.** The anchor says the person confirms and signs every action.
- **Position sizing (Kelly or similar).** That is personal investment advice. Our reports are general information, the same for every reader.
- **Outside tools named in that prompt (AgenKit, "Jev", typesafe.ai).** Not verified, and we do not add outside services or keys without review. Everything above uses what we already run.
