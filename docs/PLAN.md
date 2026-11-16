# Stackday: Plan

Written November 13, 2026. Deadline December 5, 2026. Status: waiting for approval. No code written yet.

## 1. Fact check

Checked against Base docs, the hackathon pages, Morpho docs, the Aave blog, and read-only calls to the chains on November 13, 2026.

| Claim | Verdict | What we found |
|---|---|---|
| Stock tokens use B20, which extends ERC-20 | Confirmed | Base docs: B20 "is an extension of the ERC-20 token standard". The tokens are built into the chain itself (native precompiles), not normal deployed contracts. |
| Contracts can hold them without whitelisting | Mostly confirmed | Docs: holding and trading "is permissionless", KYC only for mint and redeem. Blocklists exist (for example sanctioned addresses) and the issuer has freeze, seize and pause powers. Nothing says contracts are treated differently, and Morpho and Aave already hold them. We prove it in a fork test. |
| Dividends through a multiplier, not cash | Confirmed | Dividends are converted to shares and shown as a higher multiplier, net of fees and withholding tax. Balances do not change. |
| Tokenized Stocks API exists | Confirmed | https://api.coinbase.com/v1/tokenized-stocks, read-only, no API key. Gives addresses, multipliers, supply, reference value (NAV), paused features. |
| Morpho has USDC markets for AAPLc, GOOGLc, NVDAc, METAc, SPCXc | Confirmed by news coverage, market IDs still to read | Five markets, curated by Steakhouse. Liquidation limit 62.5 percent (77 percent for GOOGLc). Small so far. Exact market IDs and oracle addresses will be read from Morpho in phase 2. |
| Morpho market creation is permissionless | Confirmed | Anyone can create a market from approved settings. |
| Aave V4 on Base accepts some stock tokens | Confirmed | Seven: AAPLc, AMZNc, GOOGLc, METAc, MSFTc, NVDAc, TSLAc. Collateral only. |
| Chainlink feeds, stale when markets are closed | Confirmed | Feeds run 24/5, 8 decimals, update on 0.5 percent moves or every 24 hours. Nights, weekends, holidays and corporate actions: the price freezes at the last value. Feed price already includes the multiplier. |
| lopeselio/base-stocks toolkit | Confirmed, with a caveat | MIT licence, pre-alpha, not affiliated with Base. Its fork workaround is for older Foundry and is no longer needed. Reference only. |
| Idea "3.3 Stock-backed loans" and its wording | Not verifiable today | The hackathon page shows Track 3 (Programmable Stock Markets, "financing tools" included) but the ideas list says "Coming soon". Your quoted text may come from a partner post. The product fits Track 3 either way. |

Answers to the unknowns:

- Stock tokens on Base Sepolia: NO. Checked on-chain, the AAPLc address is empty on Sepolia. No testnet stock faucet exists.
- Stock price feeds on Base Sepolia: none found.
- Morpho on Base Sepolia: YES. Checked on-chain. Morpho, its interest rate model and its oracle factory are live at the same addresses as mainnet, and the 62.5 and 77 percent liquidation limits are enabled. Test USDC (Circle) is also live.
- S&P 500 or index token on Base: NO. Ten single stocks only: NVDAc, METAc, AAPLc, GOOGLc, AMZNc, MSFTc, MSTRc, SNDKc, SPCXc, TSLAc.
- DEX liquidity: Aerodrome, one USDC pool per stock, roughly 0.8 to 2 million dollars each. Aggregators (0x, 1inch, KyberSwap) route through it.

Things you did not ask about but should know:

- The tokens are for non-US persons only (Regulation S). The app needs a clear eligibility note, and the rules forbid claiming rights the tokens lack, such as voting.
- Secondary coverage says judging is 50 percent traction (verified on-chain usage), 25 percent product, 25 percent building in public. The official rules page only says criteria are on the quest page. If traction really is half the score, a testnet-only demo is weaker there, even though the rules say testnet is "not judged less favourably". Worth deciding in week 3 whether to also do a tiny mainnet deployment. That would cost real money, so it only happens if you say yes.
- The quest period is November 5 to December 5. Building started today, so nothing needs disclosing as pre-existing work.

## 2. Your machine

