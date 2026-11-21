> Checked on 2026-11-21: Morpho "doesn't take a fee" and the LIF formula (docs.morpho.org), the Aave V3 treasury fee in `LiquidationLogic.sol`, and the 62.5% market LLTV and 12.7% penalty on the live Risk page. Correction: recommendation 2 (show the liquidation bonus) is already done on the Risk page ("Liquidation penalty about 12.7%").

# How lending platforms earn from liquidations, and what Stackday can do

Date: November 21, 2026. Deadline: December 5, 2026 (14 days).
Plain language. Quotes are short and come from the pages named. I read pages through a fetch tool that extracts text, so quotes are as extracted. Check any quote you plan to publish against the live page.

## The short answer

1. On Morpho Blue, the liquidation bonus goes 100 percent to the liquidator. Morpho the protocol takes nothing. So "platforms earn from liquidations" is only true for whoever runs a liquidator bot, or (on Aave) for Aave's treasury.
2. On Aave V3, the treasury takes a slice of the bonus (10 percent for most big assets, 20 percent for USDC and DAI, per a governance post). Aave also earns a reserve factor from borrower interest.
3. Apps built on top of Morpho (like Stackday) earn mostly through their own fees, vault fees, or a bot. Real, documented numbers exist for fees, not for bot profit.
4. Stackday's current model (small fees, nothing taken when a user is liquidated, borrow fee dropped on liquidation) already lines up well with users. The best improvement before Dec 5 is not new revenue. It is telling this story clearly and adding free loan-safety features.

## 1. Morpho Blue

### Liquidation bonus (LIF)
- Formula: LIF = min(1.15, 1 / (0.3 x LLTV + 0.7)). The 0.3 is called beta and 1.15 is the cap.
  - Source: https://docs.morpho.org/learn/concepts/liquidation/ ("with β = 0.3 and M= 1.15")
  - Code check: https://raw.githubusercontent.com/morpho-org/morpho-blue/main/src/libraries/ConstantsLib.sol ("LIQUIDATION_CURSOR = 0.3e18", "MAX_LIQUIDATION_INCENTIVE_FACTOR = 1.15e18")
- What it means: a liquidator repays debt and takes collateral worth LIF times the debt. The extra is the bonus.
- Worked numbers (my own calculation from the formula, not from Morpho):
  - LLTV 62.5 percent gives LIF 1.127, a 12.7 percent bonus. This is the level of our mAAPL, mNVDA, mMETA markets in CLAUDE.md. Assumption: those percentages equal the market LLTV. Check.
  - LLTV 77 percent gives LIF 1.074, a 7.4 percent bonus (mGOOGL, mPAXG, mSPX).
  - LLTV 86 percent gives LIF 1.044, a 4.4 percent bonus (mcbBTC, mWETH). Morpho's page confirms about 1.044 at 86 percent.
- Who gets it: the liquidator only.
  - Source: https://docs.morpho.org/learn/concepts/liquidation/ ("This liquidation incentive goes entirely to the liquidator.")
- Morpho's own cut: none on liquidation.
  - Source: same page ("Morpho protocol doesn't take a fee.")

### Fee switch (protocol fee on interest, not on liquidation)
- The contract can take up to 25 percent of borrower interest per market, set by the owner (governance).
  - Source: https://raw.githubusercontent.com/morpho-org/morpho-blue/main/src/libraries/ConstantsLib.sol ("The maximum fee a market can have (25%).")
  - Code: https://raw.githubusercontent.com/morpho-org/morpho-blue/main/src/Morpho.sol (`position[id][feeRecipient].supplyShares += feeShares;`)
