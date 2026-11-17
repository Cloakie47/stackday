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

Status: streams 1, 3 and 5 are built (small fees, 0.2 percent at most, founder decision November 17, 2026). The rest is the plan. The figures are illustrations to show the size of each stream, not forecasts.

| Stream | Who pays | How it works | Status |
|---|---|---|---|
| 1. SIP fee | The person investing | 0.15 percent of the USDC that a recurring plan puts into assets (an every payday plan, or a recurring buy). One-time buys are free. Fixed in the contract, cannot be changed, never charged on salary paid out | Built (0.25 percent on the live testnet until the next redeploy) |
| 2. Business subscription | The employer | A monthly price per employee for running payroll through Stackday, billed off-chain or in USDC. Needs no contract change | Planned. Expected to be the main income |
| 3. Borrowing fee | The borrower | 0.1 percent once, taken from the borrowed USDC before it is sent out (borrow 1,000, receive 999, owe 1,000). Never taken from the vault or collateral. Fixed at deployment | Built, live after the next redeploy |
| 4. Lending income | Lenders | Stackday curates its own USDC vault on Morpho that lends against tokenized stocks, with a fee of 0.1 to 0.2 percent of the vault a year. Lenders can be anyone, including employers with idle treasury | Not built. A larger project with real risk management duties |
| 5. Fee on idle USDC earning | The saver | 0.1 percent a year of the amount earning, taken only out of the interest, never the deposit. If interest is lower, the fee is only the interest | Built, live after the next redeploy |
| 6. Themes plan | The individual | A monthly price for the Themes layer (suggestions by theme, rebalance proposals) | Not built, depends on Themes |

Rough sizes, to compare the streams. Take a business with 20 employees paid 3,000 USDC a month, each investing 15 percent:

- SIP fee: 9,000 USDC a month goes into assets, so the fee is about 13.5 USDC a month.
- Subscription at 4 USDC per employee: 80 USDC a month.
- Borrowing fee: if 6 of them borrow 2,000 USDC once, 12 USDC in total, one time.
- Lending income: for every 1,000,000 USDC in a Stackday vault at 0.15 percent a year, about 1,500 USDC a year.

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

