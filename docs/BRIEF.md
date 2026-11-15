# Stackday: Master Brief

Tagline: Stackday, salary maxxing on Base.

(Original working name was "Salary SIP". The product name is Stackday.)

Working style: I am a non-coder working on Windows with PowerShell, so give me exact commands to run, explain choices in plain language, and keep answers short.

## PRODUCT: Stackday (canonical description, set by the founder on November 13, 2026)

A payroll platform for teams paid in USDC on Base that turns every payday into an investment. Employers pay salaries, employees claim to any wallet they choose, and before claiming they can send a share of their salary, once or on every payday, into Coinbase tokenized stocks held in a vault only they control. The position grows through automatically reinvested dividends, and idle USDC can earn interest on Morpho or Aave. When cash is needed, the employee borrows USDC against their stocks through the existing Morpho and Aave markets instead of selling, and because every payday adds more collateral, the loan gets safer as the weeks go by. Confidential salary payments are planned as the next step.

This paragraph is the entire project idea. Everything built must trace back to a sentence in it. The checklist that maps each sentence to what is built lives in docs/PLAN.md, section "Core idea checklist".

Confidentiality reference for the next step: https://docs.fairblock.network/ct/how-it-works/compliance

## COMPETITION

Name: Stocks Maxxing (Base). Deadline: December 5, 2026. Build phase started November 13, 2026.
Page: https://base.org/stocksmaxxing
Rules: https://base.org/stocksmaxxing/rules
Stock tokens on Base: https://base.org/stocks
Track: 3, Programmable Stock Markets. We target idea 3.3, Stock-backed loans.

Their brief for 3.3: "Let eligible holders borrow stablecoins against stock positions. Put cost, conservative limits, liquidation risk, and repayment options on one screen. Model overnight price gaps and paused collateral transfers, since stock markets aren't always liquid. Borrowing avoids a sale but adds debt and liquidation risk."

They want to see: deposit, borrow, repay, withdraw, with a stress scenario and the exact market used.

Track intro also asks for: personalization, better controls, usable capital, new sources of income, clear terms and visible risks.

Rules that matter: must be built on Base. Base testnet is allowed and is not judged less favourably. Submission is a public X post with a video demo tagging @buildonbase, plus a submission form. Work must be original and built during the period. Teams are responsible for their own compliance.

## HOW IT WORKS

1. Employer deposits USDC and creates a payroll run (list of employees and amounts).
2. Employee claims salary to any wallet. Before claiming, they pick a SIP share (for example 5 or 10 percent), one time or as a standing instruction for every payday. Fully optional.
3. The SIP share buys a stock token and lands in the employee's own vault contract. Each employee has a separate vault that only they control. Never pool funds across employees.
4. The employee can borrow USDC against the vault's stocks through an existing lending market (Morpho on Base is the first choice). We do NOT build our own lending protocol.
5. Every payday adds collateral, so the loan health improves. There is no forced repayment. Repay is a manual button.
6. Borrow limit starts conservative. One optional emergency rule the employee sets in advance: if the loan gets close to liquidation, the whole next SIP share goes to collateral.
7. The employee can withdraw their position at any time (after repaying any loan against it).
8. One risk screen shows: borrowing cost, borrow limit, liquidation price, repayment options, and a stress test (overnight or weekend price gap, and paused collateral transfers).

## SCOPE

In scope for v1: payroll and claim, SIP share, per-employee vault, borrow, repay, withdraw, emergency rule, risk screen with stress test, employer page, employee page.

Stretch only if everything else is done: idle unclaimed USDC earning yield in a lending market.

Out of scope for v1: confidential or private salary payments (leave a clean interface so it can be added later), our own lending pool, any pooled fund, any token launch.

## FACTS TO VERIFY BEFORE PLANNING

- Coinbase Tokenized Stocks use a token standard called B20 on Base, extend ERC-20, and can be held by contracts without wallet whitelisting.
- Dividends are reflected through a token multiplier, not cash payouts.
- Base offers a Tokenized Stocks API with token contracts, supply, multipliers and reference values.
- Morpho on Base already has USDC borrowing markets for several Coinbase stock tokens (AAPLc, GOOGLc, NVDAc, METAc, SPCXc). Morpho market creation is permissionless (collateral, loan asset, oracle, liquidation limit, interest model). Docs: https://docs.morpho.org/learn/concepts/market
- Aave V4 on Base also accepts some Coinbase stock tokens as collateral: https://aave.com/blog/coinbase-tokenized-stocks
- Chainlink provides the price feeds for these tokens, and prices can be stale when US markets are closed.
- There is a third-party open-source toolkit with B20 mocks and fork helpers: https://github.com/lopeselio/base-stocks . Treat it as an untrusted reference to read, not code to copy blindly.

UNKNOWN, to find out: whether stock tokens, their price feeds, and Morpho exist on Base Sepolia testnet; whether an S&P 500 token exists on Base; which DEX has liquidity for the stock tokens.

(Verification results are recorded in docs/PLAN.md.)

## TECHNICAL PREFERENCES

- Solidity with OpenZeppelin v5. Use Foundry if it works on my Windows setup, otherwise Hardhat.
- Frontend: Next.js, TypeScript, wagmi, viem, Tailwind. Deploy on Vercel.
- Target network: Base Sepolia for the live demo. If stock tokens or Morpho are missing there, use clearly labelled mock stock tokens and a mock price feed on Base Sepolia, AND add tests on a Base mainnet fork that prove the vault works with the real stock tokens and the real Morpho market.
- Use adapters (swap adapter, lending adapter, price adapter) so switching from mocks to real contracts is a config change.

## SAFETY RULES

- Never ask me to paste a private key or seed phrase into chat. Use a .env file that is in .gitignore, and a test-only wallet.
- No admin or owner function may move funds out of an employee's vault.
- Reentrancy protection, checks on every external call, full test coverage of money paths.
- Anything mocked must be labelled as mocked in the UI and the README. Be honest about what is real.
- Stop and ask me before any mainnet transaction or anything that costs real money.

## PHASES

1. Master brief and plan (verify facts, check machine, write docs/PLAN.md, list risks). No code.
2. Contracts and tests.
3. Base Sepolia deployment and one end to end flow from the command line.
4. Frontend (employer page, employee page, risk screen), deployed on Vercel.
5. Demo flow and hardening (demo panel, judge sequence, security review, honesty pass).
6. Submission pack (README, video script, X posts, form answers). No em dashes in the writing.