- Status: no evidence it is switched on. A Blockworks transparency filing says as of June 17, 2026 no fee switch was on (secondary summary of the filing, https://blockworks.com/token-transparency/filing/morpho). A Phemex analysis saw a zero fee recipient on September 30, 2026. Treat as "probably off", unverified for Base markets. Check the `fee()` value on the exact Base markets on-chain before claiming it.

### Bad debt
- If a borrower runs out of collateral, the leftover debt is written off and lenders (suppliers) share the loss.
  - Source: https://raw.githubusercontent.com/morpho-org/morpho-blue/main/src/Morpho.sol (`badDebtShares = position[id][borrower].borrowShares;` then `totalSupplyAssets -= badDebtAssets`)
  - Docs for vaults: https://docs.morpho.org/learn/concepts/liquidation/ ("all vault users absorb the loss proportionally") for Vault V2.
- Meaning for us: a liquidator never takes bad-debt loss. Lenders do. This is why stock-collateral markets need conservative LLTV.

### Pre-liquidation
- What it is: an optional extra contract a borrower authorizes. It lets a position be partly closed before the normal liquidation line (preLLTV below LLTV), usually with a smaller bonus.
  - Source: https://github.com/morpho-org/pre-liquidation (via https://raw.githubusercontent.com/morpho-org/pre-liquidation/main/README.md): "pre-liquidation must be authorized on Morpho"
  - The incentive factors "determine incentives given to liquidators". No Morpho fee is mentioned.
- Who can set the incentive: anyone can deploy a contract with their own settings. The borrower opts in.
  - Source: https://morpho.org/blog/introducing-pre-liquidations-enhanced-loan-management-on-morpho ("anyone can configure custom liquidation parameters")
  - Rule in the repo: 1 <= preLIF1 <= preLIF2 <= 1 / LLTV (from the repo; summary by search tool, unverified wording).
- Who receives the pre-liquidation incentive: the liquidator who calls it. I found no source that says a deployer gets a cut. Unverified, and I believe there is no deployer cut in the contract. Check the code before planning around this.
- Morpho's own "Auto Deleverage" feature (built on this) is being shut down: "The feature is being sunset and no longer accepts new positions." (paraphrase from the fetch summary of https://help.morpho.org/en/articles/12048871-auto-deleverage). It charged "a fee only on the amount closed" (same page). The fee size is unverified. Note: this suggests Morpho did not find it worth keeping, so do not assume a big market.

### Morpho vaults: curator fees
- Vault V1 (MetaMorpho): one performance fee, up to 50 percent of interest, set by the owner, no timelock, no management fee.
  - Source: https://docs.morpho.org/curate/concepts/fee.md (V1: "Performance fee cap: 50%", "no management fee", "no timelock")
- Vault V2: performance fee up to 50 percent of interest AND a management fee up to 5 percent a year of assets. Curator sets rates and recipients, with a timelock.
  - Source: https://docs.morpho.org/curate/concepts/fee.md ("All fee-related changes are managed by the Curator.")
  - Also: https://vaultbook.gauntlet.xyz/vaults/morpho-vaults/vault-fees ("Capped at 5% per year")
- Who can be curator: the Owner appoints the Curator. The docs list no eligibility test. (https://docs.morpho.org/learn/concepts/vault/ , summary: owner "can appoint the Curator"). So in practice anyone can create a vault and curate it.
- How curators earn: fee shares minted to the fee recipient. They must redeem shares to get USDC.
  - Source: https://docs.morpho.org/developers/earn/concepts/generate-revenue/ ("Fees are paid in shares")
- Real rate seen: one Steakhouse USDC listing showed 5 percent performance fee (single third-party snapshot, unverified).
- Fee Wrapper: Morpho documents a way for an app to add its own fee on top of an existing vault.
  - Source: https://docs.morpho.org/developers/earn/concepts/generate-revenue/ ("A Fee Wrapper is a Vault V2 configured in a specific, constrained mode")
  - Caveat there: wrapper users depend on the wrapped vault's gates and liquidity.

## 2. Aave V3

- Liquidation bonus: set per asset by governance. It is the extra collateral a liquidator gets.
  - Source: https://aave.com/docs/resources/glossary ("The bonus provided to liquidators as an incentive")
  - Typical values: I could not confirm current Base values. Old or secondary figures: cbBTC 6 percent, WETH 5 percent (2023), some assets 4 to 7.5 percent. Unverified. Read live values from the Aave app before quoting.
- Liquidation protocol fee (LPF): a share of the bonus goes to the Aave treasury. Code:
  - Source: https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/logic/LiquidationLogic.sol
  - `vars.liquidationProtocolFee = vars.bonusCollateral.percentMulCeil(vars.liquidationProtocolFeePercentage);` then it is subtracted from what the liquidator receives and sent to the treasury address.
  - Plain words: bonus part of seized collateral times fee percent goes to treasury. The liquidator gets the rest.
- Typical LPF values (Ethereum Core): "The LPF is 10% for most Ethereum Core collateral, and 20% for USDC and DAI." There is a proposal to raise it to 20 percent for WBTC, WETH and wstETH. No vote result seen.
  - Source: https://governance.aave.com/t/arfc-liquidation-protocol-fee-increase-for-wbtc-weth-and-wsteth-on-aave-v3-ethereum-core/25470 (defines LPF as "the share of each liquidation bonus that accrues to the Aave treasury")
  - Same post, LlamaRisk estimate: about $1.35M to $2.23M a year of extra treasury revenue at higher fee levels (modelled on Ethereum Core only).
  - Base values: unverified.
- Reserve factor: a share of borrower interest to the treasury.
  - Source: https://aave.com/docs/resources/glossary ("A percentage of interest accrued by borrowers that is allocated to the Aave Treasury")
  - Blended rate near 12 percent, per news coverage of a TokenLogic proposal (secondary, unverified; https://www.mitrade.com/insights/news/live-news/article-3-2252525-20261113).
- Close factor (how much debt one liquidation can clear): 50 percent when health factor is above 0.95, 100 percent below it, with a small-position exception. Aave V3.3 changed details. Unverified current exact rule (sources: https://updraft.cyfrin.io/courses/aave-v3/contract-architecture/close-factor and https://governance.aave.com/t/bgd-aave-v3-3-feat-umbrella/20129).
- Key takeaway: Aave earns on liquidations because it is the lending protocol. We are not. Our Aave venue (planned) means Aave's treasury, not us, would get the LPF.

## 3. How apps on top of these protocols earn

| Model | Real numbers found | Source |
|---|---|---|
| Borrow origination fee in the app's own transaction path | Example 200 bps on a 1,000 USDC borrow gives 20 USDC. Morpho says users can bypass it by going direct. | https://docs.morpho.org/developers/blue/guides/monetize-borrow-product/ ("Users can bypass your fee by interacting with Morpho directly") |
| Referral fee through Morpho Bundles on borrow, repay, supply, vault deposit | Fee set by the app (`referralFeePct`), recipient set by the app | same page ("referralFeePct and referralFeeRecipient") |
| Curated vault fees | Up to 50 percent of interest (V1 and V2), plus up to 5 percent a year management (V2). Real vaults seen: about 5 percent performance (unverified). | https://docs.morpho.org/curate/concepts/fee.md |
| Fee Wrapper on a vault | Same caps, paid in vault shares | https://docs.morpho.org/developers/earn/concepts/generate-revenue/ |
| Own liquidator bot | No documented profit numbers. Gross margin is the LIF bonus minus gas and swap cost. Morpho ships an open source bot. | https://github.com/morpho-org/morpho-blue-liquidation-bot ("Liquidation profits are held by the Executor Contract") |
| Automation (DeFi Saver) | 0.05 percent on each triggered automation, plus swap fees: 0.01 percent stable pairs, 0.1 percent correlated, 0.25 percent uncorrelated | https://help.defisaver.com/features/automation/fees ("Automations have a fee of 0.05% on each triggered automation transaction.") and https://help.defisaver.com/features/boost-and-repay/fees |
| Morpho auto-deleverage | Fee on closed amount only, size unverified, product being sunset | https://help.morpho.org/en/articles/12048871-auto-deleverage |
| Instadapp automation fees | Not found. Unverified. | none |

Notes:
- A liquidator bot competes with other bots in a race. Anyone can run one. Margin per liquidation shrinks as bots compete. I found no public profit data. Do not put a revenue number on it.
- DeFi Saver's 0.05 percent per automation is a useful benchmark: it is below our 0.2 percent ceiling.

## 4. Candidate ideas for Stackday

Rule recap from CLAUDE.md: small fees only (0.1 to 0.2 percent max), immutable, capped at 20 bps in code, never take from collateral or vault money, never add a way to change a fee, no own lending pool, contract changes need an agreed issue first.

### A. Own liquidation bot (liquidating positions in the Morpho markets we use, including our users)
- How it works: run an off-chain bot. When a position (any borrower, maybe including a Stackday vault) goes unhealthy, repay the debt and take collateral plus the bonus. Sell the collateral. Keep the difference.
- Revenue logic: bonus times liquidated debt, minus gas and swap cost. Example (my illustration): 100,000 USDC debt liquidated at LIF 1.044 leaves up to about 4,400 USDC gross before costs. How often it happens is unknown. Competing bots take many of these. Revenue is lumpy and zero in calm markets.
- Fee-rule fit: needs founder decision. It is not a fee, so the 0.2 percent cap does not literally apply. But it is a new revenue type the founder rules did not plan for. The bonus is paid by the liquidated user.
- Conflict of interest: high. We earn when our own users lose collateral. Bad optics for a product that says loans get safer each payday. It also clashes with our borrow fee being dropped on liquidation, which was designed to show alignment.
- Safer version: bot only on markets or users that are not Stackday vaults. Still keeps the "we like liquidations" image risk.
- Legal: unverified. Running a liquidation service may be treated differently across countries. Get advice before launching. I found no primary source on this.
- Effort: medium (bot, swap route for tokenized stocks, monitoring, funds at risk). Tokenized stocks may have thin liquidity or oracle gaps outside market hours (unverified).
- Contract change: no. Liquidation on Morpho is open to anyone.

### B. Curated Morpho vault that lends USDC into our stock markets, with a performance fee
- How it works: we create a Morpho vault (V1 or V2), set it to supply USDC to the stock-collateral markets. Depositors earn interest. We take a performance fee on the interest. Optional: also management fee on V2.
- Revenue logic: fee percent times interest earned by deposits. Illustration (my numbers): 1,000,000 USDC deposited, 5 percent yield, 10 percent performance fee gives 5,000 USDC a year. Deposits are the hard part. We have no depositors yet.
- Fee-rule fit: needs founder decision, leaning no as written.
  - The fee is far above 0.2 percent of the amount (10 percent of interest).
  - The curator can change the fee (V1: no timelock, V2: timelock). That breaks "never add a way to change a fee".
  - It looks like a pooled lending product, which touches "no own lending pool" and "never pool funds". It is not our protocol, but deposits are pooled and we choose the risk.
  - Could be made compatible: fee set tiny, a rule to abdicate fee changes if V2 allows it (unverified).
- Conflict of interest: medium. A curator who picks risky stock markets to earn more fees could hurt depositors (bad debt hits lenders, see section 1). Also, it helps our borrowers get liquidity, which is good for the product.
- Legal: unverified. Running an investment vault for outside deposits can raise licensing questions in some countries. Get advice.
- Effort: medium (vault setup, risk work, deposit page). Needs liquidity from outside.
- Contract change: no for the vault itself (it is a Morpho vault, not our contracts). Frontend work and possibly adapter allowlist.

### C. Soft liquidation / pre-liquidation protection service
- How it works: authorize a pre-liquidation contract or a Stackday keeper to reduce risk early, before normal liquidation. Options:
  1. Use Morpho pre-liquidation contracts. The incentive goes to whoever liquidates. We would not earn unless we also run the bot.
  2. Our own protection: when health is low, a keeper repays part of the loan using USDC the user already has in their vault (earning idle USDC), or tops up collateral. This extends the existing emergency rule (next SIP goes to collateral).
- Revenue logic: a fee per triggered action. Benchmark: DeFi Saver 0.05 percent per automation. On a 1,000 USDC repayment that is 0.50 USDC. Small.
- Fee-rule fit: protection itself yes. A fee on it needs founder decision: paying it out of vault money breaks "never take from vault money". A zero-fee version fits fully.
- Conflict of interest: good. We earn (or keep users) when we protect them. This is the best story for judges.
- Legal: low, because it only acts on the user's own vault with the user's opt-in. Still unverified; keep it opt-in and clear.
- Effort: medium. Needs a keeper permission in `EmployeeVault` that can only repay or add collateral, never withdraw. 
- Contract change: yes. Needs an agreed GitHub issue, redeploy, and a security check that a keeper cannot move funds out.

### D. Fee Wrapper on the idle-USDC vault (instead of or on top of the 10 bps earn fee)
- How it works: our idle USDC goes into a Fee Wrapper vault over an existing curated Morpho vault. We earn the wrapper fee.
- Fee-rule fit: needs founder decision. We already take an earn fee (10 bps a year, only from interest). A second layer could break the cap. Replacing the current earn fee with a wrapper fee would be a contract change.
- Conflict of interest: low. Aligned with depositors if fee is small.
- Effort: medium to high. Contract change: yes.

### E. Morpho Bundles referral fee on borrow/repay
- How it works: add `referralFeePct` in the bundle used for borrow or repay.
- Fee-rule fit: not needed. We already have a 10 bps a year borrow fee, built in `EmployeeVault`. A second fee on the same loan would stack and risk the "0.1 to 0.2 percent max" rule.
- Verdict: do not add. Note Morpho's own warning that users can bypass app-level fees.

### F. Do nothing new on revenue
- Keep the three fees. This fits every rule. Spend time on the demo and submission.

## 5. Recommendation (ranked)

1. Keep the current revenue model. It fits all rules and is ready. Use a clear line in the submission: "We earn small fees. We earn nothing when a user is liquidated. The borrow fee is dropped." This is true per CLAUDE.md. Zero effort, strongest alignment story.
2. Show liquidation cost to users in the app. Display the real bonus for each market (about 12.7 percent at 62.5 percent LLTV, 7.4 percent at 77, 4.4 percent at 86, from the Morpho formula). It makes "keep the loan safe" real and teaches the risk. Frontend only, no contract change. Caveat: my numbers assume our percentages are the market LLTV.
3. Protection feature, free, post-submission or only if time allows: a keeper that can repay or top up from the user's own idle USDC (idea C, zero fee). Needs a GitHub issue and founder approval first. Do not start it before the deadline unless it is already agreed: 14 days is short for a vault security change and redeploy.
4. Curated vault (idea B): park as a founder decision for after the hackathon. It could be the largest revenue, but it conflicts with three rules (fee size, fee changeability, pooling) and needs outside deposits.
5. Own liquidation bot (idea A): not recommended. High conflict of interest, thin or unknown profit, competition, and legal advice needed.

Honest caveats:
- I found no documented profit figures for liquidator bots or for pre-liquidation services. Any revenue number above is my own illustration, not data.
- Morpho's own auto-deleverage product is being sunset. That is a warning sign for a soft-liquidation business.
- Current Aave Base bonus and LPF values are unverified. Read them from the live app.
- The Morpho fee switch is probably off, but check on-chain for the exact Base markets.
- Legal notes are general. No primary legal source was checked. Get advice before running bots, vaults for outside money, or paid protection.

## Unverified list
- Aave Base per-asset liquidation bonus and LPF.
- Whether the Morpho fee switch is on for our Base markets.
- Whether a pre-liquidation deployer can receive any cut (believed no).
- Morpho auto-deleverage fee size.
- Instadapp automation fees.
- Whether our listed percentages (62.5, 77, 86) equal the market LLTV.
- Legal and licensing treatment of bots, vaults, and protection services.
- Whether Vault V2 fees can be locked so the curator cannot change them.
