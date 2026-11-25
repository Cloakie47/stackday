# Stackday: start here

For anyone joining the project. Last updated November 15, 2026 (anchor approved).
Read this first. It tells you what Stackday is, what exists, what is left, and where everything lives.

## 1. What we are building

Stackday is a payroll and investing app on Base. A business pays its team in USDC. Before claiming, each person can send a share of their salary into tokenized stocks (and Bitcoin or Ether tokens) held in a vault only they control. When they need cash they borrow USDC against what they hold instead of selling.

It is our entry for the Base "Stocks Maxxing" competition, Track 3 (Programmable Stock Markets), aimed at the stock-backed loans idea.

- Deadline: December 5, 2026. Submission is a public X post with a video demo tagging @buildonbase, plus a form.
- Live site: https://stackday-rho.vercel.app (testnet demo)
- Code: https://github.com/Cloakie47/stackday (private)
- Network: Base Sepolia (testnet). Nothing is on Base mainnet.

### The anchor

Everything we build must trace back to one paragraph, called the anchor. A reviewer checks the build against it.

The anchor was widened and approved by the founder on November 15, 2026. It is in docs/ANCHOR.md, with its numbered parts, what is built for each, and the working assumptions. In short it adds, on top of payroll, payday investing, the vault and borrowing: account types (Individual or Business), a unique ID and profile for every user, business profiles, role-based dashboards, finding people, and a Themes layer.

## 2. Where everything is

| What you want | Where |
|---|---|
| The competition brief and original working rules | docs/BRIEF.md |
| The anchor, product description, status of each part, working assumptions | docs/ANCHOR.md |
| Full history of decisions, phase by phase | docs/PLAN.md (a running log, long) |
| Security self-assessment and fix list | docs/SECURITY-CHECKLIST.md |
| Deployed addresses, transaction links, how to run | README.md |
| Rules the AI assistant follows in this repo | CLAUDE.md |
| Smart contracts | src/ |
| Contract tests | test/ |
| Deploy and demo scripts | script/ |
| Web app | web/ |
| Database tables | supabase/schema.sql |
| Records of each testnet deployment and demo run | deployments/ |

## 3. What exists today

Built, tested and live on testnet:

| Area | What it does | Where |
|---|---|---|
| Payroll | Employer treasury, pay once or on a schedule (daily, weekly, 2 weeks, monthly), claim to any wallet | src/Payroll.sol |
| Payday investing | A share of each salary into one or several assets, once or every payday | src/Payroll.sol |
| Vault | One vault per person, no admin, no pooled money | src/EmployeeVault.sol, src/VaultFactory.sol |
| Themes | /themes: pick themes and a risk level, split with targets for new buys, buy from salary or wallet, market mood from a dated snapshot, rebalance with new money only. Weekly live news refresh planned | web/lib/themes, web/app/(app)/themes |
| Borrowing | Lock collateral as one basket of any assets, then borrow, repay, unlock, withdraw through real Morpho markets. Conservative limit. Emergency rule | src/adapters/MorphoLendingAdapter.sol |
| Investing without an employer | One-time and recurring buys from a wallet, one plan per asset | src/SipRouter.sol |
| Interest on idle USDC | USDC in the vault can be lent out | src/adapters/ERC4626YieldAdapter.sol |
| Private pay | Fairblock confidential transfers (real on Base Sepolia, beside Payroll): set up from the team invite, private payday for the whole team with readiness badges and a normal-pay fallback, collect and invest a share in one flow on My pay, saved split for every payday, new-pay reminder, private pay record with CSV export | web/lib/confidential.ts, web/components/private-payday.tsx, web/components/private-collect.tsx |
| Revenue | Small fixed fees, 0.2 percent at most: 0.15 percent on recurring buys (one-time free), 0.1 percent a year on loans, paid on repayment, 0.1 percent a year from interest on idle USDC | Payroll, SipRouter, EmployeeVault (settings in VaultFactory) |
| Web app | Landing, Start (Personal or Business), Home, My pay, Invest (with real price chart), Borrow (collateral basket), Risk, Payroll, Docs, Testnet tools | web/app |
| Account database | Unique name per wallet, saved team lists, attendance check-in. Connected on the live site | web/app/api, supabase/schema.sql |
| Gift boxes | /gifts: send a box of test USDC (one stock, my mix, surprise or research pick) to a Stackday ID or wallet, the recipient opens it into their own vault with a box animation, or declines; the sender can take it back; expired boxes are refunded by the trigger bot. Optional message kept in the `gifts` table (the founder adds it to the live database). Contract src/GiftBox.sol on Base Sepolia | src/GiftBox.sol, web/lib/gifts, web/app/(app)/gifts, web/app/api/gifts |

Tests: 69 local tests pass. Separate tests run the same code against the real AAPLc token, a real Aerodrome pool and the real Morpho market on a private copy of Base mainnet.

What is real and what is mocked on testnet:

- Real: our contracts, Morpho, Circle test USDC.
- Mocked and labelled as such: the asset tokens (stand-ins for AAPLc, NVDAc, cbBTC, WETH), their price feeds, the exchange, the interest venue. The mocks pay no dividends.

## 4. What is not built

