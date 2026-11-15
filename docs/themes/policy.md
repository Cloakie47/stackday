# Themes portfolio policy (proposal)

These are the rules the deterministic engine would follow. They come from the research default policy, adapted to Stackday's words and contracts. All numbers are proposals for the founder. The AI model never sets or overrides any of them.

Hard caps are enforced in code before any plan is shown, and checked again right before a transaction is built.

## Why the rules look like this

- The real universe is small. On November 15, 2026 the Tokenized Stocks API listed 358 tickers, but only 12 had a Chainlink price: AAPLc, AMZNc, GOOGLc, METAc, MSFTc, NVDAc, TSLAc, INTCc, SNDKc, SPCXc, MSTRc, CRCLc. base.org/stocks lists 10 of them (not INTCc or CRCLc). There are no tokenized ETFs on Base.
- Most of these names are large US tech companies and move together. "Diversified" here means a few groups (large tech, crypto, cash), not hundreds of names. The app should say so plainly.
- MSTRc and CRCLc behave like crypto, so they count toward the crypto cap.
- NVDA, SNDK, INTC and MSFT form an AI and chips cluster (GOOGL, META and AMZN partly too).

## Sleeves

| Sleeve | What it holds |
|---|---|
| Stocks (core) | The person's themes, mapped onto the tokenized stocks that exist. At least 5 names where the asset list allows it |
| Crypto | cbBTC and WETH. MSTRc and CRCLc count here too |
| Risk bucket | A small slice for high-volatility allowed names (for example SPCXc, SNDKc, MSTRc). Bold only, or a small overweight of the person's strongest theme |
| USDC cushion | Spare USDC in the vault. Dry powder for cheap weeks and a buffer for price gaps. It can earn interest through the existing yield adapter |

## Risk levels

The person picks one with a 3-question quiz (time horizon, reaction to a 20 percent drop in a month, comfort with crypto).

| Sleeve target | Steady | Balanced (default) | Bold |
|---|---|---|---|
| Stocks | 65% | 73% | 70% |
| Crypto | 5% | 12% (cbBTC 8, WETH 4) | 18% |
| Risk bucket | 0% | up to 5% | 7% |
| USDC cushion | 30% | 10% | 5% |
| USDC floor | 20% | 5% | 5% |
| Volatility target (yearly) | 10% | 18% | 24% |

Note: the earlier concept draft gave risk buckets of 5, 10 and 20 percent. This table uses the more cautious policy numbers. The founder picks.

## Hard caps

| Cap | Limit |
|---|---|
| Single stock | 15% of the portfolio (20% of the stock sleeve) |
| Single theme | 40% of the portfolio |
| Crypto (cbBTC, WETH, MSTRc, CRCLc together) | 25% (Steady: 10%) |
| USDC cushion | at least 5% (Steady: at least 20%) |
| AI and chips cluster (NVDA, SNDK, INTC, MSFT) | 35% of the portfolio |
| Any group with 90-day pairwise correlation above 0.85 | treated as one cluster, 35% |
| Single risk-bucket asset | 2.5% |
| New holding with correlation above 0.9 to an existing one in the same sleeve | not added, unless it replaces that holding |

Excess over a cap is spread pro rata to the other holdings. No leverage: total exposure never goes above 1x.

## Weights inside a sleeve

- Start from equal weights per theme and per holding (see concept.md), or inverse volatility (1 divided by 60-day volatility) once price history is wired in.
- Theme preference can move a holding by up to 30 percent of its base weight, still inside the caps.
- If forecast volatility is above the target, scale the stock, crypto and risk sleeves down (to no less than 0.6x). The difference stays in USDC.

## Value tilt

"Good assets at cheaper prices", as a slow, bounded tilt, never a timing switch.

1. **Quality gate.** Only stocks with positive free cash flow, a positive operating margin and net debt below 3x EBITDA can be tilted up. SPCX (no public figures) and MSTR (a bitcoin proxy) are risk bucket only.
2. **Cheapness score** = half of (forward P/E against its own 5-year median, inverted) plus half of (drawdown from the 52-week high), each as a z-score, clipped to -2 and +2. For crypto: drawdown from the all-time high plus price against the 200-week average.
3. **Trend filter.** If the price is below its 200-day average and its 3-month return is in the bottom quarter, no upward tilt. This avoids buying a falling knife.
4. **Tilt** = base weight x (1 + 0.125 x score). That keeps every tilt within plus or minus 25 percent of the base weight. Caps are applied again afterwards.

