# Stackday

Stackday, salary maxxing on Base.

A payroll and investing app on Base. Teams paid in USDC can send a share of every payday into tokenized stocks, cbBTC or Ether, and anyone can invest on a schedule from their own wallet, then borrow against what they hold instead of selling. Built for the Base Stocks Maxxing competition, Track 3. Next step: confidential salary payments (a testnet preview with Fairblock is in progress).

Live site: https://stackday-rho.vercel.app (Base Sepolia testnet demo)

New here? Read docs/START-HERE.md first.

Status: contracts are deployed on Base Sepolia (testnet) and the web app is live. Nothing is on Base mainnet and there has been no independent security audit. See docs/ANCHOR.md for what we are building and the status of each part, and docs/PLAN.md for the history.

## What it does

- Employers fund a USDC treasury and pay their team once, or on a schedule (daily, weekly, every 2 weeks, monthly) that keeps running while the treasury is funded.
- Employees claim each salary to any wallet. Before claiming they choose a share (the site suggests 10 or 20 percent) and what it buys: tokenized stocks, Bitcoin or Ether tokens. Once, or as a standing plan for every payday.
- What they buy lands in a vault only they control. One vault per person, no admin, no pooled money.
- Idle USDC in the vault can earn interest.
- They can borrow USDC against what they hold through an existing Morpho market instead of selling. New buys stay free in the vault until the person locks them; locking each payday's buy makes the loan safer over time. Only the opt-in emergency rule locks a payday share automatically.
- People without an employer can use the same vault, with one-time or recurring buys from their own wallet.
- A dashboard shows holdings, plans and loans. A risk screen shows cost, limits, liquidation price and a stress test.
- Optional account database (Supabase): a unique name per wallet, saved team lists, and a daily attendance check-in.

## Revenue model

Status: only the first line is built. The rest is the plan, to be confirmed by the founder. The figures are illustrations to show the size of each stream, not forecasts.

| Stream | Who pays | How it works | Status |
|---|---|---|---|
| 1. SIP fee | The person investing | 0.25 percent of the USDC that goes into assets, on payday investing and on direct buys. Fixed in the contract, cannot be changed, never charged on salary paid out | Built and live |
| 2. Business subscription | The employer | A monthly price per employee for running payroll through Stackday, billed off-chain or in USDC. Needs no contract change | Planned. Expected to be the main income |
| 3. Borrowing fee | The borrower | A small one-time fee when a loan is opened (for example 0.25 percent of the amount borrowed), taken from the borrowed USDC before it is sent out. Never taken from the vault. Fixed at deployment like the SIP fee | Not built. Needs a contract change and a redeploy |
| 4. Lending income | Lenders, through a share of interest | Stackday curates its own USDC vault on Morpho that lends against tokenized stocks, and keeps a share of the interest it earns (for example 10 percent). Lenders can be anyone, including employers with idle treasury | Not built. A larger project with real risk management duties |
| 5. Interest share on idle USDC | The saver | A share of the interest that vault USDC earns. Comes for free if stream 4 exists, because idle USDC would go into Stackday's own vault | Not built |
| 6. Themes plan | The individual | A monthly price for the Themes layer (suggestions by theme, rebalance proposals) | Not built, depends on Themes |

Rough sizes, to compare the streams. Take a business with 20 employees paid 3,000 USDC a month, each investing 15 percent:

- SIP fee: 9,000 USDC a month goes into assets, so the fee is about 22 USDC a month.
- Subscription at 4 USDC per employee: 80 USDC a month.
- Borrowing fee: if 6 of them borrow 2,000 USDC once, about 30 USDC in total, one time.
- Lending income: for every 1,000,000 USDC lent at 6 percent interest, a 10 percent share is about 6,000 USDC a year.

What this shows: the SIP fee alone is small. Subscriptions pay for the payroll side, and lending income is what grows with the money on the platform.

Recommended order: keep 1, add 2 next (no contract work), then 3 if we want income from borrowing before the deadline, and treat 4 and 5 as the long-term engine after the competition.

Rules for any fee: fixed when the contract is deployed, visible on the site before the person confirms, never taken out of a vault, and never a way for anyone to change it later. Earning from lending and borrowing also makes Stackday look more like a lending business to regulators, which is the team's responsibility to check.