- The Themes weekly live news refresh (plan in docs/themes/weekly-plan.md). Selling is not possible in the contracts yet: they only buy (issue #35, after the deadline).
- Aave, for borrowing or for interest.
- Confidential salaries inside the Payroll contract (private pay runs beside it through Fairblock, phase 1 built).
- An automation service to release paydays. Today someone presses a button when a payday is due.
- The six security fixes in docs/SECURITY-CHECKLIST.md.
- The submission pack (README polish, video script, X posts, form answers).

## 5. The plan from here

20 days remain. The last three are reserved for the video and submission.

| When | Work | Depends on |
|---|---|---|
| Nov 16 to 19 | Account flow: Individual or Business choice, unique ID and profile on first sign-in, business name and description, routing to the owner or employee dashboard, finding people by ID with the person accepting | Nothing |
| Nov 20 to 21 | Security fix list: sign-in message with site name and single-use code, rate limiting, security headers, dependency review, origin check, attendance consent | Nothing |
| Nov 22 to 26 | Themes, first version: the person picks themes, the app suggests a split, the person confirms the buys. No automatic rebalancing | Account flow done |
| Nov 27 to 30 | Test every page on the live site with a real browser wallet. Fix what breaks. Bring README and docs/PLAN.md up to date | Nothing |
| Dec 1 to 2 | Submission pack: README, 2 to 3 minute video script, X posts, form answers. Decide whether to do a small mainnet deployment (costs real money, founder must approve) | Everything above |
| Dec 3 to 5 | Record the video, post, submit. No new features | Nothing |

If time runs short, drop in this order: Themes first, then finding people by ID. Protect the path the judges asked for: deposit, borrow, repay, withdraw, with a stress scenario and the exact market named.

Later, after the competition: Aave adapter, confidential salaries, an automation service for paydays, selling and rebalancing, an independent security audit, mainnet.

## 6. Decisions still open

These are the founder's to make. Until they are answered, the working assumptions in docs/ANCHOR.md section 3 apply.

1. What "a business should be able to find" means exactly.
2. How much of Themes to build before the deadline.
3. Whether one wallet can be both an Individual and a Business account.
4. Whether an employee must accept being added to a team.
5. Whether Bitcoin and Ether are part of the core or a side feature.
6. Which wallet receives the fee, and which revenue streams to build (see "Revenue model" in README.md).
7. Whether to deploy anything to mainnet for the submission.

## 7. Setting up on your computer

You need Git, Node 20 or later, and Foundry 1.8.4 or later.

Get the code with its libraries:

    git clone --recurse-submodules https://github.com/Cloakie47/stackday.git
    cd stackday

Run the contract tests:

    forge test

Run the web app:

    cd web
    npm install
    npm run dev

Then open http://localhost:3000. It reads the testnet deployment without any settings.

To look at a wallet's data without connecting, add `?view=0x...` to an app page address.

Settings files, only if you need them. Both are ignored by git and must never be committed or pasted into a chat:

- `.env` in the project root (copy `.env.example`): a TEST-ONLY wallet key, needed only to deploy or to run the testnet scripts.
- `web/.env.local` (see `web/.env.example`): the database keys, needed only to work on names, team lists or attendance locally. Ask the founder for access through Vercel instead of passing keys around.

Things that will trip you up:

- The demo panel's price and pause switches only work for the wallet that deployed the mocks (the founder's test wallet). To use them yourself, deploy your own copy with `script/Deploy.s.sol`. That needs about 36 test USDC (4 for each of the 9 lending markets, or set MARKET_LIQUIDITY_USDC lower) from https://faucet.circle.com and a little test ETH.
- Testnet lending markets hold 2 test USDC each, so demo loans must be small.
- Scripts that touch Morpho need a gas margin (`--gas-estimate-multiplier 250`), or they run out of gas.
- After changing contracts or redeploying, run `forge build` and then `python web/scripts/gen-abis.py` so the site picks up the new addresses.
- The web app uses a new Next.js version. Read web/AGENTS.md before changing its structure.
- Asset tokens do not all have 8 decimals. Use each asset's own.

More commands are in README.md and CLAUDE.md.

## 8. Rules we do not break

Product:

- One vault per person, controlled only by that person. Never pool funds.
- No admin or owner function may move funds out of a vault.
- We do not build a lending pool. Loans come from an existing market.
- No forced repayment. Investing a share of salary is always optional.
- The fee is fixed at deployment. Never add a way to change it. Never charge salary paid out.

Safety:

- Never put a private key, seed phrase or database key in chat, in code or in git.
- Testnet only, unless the founder explicitly approves a mainnet step. Anything that costs real money needs a yes first.
- There has been no independent security audit. Say so wherever it matters.

Honesty:

- Anything mocked is labelled as mocked on the site and in the README.
- Do not claim something works unless it was run. Say what was not tested.
- The tokenized stocks are for eligible people outside the United States and carry no voting rights. The app gives information, not investment advice.

Writing:

- Plain language. No em dashes in anything that will be submitted.

## 9. How we work

The full team workflow (branches, pull requests, who does what, shared things, the feedback loop) and the revenue model are in README.md under "Working together", "Feedback loop" and "Revenue model". The short version:

- Never push straight to `main`. One task, one branch, one pull request, reviewed by the other person.
- Do not overwrite `deployments/base-sepolia.json` and do not publish the live site from a branch.

- Work in steps. Finish one, report what passes and what does not, then wait for the founder's go-ahead.
- Every feature must map to a sentence in the anchor. If it does not, flag it as an extension in docs/PLAN.md and ask.
- When something is built, changed or dropped, update the checklist in docs/PLAN.md and the status tables here.
- Commit and push finished work so the other contributor sees it.