| Tool | Status |
|---|---|
| Node 24.13.1, npm 11.8.0 | Installed, fine |
| Git 2.53.0 | Installed, fine |
| Foundry 1.7.1 | Installed and works on Windows, but too old. Base docs say 1.8.4 or later is needed to run the real stock tokens in fork tests. |
| Vercel CLI | Not installed. Needed in phase 4 only. |

Commands to run (PowerShell):

```powershell
& "C:\Program Files\Git\bin\bash.exe" -c "foundryup"
```

```powershell
forge --version
```

The second command should show 1.8.4 or higher. Later, in phase 4:

```powershell
npm install -g vercel
```

You will also need (free): a test-only wallet, Base Sepolia test ETH from the Coinbase Developer Platform faucet, test USDC from https://faucet.circle.com, and a free BaseScan API key for contract verification. All of that is walked through in phase 3.

Decision: Foundry, not Hardhat.

## 3. Architecture in plain language

Money flows in one direction: employer, then payroll, then the employee's wallet and the employee's own vault.

1. The employer puts USDC into the Payroll contract and lists who gets how much.
2. An employee claims. If they set a SIP share, that slice is swapped into a stock token and sent to their personal vault. The rest goes to whatever wallet they choose.
3. The vault is a small contract owned by that one employee. It holds their stock tokens and is the borrower in the lending market. Nobody else, including us, can move anything out of it.
4. To borrow, the vault posts its stock tokens as collateral in a Morpho market and receives USDC, which goes to the employee.
5. Each later payday adds stock to the vault. If the employee has a loan, new stock goes straight to collateral, so the loan gets safer.
6. Emergency rule (optional): if loan health is below the employee's chosen threshold at claim time, the entire SIP share of that payday goes to collateral.
7. Repay and withdraw are buttons the employee presses. Nothing is forced.

Three adapters sit between our contracts and the outside world, so swapping mock for real is a settings change: swap adapter (where we buy stock), lending adapter (where we borrow), price adapter (where we read prices).

## 4. Contracts

| Contract | One line |
|---|---|
| Payroll | Holds employer USDC, records payroll runs, lets each employee claim to any address with an optional SIP share. |
| SipSettings (inside Payroll) | Stores each employee's standing SIP percent, chosen stock, and emergency rule. Only the employee can change them. |
| VaultFactory | Creates one vault per employee, at a predictable address. |
| EmployeeVault | Holds one employee's stock, and lets only that employee deposit collateral, borrow, repay and withdraw. No admin functions. |
| ISwapAdapter + MockSwapAdapter | Buys stock with USDC. Mock version sells mock stock at the feed price. |
| AerodromeSwapAdapter | Real version for Base mainnet, used in fork tests. |
| ILendingAdapter + MorphoLendingAdapter | Supply collateral, borrow, repay, withdraw, read health. One version, works on both networks because Morpho is on both. |
| IPriceAdapter + ChainlinkPriceAdapter | Reads a Chainlink-style feed and reports price plus how old it is. |
| MockStockToken (testnet only) | Stand-in for a stock token, with a multiplier and a transfer pause switch for stress tests. |
| MockPriceFeed (testnet only) | Chainlink-shaped feed with a settable price and a freeze switch for stress tests. |
| IPayoutRoute (interface only) | Empty slot where confidential salary payments can plug in later. Not built in v1. |

## 5. Screens

1. Landing: what Stackday is, connect wallet, risk note, eligibility note.
2. Employer: deposit USDC, add employees and amounts, run payroll, see past runs.
3. Employee: claimable salary, SIP slider, one time or every payday toggle, claim to any address, vault holdings and value.
4. Borrow and repay: borrow, repay, withdraw, emergency rule setting.
5. Risk screen: borrowing cost, borrow limit, loan health, liquidation price, repayment options, stress test (10, 20, 30 percent gap, paused transfers, frozen weekend price), and the exact Morpho market used.
6. Demo panel (testnet only, labelled): new payday, price drop, pause transfers, price recovery.

## 6. Real versus mocked

On the Base Sepolia live demo:

| Piece | Real or mocked |
|---|---|
| Base Sepolia network, USDC (Circle test USDC) | Real testnet |
| Morpho lending (contract, interest model, liquidation rules) | Real Morpho, in a market we create ourselves and fund with test USDC |
| Our contracts (payroll, vaults, adapters) | Real |
| Stock token | Mocked (labelled "mAAPL, mock stock") |
| Stock price feed | Mocked, settable for stress tests |
| Stock purchase (swap) | Mocked, sells at the feed price |
| Dividends | Simulated through the mock multiplier |

On the Base mainnet fork tests (run on your PC, costs nothing): real AAPLc token, real Chainlink feed, real Steakhouse Morpho market, real Aerodrome pool. These prove the same vault code works with the real pieces.

## 7. Schedule

Week 1, November 13 to 19: contracts and tests.
- Nov 13 to 14: approve plan, update Foundry, project setup, mocks.
- Nov 15 to 17: vault, factory, payroll, claim with SIP, adapters, emergency rule.
- Nov 18 to 19: full test suite, mainnet fork tests.

Week 2, November 20 to 26: testnet and frontend.
- Nov 20 to 21: deploy to Base Sepolia, create and fund the Morpho market, verify, one command line end to end run.
- Nov 22 to 26: employer page, employee page, borrow and repay, risk screen. Deploy to Vercel.

Week 3, November 27 to December 2: demo and hardening.
- Nov 27 to 28: demo panel, judge sequence on the live site.
- Nov 29 to 30: security review and fixes.
- Dec 1 to 2: wording and honesty pass, README, buffer. Decide on optional tiny mainnet deployment.

December 3 to 5: reserved for the demo video, X post and submission form. No new features.

Build-in-public posts go out through all three weeks, since that is part of the judging.

## 8. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Fork tests cannot run the real stock tokens even after the Foundry update | Use Base's own Foundry build (base-anvil). If that fails too, use the etch technique from the base-stocks toolkit, written ourselves. |
| A real stock token blocks our vault contract | Fork test catches it in week 1. Fallback: document it honestly, the demo is unaffected since it uses mocks. |
| Our own Morpho market on Sepolia has no lenders | We supply the test USDC ourselves at deploy time. It is free faucet money. Faucet limits are per day, so start collecting early. |
| Morpho's oracle wrapper does not fit our mock feed | The mock feed copies the Chainlink interface exactly. Fallback: a tiny custom oracle contract, which Morpho permits. |
| Loan gets liquidated while the price feed is frozen over a weekend | This is the real risk the brief asks us to model. Conservative borrow cap (for example half the liquidation limit) plus the stress test on the risk screen. |
| Emergency rule can only act at claim time, not instantly | Say so plainly on the risk screen. It is a safety habit, not liquidation protection. |
| Public RPC rate limits slow fork tests | Free Alchemy or Coinbase Developer Platform RPC key in .env. |
| Traction counts for half the score and testnet usage counts for little | Decide by December 1 whether to do a small mainnet deployment. Only with your explicit approval. |
| Compliance (non-US only tokens, lending rules) | Eligibility and risk notes in the app, no promises of rights the tokens lack, mocks clearly labelled. Not legal advice. |
| Time | Stretch goal (idle USDC yield) is dropped first. Risk screen and the deposit, borrow, repay, withdraw path are protected. |

## 9. Key addresses (reference)

Base mainnet and Base Sepolia, same address on both:
- Morpho: 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
- Morpho interest rate model: 0x46415998764C29aB2a25CbeA6254146D50D22687
- Morpho Chainlink oracle factory: 0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d

Base Sepolia:
- USDC (Circle test): 0x036CbD53842c5426634e7929541eC2318f3dCF7e

Base mainnet (fork tests only):
- AAPLc: 0xb200000000000000000000C2e324d24d7eEcd1fb
- AAPL Chainlink feed: 0x787f13dEa48Db0897CbCDD985de77809D837F988
- NVDAc: 0xb20000000000000000000078ee7ce2fE4908108C
- NVDA Chainlink feed: 0x04689a41629776563E6822F76f2e57D148d28513

All addresses get re-checked on-chain before use.

## 10. Core idea checklist (for the reviewer)

Updated November 13, 2026, after phase 2 (contracts and tests). Every row is one phrase of the canonical description in docs/BRIEF.md. Nothing is built that does not appear here.