## Smart DCA

- Each period's planned buy is multiplied by 0.5x to 1.5x, based on cheapness and Mood (concept.md).
- Example: fear index below 25 and the basket cheap gives 1.5x. Hype gives 0.5x, and the unspent half stays as USDC.
- Mood changes how fast we buy, never what we buy.

## Drift bands and rebalancing

- Check every day. A sleeve or holding is out of band when it is more than 5 percentage points or more than 25 percent of its target away (the "5/25" rule).
- Rebalance halfway back to target, to keep turnover and fees low.
- Skip any trade below $5 or 0.25 percent of the portfolio.
- A weekly proposal is shown to the person even if nothing is out of band.
- In Stackday v1 a rebalance is a new split for the next buys, not a sale (see the last section).

## Drawdown ladder

Measured on the portfolio value against its peak.

| Fall from peak | Action |
|---|---|
| 10% | Risk bucket to 0. No value tilt on names that fail the trend filter |
| 20% | Stock and crypto targets x 0.75. The difference stays in USDC |
| 30% | Stock and crypto targets x 0.5. Tell the person, and propose nothing further without their review |
| Recovery | Step back up one level after 20 trading days, or after half the fall is recovered, whichever comes first |

- No per-stock stop-loss in the core. At 30 percent below its 52-week high and below its 200-day average, a stock gets no new buys and is flagged for review.
- In v1 the ladder can only slow or pause buying, because there is no selling.

## Price checks before any stock buy

A stock buy is only proposed when all of these hold:

- The US market is open.
- The Chainlink feed answer is above zero and `updatedAt` is no more than 2 hours old.
- The feed is not frozen for a corporate action and the token is not paused. Base docs say never to settle against a frozen feed.
- The L2 sequencer uptime feed says Base is up, plus a grace period.
- The exchange price is within 1 percent of oracle price x multiplier. (The concept draft used 1.5 percent. Pick one.)
- Slippage against the oracle: at most 50 bps for stocks, 30 bps for cbBTC and WETH, 100 bps for the risk bucket. Minimum output is set from the oracle, never from an exchange quote.

Crypto buys can run every day of the week, with the same oracle checks.

## Stackday constraints

What today's contracts allow, and what that means for the policy.

| Constraint | Effect on Themes v1 |
|---|---|
| Only 4 testnet assets: mAAPL, mNVDA, mcbBTC, mWETH (mocks) | Only 2 stocks. With a 15 percent single-stock cap the stock sleeve can hold at most 30 percent, so the Balanced targets cannot be met on testnet. Options: redeploy with more mock assets (founder decision, changes addresses), or show the real 12-name catalogue as preview only and label it clearly |
| Payroll plans hold at most 6 assets (`MAX_ALLOCATIONS = 6`) | A theme basket must fit in 6 holdings per payday. The engine picks the 6 that close the most drift |
| SipRouter has one recurring plan per asset (`setPlan`, `cancelPlan`) | An individual's basket is several plans, one per asset, plus one-time `invest` calls |
| Contracts can only buy (no sell path in the swap adapter) | Rebalancing is new money only: the next payday share or recurring buy goes to underweight holdings. Real selling needs a contract change, an agreed issue and a redeploy |
| Asset list fixed at deployment (`VaultFactory`) | Themes cannot add assets. Locked theme cards say "unlocks when tokenized and supported" |
| `SipRouter.maxPriceAge` is set once at deployment, and is 0 (off) on testnet | The 2-hour freshness check must run in the app before a plan is proposed. On mainnet it should be set at deploy |
| `Payroll.claim()` passes only one minimum output, so legs 2 to 6 get none | Themes uses `claimMany` or `claimWithSipMany` with a per-leg minimum, as the site already does |
| Borrowing and the emergency rule are core | The emergency rule always beats theme weights. Themes never proposes a split that would push loan health below the person's threshold |
| Approve mode only | Every plan change is a transaction the person signs |
