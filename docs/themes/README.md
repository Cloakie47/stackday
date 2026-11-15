# Themes: research and plan

Status: proposal, waiting on founder approval of the wider anchor (PR #1). Nothing here is built. Do not build from this folder until the anchor in docs/ANCHOR-DRAFT.md is approved and the founder confirms the Themes scope (open decision 2 in docs/START-HERE.md).

## What this folder is

Background for the planned Themes layer: "A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time" (docs/ANCHOR-DRAFT.md).

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
| [rules-summary.md](rules-summary.md) | Competition facts that shape Themes, and the open track question |
| [policy.md](policy.md) | Portfolio rules: sleeves, risk levels, caps, value tilt, Smart DCA, drift bands, drawdown ladder, price checks, and the limits of today's Stackday contracts |
| [concept.md](concept.md) | Product concept: theme catalogue, basket steps, Value and Mood scores, the AI model's narrow role, safety against prompt injection and hype, "why" cards, screens, and the "information, not advice" framing |

## How to use it

- Treat every number here as a proposal for the founder to accept or change.
- Facts marked "(reported)" come from press or other secondary sources. Check them before they go into the submission.
- Where this folder and CLAUDE.md disagree, CLAUDE.md wins.
