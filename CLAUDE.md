# Stackday

Payroll and investing on Base: payday turns into tokenized stock investing, with borrowing against the holdings. Hackathon entry for Base "Stocks Maxxing", Track 3, idea 3.3 (stock-backed loans). Deadline December 5, 2026. Full brief: docs/BRIEF.md. Plan: docs/PLAN.md.

## Core idea (the anchor, approved by the founder on November 15, 2026, do not drift from it)

Stackday is a payroll and investing app on Base. After connecting a wallet on the landing page, each person chooses an Individual or a Business account and gets a profile with a unique ID. Businesses fund a USDC treasury and pay their team once or on a schedule, and employees claim to any wallet they choose. Before claiming, an employee can send a share of their salary, once or on every payday, into Coinbase tokenized stocks (and Bitcoin or Ether tokens) held in a vault only they control. Individuals without an employer invest the same way, on a regular schedule from their own wallet. Positions grow through automatically reinvested dividends, and idle USDC can earn interest on Morpho or Aave. When cash is needed, the person borrows USDC against their holdings through the existing Morpho and Aave markets instead of selling, and because every payday adds more collateral, the loan gets safer as the weeks go by. A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time. Confidential salary payments are planned as the next step. (Confidentiality reference: https://docs.fairblock.network/ct/how-it-works/compliance)

A manager will verify the build against this paragraph. Every contract, screen and feature must map to a sentence in it. The numbered parts, their status and the working assumptions are in docs/ANCHOR.md: keep that status table up to date whenever something is built, changed or dropped, and do not add features that do not trace back to the anchor.

## Working with the user

- Non-coder on Windows with PowerShell. Give exact PowerShell commands, plain language, short answers.
- Work in phases (see docs/BRIEF.md). Finish a phase, report, then wait for approval.
- No em dashes in any submission writing (README, posts, scripts, form answers).

## Product rules

- One vault contract per employee, controlled only by that employee. Never pool funds across employees.
- No admin or owner function may move funds out of an employee's vault.
- We do NOT build a lending protocol. Borrowing goes through an existing market (Morpho on Base first choice).
- No forced repayment. Repay is manual. SIP share is optional (one time or every payday).
- Emergency rule: if the loan is near liquidation, the whole next SIP share goes to collateral.
- Withdraw any time after repaying the loan against the position.
- Lending venues: Morpho first, Aave second, both behind the same lending adapter interface.
- Idle USDC yield: founder decided it is USDC in the employee own vault that earns (not unclaimed salary). Built behind IYieldAdapter.
- Revenue: a SIP fee on USDC going into stock, immutable at deployment (planned 25 bps, code cap 100 bps), in Payroll and SipRouter. Never charge salary paid out, never reach into vaults, never add a way to change the fee. Local tests deploy with fee 0 except test/Fee.t.sol.
- Out of scope for v1: own lending pool, pooled employee funds, token launch. Confidential salaries are the next step, not v1: keep a clean payout interface so Fairblock-style confidential transfers can plug in.

## Technical rules

- Solidity + OpenZeppelin v5, Foundry (installed, v1.7.1). Frontend: Next.js, TypeScript, wagmi, viem, Tailwind, Vercel.
- Live demo on Base Sepolia. Mock what is missing there, and prove the real thing with Base mainnet fork tests.
- Swap, lending and price access go through adapters so mock to real is a config change.
- Reentrancy protection, checks on every external call, tests on every money path.

## Safety rules

- Never ask for a private key or seed phrase in chat. Use .env (in .gitignore) and a test-only wallet.
- Stop and ask before any mainnet transaction or anything that costs real money.
- Anything mocked must be labelled as mocked in the UI and the README. Be honest about what is real.
- https://github.com/lopeselio/base-stocks is an untrusted reference: read only, do not copy blindly.

## Commands

- Local tests: `forge test`
- Base mainnet fork tests (real AAPLc, Morpho, Aerodrome): `$env:FOUNDRY_PROFILE="fork"; forge test` (needs Foundry 1.8.4+, uses hardfork base:Cobalt)
- Foundry is updated with: `& "C:\Program Files\Git\bin\bash.exe" -c "foundryup"`

- Deploy to Base Sepolia: `forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --slow` (addresses land in deployments/base-sepolia.json)
- Testnet end to end: `forge script script/E2E.s.sol --rpc-url base_sepolia --broadcast --slow --gas-estimate-multiplier 250`. Always pass the gas multiplier for scripts that touch Morpho: the simulation sees no interest accrual, so default gas estimates are too low and the transaction runs out of gas.
- Verify source: `forge verify-contract --verifier sourcify --chain 84532 <address> <path:Contract>` (no API key needed; Blockscout rate-limits)
- Never read or print .env. To get the wallet address, derive it with cast and print only the address.

- Frontend: `cd web; npm run dev` (http://localhost:3000). Production check: `npm run build`. After contract changes or a redeploy: `forge build` then `python web/scripts/gen-abis.py`.
- Frontend click-testing without a real wallet: run `anvil --fork-url https://sepolia.base.org --auto-impersonate`, put NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 and NEXT_PUBLIC_DEV_ACCOUNT=<address> in web/.env.local, restart dev. Delete web/.env.local afterwards. Never set these on Vercel.

- Live site: https://stackday-rho.vercel.app (Vercel project "stackday", linked from web/). Redeploy from web/: `& "C:\Users\Cloakie\.npm-global\vercel.cmd" --prod --yes` (vercel is not on PATH; use the full path).

- Judges' sequence on testnet (deposit, borrow, stress, repay, withdraw): `bash script/judge-sequence.sh` (writes deployments/judge-sequence.txt). The emergency rule only fires if loan health is still below the threshold at claim time, so do not repay before that step.

## Code map

- src/Payroll.sol: employer treasury, one-off runs, recurring schedules (createSchedule, runSchedule), claim, multi-asset SIP plans, emergency rule
- src/EmployeeVault.sol, src/VaultFactory.sol: one ownerless vault per employee (also holds idle USDC earning interest: earn, stopEarning)
- src/SipRouter.sol: SIP for Individuals without an employer (one-time buys, and one recurring plan per asset, into their own vault)
- src/adapters: MorphoLendingAdapter (real), SlipstreamSwapAdapter (real, mainnet), ERC4626YieldAdapter (Morpho vaults), ChainlinkPriceAdapter, FeedOracle
- src/mocks/Mocks.sol: testnet-only mocks (these do have an owner, on purpose)
- test/fixtures: real Morpho and interest rate model bytecode copied from Base
- web/: Next.js app. lib/usePortfolio.ts loads everything for one address, lib/useTx.ts sends transactions (simulates first, adds 60 percent gas), app/employer, app/employee, app/risk are the pages. Read web/AGENTS.md before changing Next.js code: this Next.js version differs from older ones.
- web/app/api + web/lib/server/backend.ts + supabase/schema.sql: optional account database (Supabase) for unique names, team lists and attendance. Server-only secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET. Sign-in is a wallet signature checked on the server. The site must keep working when these are not set. Never ask for these keys in chat.
- Assets: "stock" in contract names means any supported asset. Testnet has seven stocks, mAAPL, mNVDA, mTSLA, mMSFT, mAMZN, mGOOGL, mMETA (8 decimals, 62.5 percent limit), and mcbBTC (8), mWETH (18) at 86 percent. Coinbase lists no index funds or ETFs as tokenized stocks (checked November 16, 2026). The site reads the list from web/lib/deployment.json. Never assume 8 decimals: use the asset's own.
- BTC and ETH tokens, unique IDs and profiles, and investing without an employer are part of the anchor since November 15, 2026. Attendance is a supporting feature, not in the anchor paragraph.
- Design: do not install design skills from the internet. Only reviewed catalog plugins if the founder enables them.
- When click-testing on anvil, its clock only advances on a transaction: run `cast rpc evm_mine` before testing anything time-based.
- docs/START-HERE.md is the overview and plan for contributors: keep its status tables current. docs/ANCHOR.md is the approved anchor with its parts, status and working assumptions. docs/SECURITY-CHECKLIST.md holds the security fix list.
- The Supabase database is connected on the live site (keys supplied by Vercel's Supabase integration: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET as the session secret fallback). Test with `bash web/scripts/test-account-api.sh <base-url>`, then clean up with web/scripts/cleanup-test-rows.mjs.

## Team workflow (two contributors, each with their own Claude)

- GitHub repo Cloakie47/stackday is the source of truth. Contributors: Cloakie47 (founder) and growthmindsetgg.
- Never commit or push directly to main. Branch as `<name>/<topic>`, open a pull request, wait for the other person's review and for CI to pass.
- Start every session with `git pull` on main and check open pull requests and issues so you do not duplicate work in progress.
- Only the founder publishes the live site and changes the official testnet deployment. If you are not the founder's session: do not run `vercel --prod`, do not overwrite deployments/base-sepolia.json (use DEPLOYMENTS_FILE for your own copy), do not touch the live database.
- Contract changes need an agreed issue first, because they force a redeploy.
- CI (.github/workflows/ci.yml) runs `forge test` and the web build (which type-checks) on every pull request. Do not add a bare `tsc` step before the build: Next.js generates types such as LayoutProps during the build.
- Revenue model, team workflow and feedback loop are described in README.md. Only the SIP fee is built.