Deployed November 17, 2026 (eighth deployment: small fees, issue #45; nine assets). Machine-readable copy: deployments/base-sepolia.json. Earlier deployments are retired and kept in deployments/base-sepolia-v1-retired.json to deployments/base-sepolia-v7-retired.json.

Source code of every contract below is verified on Sourcify: https://repo.sourcify.dev/84532/ADDRESS

Stackday contracts (real, no owner):

| Contract | Address |
|---|---|
| Payroll | 0x7DBe13Ab3654DCbD63b1E49aE3Be22832F92d0dE |
| SipRouter | 0xec658C0c70E3fE1D3A3EeF07137d26a4207D6ae5 |
| VaultFactory | 0x0C220161635cb49efC4691aB097a2bf48458E80B |
| EmployeeVault (code every vault uses) | 0x0C889F8c0648AA53873fD5E946BC7B06800E1224 |
| Price adapter | 0x2A4236aB5c830A940ff3A2Bc8Ab63F63590fC9C9 |
| Interest adapter (ERC-4626) | 0x0e29b9997615FEA3c48d300e9c276DF2346c69B4 |
| Morpho lending adapter, mAAPL | 0x29a9aF80A06c18291abc7949B67Ee6C7fc184439 |
| Morpho lending adapter, mNVDA | 0x57247a7d255D05392921184f12E3f47A4cB0d454 |
| Morpho lending adapter, mcbBTC | 0x58273D26084985e517501c014dBF255E51d1f9d3 |
| Morpho lending adapter, mWETH | 0x501Da625B63F269086D826aDD4d0c6c8F2308D57 |
| Morpho lending adapter, mTSLA | 0x81dfB822d7a96F87AB9d88dEA5bc1573384762b5 |
| Morpho lending adapter, mMSFT | 0xa41D1b657F3eB341B288d80b4Bbb4229D7B46079 |
| Morpho lending adapter, mAMZN | 0x4D3ed19025B36b9f454237A6Eb14350a0a109d93 |
| Morpho lending adapter, mGOOGL | 0xf454c498d385d01c772352a366174B39D3677c17 |
| Morpho lending adapter, mMETA | 0x16dd2506923f3e401523940197aF84932D082E24 |
| Price oracle for Morpho, mAAPL | 0x48d9eDe292c910Bffff6675DEB79340408F24FAC |
| Price oracle for Morpho, mNVDA | 0x952D8C890073Ba1169a8373BF40aF6D7974AF9D7 |
| Price oracle for Morpho, mcbBTC | 0x519CC0EC5C866EE30e1DAc7B4c78097E2e2DD8EC |
| Price oracle for Morpho, mWETH | 0x85e179409C8e31087DB73b2231153a259e4b8B3D |
| Price oracle for Morpho, mTSLA | 0x655E61173E70bC1F5dfBfd85c73932D3e9EAA500 |
| Price oracle for Morpho, mMSFT | 0xd45d77688Ef3df84772Ea6d22a538a82e8381B6e |
| Price oracle for Morpho, mAMZN | 0xbeE738E9880bCE619705bE11D9E8698A7bcE3Bf3 |
| Price oracle for Morpho, mGOOGL | 0x398a5012dF464B354679777e911AAe52B77B08D4 |
| Price oracle for Morpho, mMETA | 0xbd83208C6a175c09680cD4F5947F23fd12A2A5f9 |

Existing protocols used as they are (real):

| What | Address |
|---|---|
| Morpho | 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb |
| Morpho interest rate model | 0x46415998764C29aB2a25CbeA6254146D50D22687 |
| USDC (Circle test USDC) | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |

The exact lending markets (Morpho, USDC loan, created by the Stackday deploy script, funded with 2 test USDC each). The liquidation limits match the main real markets on Base for each kind of asset:

| Market | Liquidation limit | Morpho market id |
|---|---|---|
| mAAPL / USDC | 62.5% | 0x3df625165e6a4f9e908b0ebd7c6f8c49c91379fd8128666b6f3286ddd51ae841 |
| mNVDA / USDC | 62.5% | 0xd6c0d62c70f103801b4c82fb94e45ccd951a405e9796764a503ef190bb8c638c |
| mcbBTC / USDC | 86.0% | 0xd6d469d0fbdefce2d98c58d1b2dda8697d42685b71a94f405bed1c45494e892f |
| mWETH / USDC | 86.0% | 0x526d338a61fc5e2f39487ab7469f37eb9e7870c2b350133e4f3f9783e1f53446 |
| mTSLA / USDC | 62.5% | 0xf25d3faccc1b1e35cbe37cdf62f7fb820744760564a2e4f5b70c616c8b31e72d |
| mMSFT / USDC | 62.5% | 0x6e77bbf5c75305baa581e1b466f7c4863fca40701f0a75cdb9a3d1556be6cf10 |
| mAMZN / USDC | 62.5% | 0xf28d5076e5587e014d5e25e07f7d750910bcb61b5fd44838a717de79b865d3fb |
| mGOOGL / USDC | 62.5% | 0xe09efd2efb12f4d891e80a6c6c8600c92c5ec3bcd30f7ddecb94263ec09cf224 |
| mMETA / USDC | 62.5% | 0xeb9a48e4d0225a86fe24c6737b741e03b98e0fc556b22a1a4bc2fff1e49e242d |

MOCKS (testnet stand-ins, owned by the demo wallet so stress scenarios can be triggered):

| Mock | Address |
|---|---|
| mAAPL mock token, stands in for AAPLc (Apple stock) | 0x138793F90C912254FE19ebAd7f292F041c463Dc7 |
| mAAPL mock price feed | 0x1fD6bAD068c4036Dea132ed6956a54244a457Ff3 |
| mNVDA mock token, stands in for NVDAc (NVIDIA stock) | 0xF482D2871f96712E905eAFD092FBE0ff058A5888 |
| mNVDA mock price feed | 0x84F4977FEAb0dFFf0C65330b974421c858bce0d3 |
| mcbBTC mock token, stands in for cbBTC (Coinbase Wrapped BTC) | 0x289520DdDFae93cAC7C2B4cA1C45825D49Ac9702 |
| mcbBTC mock price feed | 0x9f43fD33ef0ED0f8d0a1842f10bB3c9850a2E296 |
| mWETH mock token, stands in for WETH (Ether) | 0xA56350Fcaf26652D85578915F8Bd3D8050aF7e9E |
| mWETH mock price feed | 0x989ED973b4Afc431787D326A40292e6993912420 |
| mTSLA mock token, stands in for TSLAc (Tesla stock) | 0x8ddcD43e208A8b10249474a2C0491Ad4E244E85D |
| mTSLA mock price feed | 0xA4b3eAC8756f427B59e9b0059dF49B5eBc9e3957 |
| mMSFT mock token, stands in for MSFTc (Microsoft stock) | 0x07AF61c09fE2A5ab19f33Cd50A9cbb9C14014313 |
| mMSFT mock price feed | 0x16EB0d00336Fd5594a11001CB43e5620003E50Ee |
| mAMZN mock token, stands in for AMZNc (Amazon stock) | 0x84089a910CB4Cdf47A407e4Fc8Dc55fFB9420AB1 |
| mAMZN mock price feed | 0x32b3EB63Dd311B08F110e0454cf165D5bF031441 |
| mGOOGL mock token, stands in for GOOGLc (Alphabet stock) | 0x51Bfe08509333cA101cAf35297d163C9A9b563bD |
| mGOOGL mock price feed | 0xDEE9569F8c4C1e20Bdc1BA669079cDdE9f00850E |
| mMETA mock token, stands in for METAc (Meta stock) | 0x1644A3d8A91b85C251bE657BdD2263A9db3BBBB9 |
| mMETA mock price feed | 0x6Ab4f1CDb7C9C1BA1F85b0Aa85189cd24aD36CF6 |
| Mock exchange | 0x1BED1102f816996ac14Fd32d1Fe4985a0BB2CEb6 |
| Mock interest vault | 0xC4dc4Ee8355557ab73434780249bc175520ff9A9 |

SIP fee: 0.25 percent, fixed (0.15 percent plus the 0.1 percent borrow and earn fees from the next redeploy). Fee wallet on testnet: the demo wallet 0xC0F2c3CDd7D11FC9eC388ff2B2F57d81A38190df. Shortest payroll rhythm on testnet: 60 seconds (so a schedule can be shown in a demo). On mainnet it would be 1 day.

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
