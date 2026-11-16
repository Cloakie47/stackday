# Themes: research and plan

Status: proposal for the founder to confirm. The wider anchor is approved (docs/ANCHOR.md), and its working assumption B is exactly this first version: the person picks themes, the app suggests a split, the person confirms the buys, and rebalancing starts as a suggestion. The numbers below are still proposals.

## What this folder is

Background for the planned Themes layer: "A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time" (docs/ANCHOR.md).

It is a short summary of research done by growthmindsetgg on November 15, 2026, outside this repo. It gives the founder's AI assistant and ours the same context: the competition rules that shape Themes, the portfolio rules, and the product concept. The anchor in force is still the one in docs/BRIEF.md and CLAUDE.md.

## Themes v1 in one paragraph

The person picks the themes they care about (for example AI and chips, or big tech) and a risk level (Steady, Balanced or Bold). A deterministic engine in plain TypeScript, not an AI model, turns that into a capped basket: no single stock above 15 percent, no theme above 40 percent, a crypto limit and a USDC cushion. Each holding shows a Value score (is it cheap compared with its own history) and a Mood score (what the news says, weighted by how material it is). Smart DCA buys more of a quality holding when it is cheap and the fear is noise, and less when it is expensive and the mood is hype, always inside the caps. Rebalancing uses new money only: the next payday or recurring buy goes to the underweight holdings, through the existing calls `Payroll.setSipPlanMany` (employees) or `SipRouter.setPlan` and `SipRouter.invest` (individuals). Approve mode only: the person confirms every plan change and every buy. No contract change is needed for v1. Every suggestion comes with a short "why" card and an entry in a decision log.

## What v1 does not do

- No selling. The contracts only buy, so there is no sell-side rebalancing.
- No automatic mode. Nothing runs without the person's confirmation.
- No pooled money, no fund token, no change to the vault, the fee or the lending path.
- No new assets. Themes works with the assets the deployment already has.

## Files

| File | What is in it |
|---|---|
| [weekly-plan.md](weekly-plan.md) | **For approval (issue #22).** The weekly research and rebalance plan: news sources, the weekly job and its protection, model scoring and cost, storage, what the person sees each week, honesty, build steps and open questions |
| [for-the-docs-page.md](for-the-docs-page.md) | Short, user-facing text for the site's `/docs#themes` section: limits, cushion, buying pace, rebalancing with new money. The Themes page links there |
| [rules-summary.md](rules-summary.md) | Competition facts that shape Themes, and the open track question |
| [policy.md](policy.md) | Portfolio rules: sleeves, risk levels, caps, value tilt, Smart DCA, drift bands, drawdown ladder, price checks, and the limits of today's Stackday contracts |
| [concept.md](concept.md) | Product concept: theme catalogue, basket steps, Value and Mood scores, the AI model's narrow role, safety against prompt injection and hype, "why" cards, screens, and the "information, not advice" framing |

## How to use it

- Treat every number here as a proposal for the founder to accept or change.
- Facts marked "(reported)" come from press or other secondary sources. Check them before they go into the submission.
- Where this folder and CLAUDE.md disagree, CLAUDE.md wins.