| Phrase in the core idea | Where it lives | Status |
|---|---|---|
| "payroll platform for teams paid in USDC on Base" | src/Payroll.sol | Built, tested |
| "Employers pay salaries" | Payroll: deposit, createRun, depositAndCreateRun | Built, tested |
| "employees claim to any wallet they choose" | Payroll: claim, claimWithSip (recipient parameter) | Built, tested |
| "send a share of their salary, once or on every payday" | Payroll: claimWithSip (once), setSipPlan plus claim (every payday) | Built, tested (0 percent, 100 percent, standing instruction) |
| "into Coinbase tokenized stocks" | Swap adapter. Testnet: MockSwapAdapter and MockStockToken (mock). Mainnet: SlipstreamSwapAdapter buying real AAPLc on Aerodrome | Built. Real path proven on a Base mainnet fork |
| "held in a vault only they control" | src/EmployeeVault.sol, src/VaultFactory.sol. One vault per employee, no admin, no upgrade | Built, tested (5 different outsiders cannot move funds) |
| "position grows through automatically reinvested dividends" | Property of the real token (multiplier). Nothing to build. Mock token has a multiplier to demonstrate it | Real on mainnet. Simulated on testnet. UI display comes in phase 4 |
| "idle USDC can earn interest on Morpho or Aave" | EmployeeVault.earn and stopEarning, src/adapters/ERC4626YieldAdapter.sol. Founder decision: it is the USDC in the employee's own vault that earns, not unclaimed salary. Testnet uses MockYieldVault (mock) | Built, tested. Proven on a fork with a real Morpho vault (Steakhouse High Yield USDC: 5,000 USDC became 5,018.64 in 30 days). Aave venue not built |
| "borrows USDC against their stocks through the existing Morpho ... markets" | src/adapters/MorphoLendingAdapter.sol. Vault is the borrower in the real Morpho market | Built, tested on real Morpho code. Proven on the real AAPLc/USDC market on a fork |
| "... and Aave markets" | Same ILendingAdapter interface, Aave adapter not written | OPEN. Aave V4 is mainnet only and its stock market address is not yet confirmed |
| "instead of selling" | Vault: borrow, repay, removeCollateral, withdraw | Built, tested |
| "every payday adds more collateral, the loan gets safer" | Vault.depositStock sends new stock to collateral when a loan is open | Built, tested (health doubles after second payday) |
| "Confidential salary payments are planned as the next step" | Not in v1. Fairblock confidential transfers are live on Base and Base Sepolia. Payout goes through one function in Payroll so a confidential route can be added | Planned, not built |

Supporting pieces the hackathon brief requires (risk and honesty), all in service of the lines above:

| Piece | Where | Status |
|---|---|---|
| Conservative borrow limit | Vault borrow cap: 50 percent of the liquidation limit by default, employee may raise to 85 percent at most | Built, tested |
| Emergency rule | Payroll.setEmergencyRule: if loan health at claim time is at or below the employee's threshold, at least the employee's chosen emergency share of that salary buys stock and goes to collateral | Built, tested |
| Stress: overnight or weekend price gap | MockPriceFeed freeze and reopenAt | Built, tested |
| Stress: paused collateral transfers | MockStockToken pause switch | Built, tested (salary still paid, repay works, withdraw and liquidation blocked) |
| Liquidation | Done by Morpho, not by us | Tested (healthy loan cannot be liquidated, underwater loan can) |
| Salary never stuck | If the stock purchase fails for any reason, the full salary is paid in USDC | Built, tested |

Choices made during phase 2 that differ from or sharpen the plan:

1. Emergency rule meaning. New stock already goes to collateral whenever a loan is open, so the rule needed to do more to be worth having. It raises the SIP share for that payday to a level the employee set in advance (for example 50 percent), even if they had picked less.
2. Employers can take back a salary that stays unclaimed for 180 days (for example a mistyped address). Before that, assigned salary belongs to the employee.
3. The exchange adapter for mainnet talks to the Aerodrome Slipstream AAPLc/USDC pool directly.
4. The exact real market: Morpho AAPLc/USDC, id 0xae1a30486234bf7e7ac166c7c03d9bc5f2cd8a39be2c48e73c665ac7148c3c28, liquidation limit 62.5 percent. It is small (about 16,000 USD supplied on November 13, 2026).

