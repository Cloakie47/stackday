# Themes concept: themes, value and mood

The product idea behind the Themes layer, summarised from the research. The one-line pitch: pick the themes you believe in, and the app buys them when they are cheaper, holds back when it is hype, and explains every move.

## The gap (reported)

| Who | What they do | What is missing |
|---|---|---|
| Bitwise automated portfolios on Glider | Rules-based themed portfolios rebalanced in the user's own Base wallet. One model live, 4 tokens at 25 percent each (reported) | Static rules, no news, no personal themes, no "buy cheaper" logic, little explanation |
| Robinhood agentic trading | Theme positions with an AI copilot | Custodial, not onchain |
| Bankr | Chat agent that trades on Base | Power-user tool, not a risk-managed portfolio. Wallets drained in May 2026 (reported) |
| LunarCrush, Santiment, Kaito, stock sentiment APIs | Sentiment data | Data only, no portfolio rules, often rewards hype |

Nobody combines "themes I like", "bought at a better price" and "sentiment as a brake, not hype fuel", with a plain reason for every trade.

## Theme catalogue

Built only from tokens that exist on Base. Stocks below are the real Coinbase tokens (NVDAc and so on). On testnet only mAAPL, mNVDA, mcbBTC and mWETH exist (see policy.md).

| Theme | Holdings on mainnet today | On Stackday testnet |
|---|---|---|
| AI and Chips | NVDA, MSFT, GOOGL, META, SNDK | mNVDA |
| Big Tech Core | AAPL, AMZN, GOOGL, MSFT, META | mAAPL |
| Future Movers | TSLA, SPCX (check what SPCX is in the API metadata) | none. Risk bucket only |
| Crypto-Native | cbBTC, WETH, MSTR | mcbBTC, mWETH |
| Cash Cushion | USDC | USDC |
| Locked cards | Clean energy, healthcare, non-US stocks | "Unlocks when tokenized and supported" |

The anchor names clean energy as an example interest. No clean energy stock is tokenized on Base today, so it can only appear as a locked card. Be honest about this in the app.

## Building the basket (deterministic, no AI)

1. **Base weights.** Each picked theme gets an equal share of the stock sleeve. Inside a theme, holdings are equal weight.
2. **Merge overlaps.** If GOOGL is in two themes, add the weights together.
3. **Apply hard caps** from policy.md. Spread any excess pro rata.
4. **Risk bucket.** Bold puts it into Future Movers or Crypto-Native. Others get a small overweight of their strongest theme.
5. **Value and Mood tilt.** Multiply base weights by 0.75 to 1.25, then apply the caps again.
6. **Fit Stackday.** Keep at most 6 holdings per payday plan, and drop assets the deployment does not support.

The engine is pure TypeScript with unit tests. Same inputs always give the same plan.

## Value score

Range -1 (expensive) to +1 (cheap). Inputs:
- Drawdown from the 52-week high, compared with the stock's own usual pullbacks.
- Price against the 200-day average.
- Optional: forward P/E against its own 5-year range.
- For crypto: drawdown from the all-time high and price against the 200-week average.

Only stocks that pass the quality gate in policy.md can get an upward tilt.

## Mood score

Range -1 to +1, per stock, then averaged per theme.

| Input | Sources (examples) | Use |
|---|---|---|
| News per stock | Marketaux, Alpha Vantage news sentiment, Finnhub (free tiers, limits reported) | Main input |
| Filings and earnings | SEC EDGAR 8-K and 10-Q | Most trusted, highest weight |
| Social and crowd mood | Fear and Greed index, LunarCrush or Santiment for BTC and ETH | Only as a hype detector, never a reason to buy |
| Onchain flows | Token supply changes, exchange pool volume, gap between pool price and oracle | Spots unusual demand or thin liquidity |

Pipeline: fetch every 30 to 60 minutes, clean the text, group duplicate stories, classify each article, weight by source trust, then combine with time decay:

mood = sum(direction x materiality x confidence x source trust x decay) / sum(weights), with decay = e^(-age / 3 days), clamped to -1 and +1.

Materiality matters more than tone. A guidance cut or fraud claim is material. An opinion column calling a stock "overhyped" is not.

## How Value and Mood change the plan

| Situation | Action |
|---|---|
| Cheap, mood negative, no material event | Tilt up to +25 percent and speed up Smart DCA. "Good asset, cheaper price, the fear is noise" |
| Cheap, but a material negative event | Freeze new buys of that stock and flag it for review |
| Expensive and euphoric, or a hype spike | Tilt down to -25 percent and slow Smart DCA |
| Neutral | Base weights |