## Run the tests (PowerShell)

Local tests (real Morpho code, mock asset tokens, mock price feeds, mock exchange), 69 tests:

    forge test

Base mainnet fork tests (real AAPLc, real Morpho market, real Aerodrome pool, real Morpho interest vault, costs nothing):

    $env:FOUNDRY_PROFILE="fork"; forge test; Remove-Item Env:FOUNDRY_PROFILE

Needs Foundry 1.8.4 or later.

Web app unit tests (Node's own test runner, no extra packages, needs Node 22.18 or later):

    cd web; npm test

Test files sit next to the code they test, named `*.test.ts`, and import it with the `.ts` ending (for example `import { fmtUsdc } from "./format.ts"`).

## What is mocked

Everything in src/mocks is a mock for testnet and tests only: the asset tokens (stocks, BTC, ETH), their price feeds, the exchange, the interest venue and USDC (local tests only). The mocks have an owner so stress scenarios can be triggered. Payroll, SipRouter, VaultFactory, EmployeeVault and the adapters have no owner. The mock tokens pay no dividends.

Price charts (Invest page and Holdings) show REAL market prices of the real assets (for example Apple on Nasdaq, BTC/USD on Coinbase), drawn by TradingView's free widgets. They are for reference only: buys, loans and health on testnet use the mock price feeds above, and the page says so next to every chart.

## Live on Base Sepolia (testnet)

Deployed November 16, 2026 (fifth deployment: new buys are never locked automatically, issue #29; nine assets). Machine-readable copy: deployments/base-sepolia.json. Earlier deployments are retired and kept in deployments/base-sepolia-v1-retired.json to deployments/base-sepolia-v4-retired.json.

Source code of every contract below is verified on Sourcify: https://repo.sourcify.dev/84532/ADDRESS

Stackday contracts (real, no owner):

| Contract | Address |
|---|---|
| Payroll | 0xcb8FeDC00b5a55A4339CcEC1e21a08e206fbaf45 |
| SipRouter | 0x293d313caAd39A0bC7C08082c2Ca4da732BB9e7D |
| VaultFactory | 0x461b1256f5F27BBB87253939b1d820A65FB31032 |
| EmployeeVault (code every vault uses) | 0x37eee5A28157C2B69875BB4549F01ddAFF430aBc |
| Price adapter | 0x405F9f22DEE77e7Ce7f2386331694cC18e7146DF |
| Interest adapter (ERC-4626) | 0xE7b5E3552FC9415016dA6a24eF34F32B4E817598 |
| Morpho lending adapter, mAAPL | 0xA0e01f9049600e559E8872720Ba03d268C333557 |
| Morpho lending adapter, mNVDA | 0x103433eF7bE9c4cB5AE83BE3638F157b8C0732ce |
| Morpho lending adapter, mcbBTC | 0xab335A59AC35F35428524B3A85691dFDF1f53c0B |
| Morpho lending adapter, mWETH | 0x6A483Aa93f403E237c6441B5417F9d485B4B9B8B |
| Morpho lending adapter, mTSLA | 0x2044f9CeB3fa51d9a6E927cFE691842c0fd22438 |
| Morpho lending adapter, mMSFT | 0xfAF21A9f839a86d6BDDe75D379A8643bdB1fF7f7 |
| Morpho lending adapter, mAMZN | 0xd02BC9975d110ee0d3B16B558865Ad4Ed59b86AC |
| Morpho lending adapter, mGOOGL | 0xEF410172ca43b9f9ba7A951F2e5f6269b3Ec6c1D |
| Morpho lending adapter, mMETA | 0x21aBbd20427B07251Cde681b834D3795B7E46CC1 |
| Price oracle for Morpho, mAAPL | 0xc0Afc8B4c29E76b546FF81649f7A5E1583eA67f6 |
| Price oracle for Morpho, mNVDA | 0x5a02B175cB584AC5c41a0c755EdfaCe13537c95F |
| Price oracle for Morpho, mcbBTC | 0xf161e1bb9B5e975ffF05A1de246665326f9FdbA8 |
| Price oracle for Morpho, mWETH | 0x89d2Ca98713Bd78108fa4419a6E76734213b1c96 |
| Price oracle for Morpho, mTSLA | 0xb9a108fAcDDF7ECE3B2934721BE5498fAE2b2FbE |
| Price oracle for Morpho, mMSFT | 0x9C8C9d1E7658dB180eb1FCBbC1eCCE45962dD5fC |
| Price oracle for Morpho, mAMZN | 0xf88a69A2F2963A6E965b03713d1d00CBe9a15969 |
| Price oracle for Morpho, mGOOGL | 0x0D12295C4B54784f9bB3df1cB01d34444Da1A2bb |
| Price oracle for Morpho, mMETA | 0x0c0213A06568edB841C8F84200943f6fBDb25a52 |

Existing protocols used as they are (real):

| What | Address |
|---|---|
| Morpho | 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb |
| Morpho interest rate model | 0x46415998764C29aB2a25CbeA6254146D50D22687 |
| USDC (Circle test USDC) | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |

The exact lending markets (Morpho, USDC loan, created by the Stackday deploy script, funded with 2 test USDC each). The liquidation limits match the main real markets on Base for each kind of asset:

| Market | Liquidation limit | Morpho market id |
|---|---|---|
| mAAPL / USDC | 62.5% | 0xce2ecf7768a0262c908d5f7107af516787ab5e5ea38dfae74d13333892482a84 |
| mNVDA / USDC | 62.5% | 0xd4e15cdf6dda62409e74734b9701248ffbfb2260bc6e69e2d1e99e0e9cdbf3d9 |
| mcbBTC / USDC | 86.0% | 0x61ed589165a2c2f4e5bf91ba8375ab58a92aff07624b935a1a8cdb9119a5881d |
| mWETH / USDC | 86.0% | 0x8b24e277c194d9bb615bfcb0236e1d2363e93fc50ae8fdad990be83750494ed1 |
| mTSLA / USDC | 62.5% | 0x56c5e380636a413dcc40220ad3e5cfff2fdfb5c625bbd72cc7d7f3d46d93231b |
| mMSFT / USDC | 62.5% | 0xa80ad7da41189a496f512b5fe26daf0cc39fa5bf409d572b1e688b8f58b8dcf1 |
| mAMZN / USDC | 62.5% | 0x94605b37cda0d116c85f7028908d8796deb748f6fded7931f0b2b810513c171f |
| mGOOGL / USDC | 62.5% | 0x9b6475b245b46f388f5f42ded44123c8042fae66932faaf12fbf38e3287c4755 |
| mMETA / USDC | 62.5% | 0x2703e4bd480c19be5f0aec0ea64d15942535f9f0534ca02aabd2a2bd078ae35a |

MOCKS (testnet stand-ins, owned by the demo wallet so stress scenarios can be triggered):

| Mock | Address |
|---|---|
| mAAPL mock token, stands in for AAPLc (Apple stock) | 0xE2Ad1A00128BA54bdc7406636885105e670dE405 |
| mAAPL mock price feed | 0x44d6d9d660524F6ad714419DEe654B548D8e0ea4 |
| mNVDA mock token, stands in for NVDAc (NVIDIA stock) | 0x917f7863bbD6eA8c8C50b2d1B823AeAde64bd2c9 |
| mNVDA mock price feed | 0xf8F7F9624Ad2490E01BF98a56720A750c0bE7763 |
| mcbBTC mock token, stands in for cbBTC (Coinbase Wrapped BTC) | 0x07263C4d2242aEF4AEAA9CC75716476cB525F2dd |
| mcbBTC mock price feed | 0x76126DB4707f72a1Dce73d8C8961eAF914405ffe |
| mWETH mock token, stands in for WETH (Ether) | 0x9d2BF32A4399e742825b17410f3db2950F257312 |
| mWETH mock price feed | 0xe8576E220cED4A4c867a66A9a43897ffe8Fff486 |
| mTSLA mock token, stands in for TSLAc (Tesla stock) | 0xAD957df263673CE9eb56C172aD5a81c2eD10d63D |
| mTSLA mock price feed | 0x134fE5494943d4c170Cfe84f57977Eeb7746F83F |
| mMSFT mock token, stands in for MSFTc (Microsoft stock) | 0x1Db573cf1535C41c4100c31d769a2612fb0e0Dd8 |
| mMSFT mock price feed | 0xc0B7A258b9d3DF67E0faa683431157cb94921778 |
| mAMZN mock token, stands in for AMZNc (Amazon stock) | 0x1727119e2B92E8c96b06d9ad5f840818997dB80d |
| mAMZN mock price feed | 0xdB8fd2b8a1F137840729223Ebce82b8031580702 |
| mGOOGL mock token, stands in for GOOGLc (Alphabet stock) | 0xA09aA0A087Bb7485281e8E3E9DE5Cb23a3083014 |
| mGOOGL mock price feed | 0x5801FE3dAcbBF2946a083e78ac1365d4806b2700 |
| mMETA mock token, stands in for METAc (Meta stock) | 0xB67B5681FA42a5856f40A712E39330447cBfCAAA |
| mMETA mock price feed | 0xAe13536E424A5433adA6475717FC71030d9fDE7f |
| Mock exchange | 0x1a30eDBF09089f0b04a85DbC0E0903662fa71c37 |
| Mock interest vault | 0x27a03df3D7bC5410A4C4A240a84c34EB10b2CA9d |

SIP fee: 0.25 percent, fixed. Fee wallet on testnet: the demo wallet 0xC0F2c3CDd7D11FC9eC388ff2B2F57d81A38190df. Shortest payroll rhythm on testnet: 60 seconds (so a schedule can be shown in a demo). On mainnet it would be 1 day.

### The judges' sequence on testnet (November 14, 2026)

Run on the previous (third) deployment, addresses in deployments/base-sepolia-v3-retired.json. The contracts were redeployed on November 16 (more assets, then manual locking), and the end to end script (payday, claim into mAAPL, borrow from Morpho, repay, withdraw) passed again on the new deployment.

Deposit, borrow, repay, withdraw, with a stress scenario, in the mAAPL / USDC market on Morpho. One test wallet played employer, employee and demo operator. Raw output: deployments/judge-sequence.txt.

| Step | Transaction |
|---|---|
| 0. Employee sets emergency rule (health <= 1.5 -> 50% of salary) | https://sepolia.basescan.org/tx/0x3ed88dce81554f7b49fcf12aa6d5e4462805457b6a0dc532c651ea1ecf8df82d |
| 1a. Employer approves USDC | https://sepolia.basescan.org/tx/0x40170f5032c6a6c7309f1d338fe754186e569005e59cdfb8e4486246049a81bd |
| 1b. Employer runs payroll (5 USDC salary) | https://sepolia.basescan.org/tx/0x2bc49b6158be97588680b88c19b45ac9ec7c47c1902faa66ab8a3440ecaec43a |
| 2. DEPOSIT: employee claims, 40% SIP buys mAAPL into the vault | https://sepolia.basescan.org/tx/0xccf036fcbed94c6331c2f52c1b5f3db4a626d563d8957eeaa59775c6b7a0cfba |
|  | Result: vault 0x04e2a64Ce433d7242c13BBd392EBE96E55a6b7b0 holds 558823 mAAPL (8 decimals) |
| 3. BORROW: vault posts the stock and borrows 0.60 USDC from Morpho | https://sepolia.basescan.org/tx/0xc73e7de9aefa784ab635e26bc290bcadca27963672354edd79134d006a4fedc7 |
|  | Result: loan health 2078121666666666666 (1e18 = liquidation line) |
| 4a. STRESS: overnight gap, mock price drops 30% (357 -> 249.90) | https://sepolia.basescan.org/tx/0xe75f7636f95a3fcf8f839330e584a68ea1b82666080531b16f7fd2e96ecb1936 |
|  | Result: loan health after the gap 1454685000000000000, emergency rule active: true |
| 4b. Employer runs the next payroll (4 USDC) | https://sepolia.basescan.org/tx/0x701e31ab58815e6068ad504386ae0a24558d09f3b05f87c5ec31eba895a7710a |
| 4c. EMERGENCY RULE: payday while the loan is risky, 50% of salary buys stock for collateral | https://sepolia.basescan.org/tx/0x4c69be3ddfb9bc8e9a4ea39d0dbab46a80b8a678582f8ec96fb7b7a35d2fdda6 |
|  | Result: collateral went from 558823 to 1357142, loan health now 3532808333333333333 |
| 4d. STRESS: transfers of the mock stock are paused | https://sepolia.basescan.org/tx/0x5602000a8833f7bebe2024c184020b9bc50f4e52d59ccb07662fbc4ad0af9762 |
| 4e. Approve USDC for repaying | https://sepolia.basescan.org/tx/0x63c0a725f22e5db32c5e1541ba2d76fa5dc07c5d1ac0b3e6e7ed6941cd44b8de |
| 4f. REPAY during the pause still works (0.20 USDC) | https://sepolia.basescan.org/tx/0x4f9298b0eb3ea5a608c4317dda39df6f0c4e27173d6c38f413514e7605de7935 |
|  | Result: checked: taking collateral out during the pause is refused |
| 4g. Transfers resume | https://sepolia.basescan.org/tx/0x3686781887d7fbe78d1aa3e2693665789407cc714692f313b5954257776b0454 |
| 4h. Price recovers to 357 | https://sepolia.basescan.org/tx/0x9763837de2d61477ad547526f396ceeea8bd2e0ca8538948ede0aa798901648e |
| 5. REPAY: the whole loan | https://sepolia.basescan.org/tx/0x782db8aa87d0afae19de2081f9d5a7b6f1a2710efbdf7dc5abfcc0165c895b66 |
| 5b. Remove the USDC allowance | https://sepolia.basescan.org/tx/0x95c5e699cae3a5797a7643bf2b62dc7d4ba26a828ee4084e055df7b3de50d6a6 |
| 6. WITHDRAW: all stock back to the wallet | https://sepolia.basescan.org/tx/0xd1f0fcdc68bbdd7d00c88703e4169ed3a3ad684385cdcde9a5db4a46dae4fb8f |
|  | Result: final: debt 0, collateral 0, wallet mAAPL 1357142 |

Numbers in the results use raw units: the stock token has 8 decimals, and loan health is scaled so that 1000000000000000000 is the liquidation line.

### Recurring payroll on testnet (November 14, 2026)

The employer funds the treasury once, starts a schedule, and two paydays are released a minute apart. Raw output: deployments/schedule-demo.txt.

| Step | Transaction |
|---|---|
| S1. Employer approves USDC | https://sepolia.basescan.org/tx/0x06d603db337df23fa0e9ce78d34fb2a020ef69a6b73c5c5b44b387a92322b107 |
| S2. Employer funds the treasury with 3 USDC | https://sepolia.basescan.org/tx/0x1f7ea014b3a868d0b8b45a2f31d5a7c55001f7af4ee2391df3780a120bd9623d |
| S3. Employer starts a recurring payroll (1 USDC, every minute on testnet) | https://sepolia.basescan.org/tx/0x9632d14291ce36b17f84d968cdd2c00bf39bc1288e3bf2ece257c6baecc82786 |
| S4. First payday released from the treasury | https://sepolia.basescan.org/tx/0x8e621029c5706f5a92fa72e19841f37dd1517d6f5bafa1b8fcc1638500c70ee6 |
| S5. Second payday released a minute later | https://sepolia.basescan.org/tx/0x4f614c1e9fc40a8b68a7df37e0982ef96162d3e6daafee601694d1ca2f39506b |
| S6. Employer pauses the schedule | https://sepolia.basescan.org/tx/0x12c9bbe6b105af89d338fe11aa0d44207796d9741201f28726b3365ed8a490dc |
| S7. Employer withdraws the unused treasury | https://sepolia.basescan.org/tx/0x17a14a9b8d08edd8b641e4c3e3e5e769c18286c69375988ee9be0b136c3d7da2 |
|  | Result: claimable for the employee: 2000000 [2e6] |

### Deploy and run commands (PowerShell)

    forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --slow --gas-estimate-multiplier 150
    & "C:\Program Files\Git\bin\bash.exe" script/judge-sequence.sh

Both read the test wallet key from .env, which is never committed. Both refuse to run on any network other than Base Sepolia.

## Frontend

The web app lives in the `web` folder (Next.js, TypeScript, wagmi, viem, Tailwind).

Pages:

- Home: what Stackday is, what is real and what is mocked, the risk note.
- Home: net worth in your vault, holdings, your plans (recurring salary, payday plan, recurring buys, emergency rule), loans, your name and attendance check-in.
- My pay: release a due payday, claim to any address, choose a share (0, 10, 20 percent or custom) and split it across assets, once or every payday.
- Invest: buy once or on a schedule without an employer, one plan per asset. Earn interest on idle USDC.
- Borrow: borrow, repay, withdraw, and the emergency rule.
- Risk: borrowing cost, borrow limit, loan health, liquidation price, repayment options, a stress test for 10, 20 and 30 percent gaps (plus your own), what paused collateral transfers do, price freshness, and the exact Morpho market used.
- Payroll: treasury, team list, pay once or start a schedule, pause and resume, attendance, past paydays.
- Demo panel (testnet only): price drop, market closed and reopened lower, paused transfers, price recovery, quick payday. Only the demo wallet that owns the mocks can use the market switches.

Run it on your computer (PowerShell):

    cd web
    npm install
    npm run dev

Then open http://localhost:3000. To look at any address without connecting a wallet, add `?view=0x...` to an app page address, for example http://localhost:3000/dashboard?view=0xC0F2c3CDd7D11FC9eC388ff2B2F57d81A38190df

After redeploying contracts, refresh the app's addresses and contract interfaces with:

    forge build
    python web/scripts/gen-abis.py

Publish a new version of the site (from the web folder, after signing in once with `vercel login`):

    & "C:\Users\Cloakie\.npm-global\vercel.cmd" --prod --yes

## Account database (Supabase), optional

Status: connected on the live site since November 14, 2026 (created through Vercel's Supabase integration, which supplies the keys automatically). Checked with web/scripts/test-account-api.sh: 21 of 21 checks pass.

Names, saved team lists and attendance are stored in a Supabase database. Money never depends on it: salaries, vaults and loans live on-chain. Without the database the site still works and those three features switch themselves off.

To connect it:

1. Create a free project at https://supabase.com.
2. In the project, open the SQL editor, paste the contents of supabase/schema.sql and run it.
3. In Project Settings, API, copy the Project URL and the service_role secret key.
4. In Vercel, open the stackday project, Settings, Environment Variables, and add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_SECRET` (any long random text). Then publish again.
5. For local development put the same three lines in web/.env.local (see web/.env.example).

The service_role key is a secret. Never commit it and never paste it into a chat.

How it is protected: every table has row level security on with no public policies, so browsers cannot read or write the database directly. The site's server does, and only after checking a signature from the wallet (a free signature, not a transaction). An employer can only see and change their own team list. Attendance is a record for the employer to look at and does not change anyone's pay.

## Working together

Two people build Stackday, each with their own AI coding assistant: the founder (Cloakie47) and a contributor (growthmindsetgg). GitHub is the single source of truth. Whatever is on the `main` branch is the real product.

### The loop

1. Pick one task. Tasks live in GitHub Issues. Assign it to yourself so the other person does not start the same thing.
2. Get the latest code: `git pull` on `main`.
3. Make a branch named after you and the task, for example `gg/sign-in-nonce` or `cloakie/landing-copy`.
4. Build it. Run the checks: `forge test` for contracts, and `npm run build` inside `web` for the site.
5. Push the branch and open a pull request. Say what changed, what was tested and what was not.
6. The automatic checks run on the pull request. The other person reads it and approves.
7. Merge into `main`. Delete the branch.
8. The founder publishes the site from `main`.

Never push straight to `main`. Small pull requests, merged often, are better than one large one: two assistants editing the same files for days will collide.

### Who does what

| Area | Lead |
|---|---|
| Product decisions, the anchor, what is in or out | Founder |
| Publishing the live site, the testnet deployment, the database | Founder (they hold the accounts and keys) |
| Design feedback, wording, the submission video and posts | Founder |
| Building features, contracts, research, security fixes | Contributor, with the founder building alongside on separate tasks |
| Reviewing each other's pull requests | Both |

Split work by area so two people are not in the same files: for example one on `src/` and `test/`, the other on `web/`.

### Shared things and how not to break them

- The live site: only published from `main`, by the founder. Do not publish from a branch.
- The testnet deployment: `deployments/base-sepolia.json` is the official one that the live site uses. Do not overwrite it. To deploy your own copy for testing, write to a different file: set `DEPLOYMENTS_FILE=deployments/local-yourname.json` before running the deploy script.
- The demo panel: its price and pause switches only work for the wallet that deployed the mocks. A contributor who needs them deploys their own copy as above.
- The database: there is one live database. Most work does not need it. For database work, create your own free Supabase project, run `supabase/schema.sql` in it, and put its keys in your own `web/.env.local`.
- Secrets: every person uses their own test wallet and their own keys. Keys are never shared in chat, in issues, in pull requests or in git.
- Contract changes mean a new deployment, new addresses and a site update. Agree on them in an issue first, and do them one at a time.

### The docs each assistant should read first

`docs/START-HERE.md`, then `CLAUDE.md` (the rules), then `docs/ANCHOR.md` (what we are building and what is left) and `docs/SECURITY-CHECKLIST.md`.

## Feedback loop

The plan is to get a working product in front of team members as early as possible, collect what they say, and keep upgrading it.

1. Ship early. Anything merged to `main` and working goes onto the live site, even if it is rough.
2. Ask team members to try it. They need a browser wallet on Base Sepolia with test USDC from https://faucet.circle.com. People who only want to look can open any page with `?view=` and a wallet address.
3. Collect feedback in one place: a GitHub Issue with the label `feedback`, one issue per point, in the person's own words, with the page and what they expected.
4. Triage twice a week. Each item becomes one of: fix now, later, or not doing (with the reason).
5. Fix, publish, and tell the person who reported it.
6. Keep a short list of what changed, so testers know what to look at again.

What we ask testers: could you do the thing without help, did anything confuse or worry you, did the risk screen make the risk clear, and would you actually send part of your salary this way.

## Security review (self-review, November 14, 2026)

This is a review by the builder, not an independent audit.

Fixed:

- Recurring buys in SipRouter can be triggered by anyone and rely on the oracle price for protection. When stock markets are closed that price is frozen. Added a maximum price age (`maxPriceAge`) so a recurring buy refuses a stale price. It is switched off on testnet (the mock feed only moves when the demo operator changes it) and must be set to about 26 hours on mainnet.
- The web app adds a gas margin on every transaction, because Morpho interest accrual makes real gas use higher than the estimate (this caused one failed testnet transaction on November 13).
- The web app no longer tries to post free assets as collateral when borrowing during a transfer pause.

Checked and found sound (each has a test): only the vault owner can move value out, the vault cannot be re-initialised or hijacked, creating someone else's vault first is harmless, the lending and interest adapters only act on the caller's own position and hold nothing between calls, employer treasuries are separate (a schedule can only spend its own employer's treasury), over-repaying only takes the debt, a failed purchase never blocks a salary (with several assets, only the failed part is paid in cash), the fee is fixed and capped and its wallet has no powers, a paused schedule pays nothing and resuming gives no back pay for the paused time.

Not fixed, known limitations:

- No independent audit. Do not use with real money.
- A stranger can send tiny "paydays" to an address. They cannot take or block anything, but they add entries to that address's payday list. The app looks at the latest 60 entries, so heavy spam could hide an older unclaimed salary from the screen (it stays claimable).
- A recurring payroll does not pay itself. Someone has to press the button when a payday is due: the employer, the employee, or an automation service. Until someone does, the payday waits. No automation service is set up.
- If the treasury is short, a due payday waits. Employees are not guaranteed future paydays: nothing is locked in advance.
- The emergency rule only acts when a salary is claimed. It is not automatic protection between paydays.
- The mainnet exchange adapter buys from a single Aerodrome pool and has only been tested with a stock token. BTC and ETH on mainnet would need their own pools configured.
- The real stock tokens have an issuer who can pause, block or seize tokens. No contract can protect against that. During a pause a loan cannot be topped up, only repaid.
- A vault has one owner key and no recovery. Losing the key loses access to the vault.
- Morpho, the interest venue, USDC and the price feeds are outside code that Stackday depends on.
- The 180-day take-back lets an employer recover a salary that was never claimed.
- The account database is a normal web service. Names, team lists (including salaries the employer typed in) and attendance stored there are only as private as that database and its keys.
- On testnet the demo wallet owns the mocks, so it can change prices, pause the mock tokens and mint them. That is deliberate and is not part of the real contracts.