Founder-requested extension (November 13, 2026), NOT in the canonical paragraph:

| Request | Where it lives | Status |
|---|---|---|
| "normal users should be able to use SIP for stocks and collateral system and borrow against it", without an employer | src/SipRouter.sol: invest (one-time) and setPlan plus executePlan (recurring, anyone can trigger a due plan, bounded by the user's own amount, interval and price tolerance). Same vault, same borrowing | Built, tested (7 tests). Reviewer note: the canonical description only mentions payroll. Either add a sentence to it or treat this as an add-on |

Open decisions for the founder:

- Which wallet receives the SIP fee (needed at deployment in phase 3).
- Employer subscription pricing (no contract change needed).
- Aave: build the Aave adapter as a mainnet fork proof only (no Aave V4 on testnet was found), or leave it as a documented next step.

## 11. Test results (phase 2)

- Latest (after idle USDC interest, SipRouter and the SIP fee): local suite 49 tests, fork suite 3 tests, all pass.
- Original phase 2 local suite: 30 tests, all pass. Run with `forge test`. Lending runs on the real Morpho and interest rate model code copied from Base. Stock token, price feed, exchange and USDC are mocks.
- Base mainnet fork suite: 2 tests, all pass. Run with `$env:FOUNDRY_PROFILE="fork"; forge test`. Real AAPLc, real USDC, real Chainlink feed, real Aerodrome pool, real Morpho market. No mocks. Costs nothing.
- Line coverage of core contracts: Payroll 98 percent, EmployeeVault 98 percent, VaultFactory 91 percent, MorphoLendingAdapter 93 percent. Branch coverage is lower (45 percent overall): not every error message path has its own test yet.
- Not deployed anywhere yet.

## 12. Tech choices and revenue (recommendations, not yet decided)

### Tech for non-payroll users

Question asked: should normal users get SIP, collateral and borrowing through Uniswap hooks?

Recommendation: no hooks. A Uniswap v4 hook changes how one specific pool behaves, so it only helps if Stackday runs its own stock pool. The stock liquidity already sits in Aerodrome and existing Uniswap pools. Our own hooked pool would start empty, split liquidity and need us to fund it. The SIP, vault and borrowing do not need anything from the pool except a fair price.

What fits better, in order:

1. SipRouter (built): any wallet buys into its own vault, once or on a schedule, through the same swap adapter.
2. Base Account spend permissions (to verify, then build in the frontend phase): a Base smart wallet feature where the user grants an app a recurring allowance, for example 100 USDC per week. This is the native Base way to do a recurring SIP with one signature and no unlimited approval.
3. An automation service to trigger due plans (Chainlink Automation or Gelato, or a small script of ours for the demo). The contract already lets anyone trigger a due plan safely.
4. Swap routing through an aggregator (0x or similar) on mainnet later, for a better price than one pool.

### Revenue options

| Option | How it works | Fits the rules? | View |
|---|---|---|---|
| A. SIP fee | Small fixed cut (for example 0.25 percent) of each USDC amount going into stock, taken before the swap. Fixed at deployment, no admin can raise it | Yes, never touches vault funds | Recommended. Scales with usage, easy to explain |
| B. Employer subscription | Monthly fee per employee, billed off-chain or in USDC | Yes | Recommended alongside A. Classic payroll pricing |
| C. Share of interest | Cut of the interest idle USDC earns | Needs care: must be taken at the adapter, not by reaching into vaults | Later |
| D. Borrowing fee | Small fee when a loan is opened | Yes, but makes borrowing more expensive and looks like lending business for compliance | Not now |
| E. Own Morpho vault | Stackday curates the USDC vault that lends against stocks and earns the curator fee | Bigger project, real risk management duty | Long term |

Decision (founder, November 13, 2026): option A is built. A SIP fee fixed at deployment (planned at 0.25 percent, hard cap 1 percent in the code) is taken from the USDC going into stock, in both Payroll and SipRouter, and sent to a fee wallet chosen at deployment. Salary paid out in USDC is never charged. If the stock purchase fails, no fee is taken. The fee wallet has no powers over vaults or salaries. Tested with 7 tests, and on the Base fork. Option B (employer subscription) needs no contract change and is still open.

## 13. Phase 3 result: Base Sepolia deployment (November 13, 2026)

- Deployed: all Stackday contracts, two mock stocks (mAAPL, mNVDA) with mock price feeds, two real Morpho markets funded with 3 test USDC each, mock exchange, mock interest vault. Addresses are in README.md and deployments/base-sepolia.json.
- End to end run on testnet completed: payday, claim with 20 percent SIP, borrow, repay, withdraw. Transaction links are in README.md.
- Source code verified on Sourcify (exact match) for all 16 contracts. Not verified on BaseScan itself: that needs a free API key in .env.
- One hiccup: the first repay transaction ran out of gas because of a low automatic gas estimate in the script. Re-sent with a larger allowance. Not a contract issue. The frontend must add a gas margin on vault transactions.
- Testnet liquidity is tiny (3 USDC per market), so demo loans must stay small until more faucet USDC is added.

## 14. Phase 4 result: frontend (November 14, 2026)

- Built in web/: Home, Employer, My pay, Risk. Every mocked piece carries a "Mock" label, a testnet banner is on every page, and the risk note appears on Home, My pay and Risk.
- Clicked through on a local simulated copy of Base Sepolia, all succeeded: run payroll, claim with a 10 percent SIP share, borrow, risk screen with a live loan, repay all, withdraw, start earning interest, save emergency rule, buy stock without an employer.
- Not clicked through yet: the every-payday toggle, recurring plan (save, run, cancel), deposit only, withdraw unused, turning rules off, and a real browser wallet on the live testnet.
- Checked at phone width: no sideways scrolling.
- Not deployed to Vercel yet. Not built: demo panel for price drops and pauses (phase 5).
- Core idea mapping: Employer page = "Employers pay salaries". My pay = claim to any wallet, SIP share once or every payday, vault, dividends note, idle USDC interest, borrow instead of selling. Risk = hackathon brief for stock-backed loans.
- Published to Vercel on November 14, 2026: https://stackday-rho.vercel.app (project "stackday"). Checked live: the risk page loads testnet data without a wallet. Not yet checked live: connecting a real browser wallet and sending a transaction.

## 15. Phase 5 result: demo and hardening (November 14, 2026)

- Demo panel built at /demo (testnet only, labelled): price drop 10, 20, 30 percent or exact, market closed and reopened lower, pause and resume transfers, recover price, new payday, pay interest into the mock venue, take test USDC back from the mock exchange. Switches only work for the wallet that owns the mocks.
- Security self-review done. One contract fix (stale price guard on recurring buys in SipRouter), five new tests. Findings, checks and known limitations are listed in README.md under "Security review". Local suite: 55 tests pass.
- Because the contract changed, everything was redeployed to Base Sepolia and re-verified on Sourcify. Old deployment retired (deployments/base-sepolia-v1-retired.json) and its test USDC withdrawn from the old markets.
- Judges' sequence run on the real testnet with script/judge-sequence.sh: deposit, borrow, 30 percent price gap, emergency rule firing on the next payday, pause with repay still working and collateral locked, resume, recovery, full repay, withdraw. All transaction links are in README.md.
- Honesty pass on the site: dividends on testnet are stated as not paid by the mocks, "not deployed to mainnet, no independent audit" is stated on Home, the conservative limit is described as lowering risk and not removing it, the risk screen says the testnet price comes from a mock feed.
- Not done: the demo panel buttons and the live site were not clicked with a real browser wallet by the builder (the same contract calls were made from the command line). Aave adapter and confidential salaries are still not built.

## 16. Founder requests of November 14, 2026 (built)

All of these were asked for after phase 5. Rows marked EXTENSION go beyond the canonical paragraph in docs/BRIEF.md: the reviewer should either accept them as add-ons or the founder should add a sentence to the description.

| Request | Where it lives | Status | Anchors to the core idea? |
|---|---|---|---|
| Fund an employer treasury and set a payout timeframe (daily, weekly, monthly) that keeps running | Payroll: deposit, createSchedule, runSchedule, setScheduleActive. Site: Run payroll page | Built, 7 tests, shown on testnet (two paydays a minute apart) | Yes: "Employers pay salaries" |
| At claim, suggest 10 or 20 percent to SIP | Site: Get paid page presets | Built, clicked through | Yes: "send a share of their salary, once or on every payday" |
| Not only stocks: BTC, ETH (cbBTC, WETH) | Payroll multi-asset plans (setSipPlanMany, claimMany, claimWithSipMany). Mock cbBTC and WETH tokens with their own Morpho markets at 86 percent | Built, 6 tests, clicked through | EXTENSION: the paragraph says "Coinbase tokenized stocks" only |
| Choose what to buy and see your plans in your own dashboard | Site: Dashboard, Invest. SipRouter: one recurring plan per asset | Built, clicked through | Yes for stocks, EXTENSION for crypto |
| Save employee details in a database (Supabase) | supabase/schema.sql, web/app/api/employees, Run payroll page Team section | Code built. NOT connected: needs the founder to create a Supabase project and add three keys. Until then the team list is kept in the browser | Supports "Employers pay salaries" |
| Each wallet is an account with a unique name | supabase/schema.sql (profiles), web/app/api/profile, Dashboard | Code built, NOT connected (same reason). Not tested against a real database | EXTENSION (off-chain convenience) |
| Track employee attendance | supabase/schema.sql (attendance), web/app/api/attendance, Dashboard check-in, Run payroll grid | Code built, NOT connected, not tested against a real database. It is a record only and does not change pay | EXTENSION |
| Redesign the website | web/app, web/components: new design system (warm paper, ink, serif display type), app shell, motion that respects reduced-motion | Built and published | Presentation only |

Notes:

- Design skills: the three named by the founder are not in the reviewed plugin catalog, so they were not installed. The redesign was done directly. Anthropic's frontend-design skill and the official Supabase plugin were offered as safe options.
- Contracts changed, so this is the third testnet deployment. All 24 contracts verified on Sourcify. Local suite: 69 tests pass. The judges' sequence and a recurring payroll run were repeated on the new deployment (links in README.md).
- Clicked through on a simulated copy of the testnet: fund treasury, add team member, start a schedule, release a payday, claim with a three-asset split saved as an every-payday plan, dashboard. Not clicked: Invest, Borrow, Risk and Demo pages in the new design (same contract calls as before, new screens), and everything that needs the database.
- Recurring payroll needs someone to press "release" when a payday is due. No automation service is set up.

## 17. Since section 16 (November 14 to 15, 2026)

- The Supabase database is now connected on the live site. Names, team lists and attendance work and were tested with 21 checks against the real database (web/scripts/test-account-api.sh). The public cannot read or write the tables directly. The rows in section 16 that say "NOT connected" are out of date.
- All work is committed to a private GitHub repository: https://github.com/Cloakie47/stackday
- docs/SECURITY-CHECKLIST.md: self-assessment against 20 common web attack types, with a fix list of six items, none done yet.
- docs/ANCHOR.md (first written as ANCHOR-DRAFT.md): a wider anchor proposed by the founder (account types, unique IDs, business profiles, Themes).
- docs/START-HERE.md: one-page overview and plan for contributors.

## 18. New anchor approved (November 15, 2026)

- The founder approved the wider anchor as drafted. It is now the anchor in force: docs/ANCHOR.md, with the paragraph repeated in docs/BRIEF.md and CLAUDE.md. The earlier paragraph is kept at the end of docs/BRIEF.md.
- Sections 1 to 17 of this file were checked against the earlier anchor. From here on, the status table to keep current is the one in docs/ANCHOR.md section 2.
- What the new anchor makes core that was an extension before: Bitcoin and Ether tokens, investing without an employer, unique IDs and profiles.
- What it adds that is not built: Individual or Business choice, automatic unique ID and profile, business name and description, role-based dashboards, finding people, Themes.
- The founder did not answer the draft's open questions, so its assumptions stand as working assumptions (docs/ANCHOR.md section 3). One of them, whether an employee must accept being added to a team, has a security recommendation attached.
- Next: the account flow (anchor parts 2 to 6), then the security fix list, then Themes.