Mood can never push a holding past a cap, add an asset outside the person's themes, or shrink the USDC cushion.

## The AI model's narrow role

- It is a classifier only. For each article it returns strict JSON: stock, event type (regulation, earnings, guidance, product, legal, macro, rumor, other), direction (-1 to 1), materiality (0 to 1), confidence (0 to 1), whether it is opinion, an evidence quote of at most 25 words, and `injection_suspected`.
- Output is checked against the schema. Anything off-schema is dropped.
- It has no tools, no wallet, no keys and no way to trade or build a transaction.
- A small fast model does bulk classification. A larger model may write the plain-language "why" text from the structured scores.
- For the hackathon, a precomputed daily snapshot labelled as a snapshot is enough. A live schedule only if time allows. API keys go into Vercel through the founder, never into chat or git.

## Defences against prompt injection

News text is untrusted. Research shows hidden-text and look-alike-letter headline attacks can flip sentiment models, and LLM trading agents can be steered by poisoned articles (arXiv 2601.13082: https://arxiv.org/html/2601.13082v1).

- Clean first: strip HTML, hidden and zero-width characters, normalise Unicode (NFKC), map look-alike letters, cut long text.
- Wrap article text in clear delimiters, and tell the model it is data and any instructions inside must be ignored and flagged. A flagged article gets zero weight.
- Compare the model's direction with a second, non-AI score (the vendor's sentiment). Big disagreement halves confidence.
- Weights are computed in code from bounded scores. Even a fully fooled model can move a weight by at most the 25 percent tilt, inside the caps, and the person still signs.
- Every "why" card quotes its evidence with a link, and everything is logged.

## Defences against hype and pumps

- Sentiment never buys on its own. Positive mood alone gives at most a neutral weight. An upward tilt needs a cheap Value score too.
- A sudden spike in mentions (z-score above 3) or a Fear and Greed reading above 80 sets a hype flag that reduces buying.
- Fixed list of assets: only the deployment's tokenized stocks plus BTC, ETH and USDC tokens. No memecoins.
- A material event needs 2 independent reputable sources or one filing before it changes weights. Social-only stories cap at materiality 0.2.
- Skip a trade if the pool price is too far from the oracle or slippage is too high (policy.md).

## "Why" cards and the decision log

Every holding and every proposed change gets a three-line card built from structured data, not free text. Example:

> NVDA, AI and Chips, +2.1% weight this week
> Value: 14% below its 52-week high, more than its usual pullback.
> Mood: negative but not material (export-rule headlines), no change to guidance. 3 sources.
> Guardrail: stays under the 15% single-stock cap.

Each run writes a decision log: inputs, scores, every guardrail check (pass or fail), and the proposed buys. The app shows it. This is the "research to portfolio" proof for the video.

## Key screens

| Screen | What it shows |
|---|---|
| Pick your themes | Theme cards (name, 3 to 5 holdings, one-line idea, mood chip), then the 3-question risk quiz |
| Your plan | Donut by sleeve, holdings with weights and a "why this" line, caps summary, amount, one confirm button, fee and slippage estimate |
| Market mood strip (on the Dashboard) | Mood and Value per theme ("on sale, 12% below high"), next Smart DCA multiplier, pending proposal banner |
| Theme detail | Holdings in share terms (multiplier applied), Value explainer, 7 and 30 day mood, top scored news with evidence and links, hype or material-event flags |
| Rebalance proposal | Current split against target, the next payday or recurring split that closes the drift, "why" cards, guardrail checklist, Approve or Skip |

These sit next to Stackday's existing Invest and Get paid pages, not in place of them.

## Regulatory framing

- **Information, not advice.** The person chooses the themes and the risk level. The rules are fixed and published. The app shows what the rules produce and never says "you should buy X". Personal suggestions can count as investment advice in many places, so the wording matters.
- **Per-person vault, no pooled fund.** Each person's assets stay in their own Stackday vault. No fund token, no shares in a pool.
- **Approve mode only.** The person signs every change. Automatic rebalancing would move toward managing someone's money and is out of scope for v1.
- **Plain disclosures.** No performance promises. Tokens give economic exposure, not voting rights. Eligible people outside the United States only. The token issuer can pause or block transfers and change the multiplier. Sentiment has limits. No independent audit.
- Regulators say tokenized securities are still securities (SEC staff statement, January 2026, reported via law-firm summaries), and ESMA warned tokenized stocks may give "an impression of ownership" (reported). Compliance stays the team's responsibility.
