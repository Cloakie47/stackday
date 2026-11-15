# Competition rules that shape Themes

Summary of the official Base "Stocks Maxxing Season" pages as read on November 15, 2026. Dates, amounts and criteria may change, so re-check before submitting.

Sources:
- Quest page: https://www.base.org/stocksmaxxing
- Official rules: https://www.base.org/stocksmaxxing/rules
- Tokenized stocks product page: https://www.base.org/stocks
- Tokenized Stocks API: https://docs.base.org/sdks/tokenized-stocks/overview
- List Tokenized Stocks (B20, multipliers, Chainlink feeds): https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks

## Key facts

| Topic | What the rules say |
|---|---|
| Deadline | December 5, 2026, 23:59 UTC. All times in the rules are UTC |
| Submission | A public X post with a video demo that explains the project, tagging @buildonbase, plus the official submission form. The video is the main judged artifact. A repo, deck or live URL is not required |
| Judging criteria | Not published. The rules say criteria are weighted equally unless the quest page says otherwise. Judges' decisions are final |
| Testnet | Allowed. "Testnet Submissions will not be judged less favorably" |
| Pre-existing code | Allowed, but the form must clearly describe what was built during the quest period |
| Team | Up to 5 people, all 18 or over, none in an OFAC-sanctioned region. Winners must pass KYC and tax forms, with 7 days to reply |
| Token | Optional. Teams that already launched a token are not eligible by default |
| Prizes | Paid in USDC on Base |

## Tracks and prize pools

| Track | Base pool | Ideas the brief lists that touch Themes |
|---|---|---|
| Meme and Community Economies | $10,000 | None directly |
| Agentic Stock Finance | $20,000 | "research-to-portfolio agents", "agent-managed rebalancing" |
| Programmable Stock Markets | $20,000 | "custom portfolios, indexes", "build-your-own stock indexes" |

- Partner rewards total about $48,000. Most go to the Meme track. Bankr lists $1,000 on each of the three tracks, and BaseStonk offers support on all three.
- A $6,000 build-in-public award goes to one team, by community vote, for sharing progress on X and tagging @buildonbase.
- A project can be both a track winner and a partner winner.

## One track per project

- One submission per team per track. A project may enter more than one track only if the quest page allows it, and it does not. A project can win in only one track.
- Stackday today targets Programmable Stock Markets (stock-backed loans, CLAUDE.md and docs/BRIEF.md).

### Open question: which track (not decided here)

| Option | Case for it | Case against it |
|---|---|---|
| Programmable Stock Markets (current plan) | The loans path is built and recorded for judges. The brief names "custom portfolios" too, so Themes fits as a feature | Themes is the first thing dropped if time runs short, so it may add little to this entry |
| Agentic Stock Finance | Two of its four example ideas describe Themes almost word for word | It would mean leading the video with Themes, which is not built yet, and keeping loans as a feature |

This is the founder's call, with the second contributor. Nothing in this folder assumes either answer.

## Restrictions Themes must respect

- **US users.** "Projects that enable trading for US users are not eligible." Coinbase tokenized stocks are for eligible persons outside the United States only. Every Themes buy flow must sit behind the same eligibility gate as the rest of the app. Read-only views at most for US visitors.
- **No endorsement claims.** Do not imply a relationship with or endorsement by Base, a partner, a token issuer, or any company whose stock appears in a theme. Base and partner names may only be used to say accurately that we took part or won.
- **No rights claims.** Do not claim the tokens give rights in the company, such as voting rights. They give economic exposure only.
- **Compliance is the team's.** The rules list securities, consumer protection, money transmission and data protection law, and say teams are solely responsible, including any licence needed. Being in the campaign is not a compliance check. For Themes this means: information, not advice, and no pooled fund (see concept.md).
- **No fake traction.** Manipulating engagement or traction metrics is grounds for disqualification. Organic posting only for the build-in-public award.
- **Not confidential.** Submissions are public and Base may build similar products.

## What judges from Base are likely to notice (inference, not a stated criterion)

- Tokenized stocks at the core, not a side feature.
- Correct B20 handling: multiplier-aware amounts (`balanceOfUI`), `isAuthorized(policyID, account)` before routing a buy, and no trades against a stale or frozen price feed.
- Builder Codes (ERC-8021) on transactions.
- A clear explanation of every automated decision.
- One press report claimed a 50 percent weighting on onchain traction (reported). The official rules do not say this, so treat real usage as a bonus.
