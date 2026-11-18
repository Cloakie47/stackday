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
| 3. Borrowing fee | The borrower | 0.1 percent a year on the loan, built up by the second and paid on repayment before the loan (borrow 1,000, receive 1,000, about 1 extra after a year). Shown inside one Borrow APY together with Morpho's interest. Never taken from the vault or collateral. Fixed at deployment | Built and live (issue #56) |
| 4. Lending income | Lenders | Stackday curates its own USDC vault on Morpho that lends against tokenized stocks, with a fee of 0.1 to 0.2 percent of the vault a year. Lenders can be anyone, including employers with idle treasury | Not built. A larger project with real risk management duties |
| 5. Fee on idle USDC earning | The saver | 0.1 percent a year of the amount earning, taken only out of the interest, never the deposit. If interest is lower, the fee is only the interest | Built, live after the next redeploy |
| 6. Themes plan | The individual | A monthly price for the Themes layer (suggestions by theme, rebalance proposals) | Not built, depends on Themes |

Rough sizes, to compare the streams. Take a business with 20 employees paid 3,000 USDC a month, each investing 15 percent:

- SIP fee: 9,000 USDC a month goes into assets, so the fee is about 13.5 USDC a month.
- Subscription at 4 USDC per employee: 80 USDC a month.
- Borrowing fee: if 6 of them keep 2,000 USDC borrowed for a year, 12 USDC a year.
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

Deployed November 18, 2026 (twelfth deployment: invest-only assets, issue #60, plus the yearly borrow fee, issue #56; 15 assets, 8 of them can be borrowed against). Machine-readable copy: deployments/base-sepolia.json. Earlier deployments are retired and kept in deployments/base-sepolia-v1-retired.json to deployments/base-sepolia-v11-retired.json.

Source code of every contract below is verified on Sourcify: https://repo.sourcify.dev/84532/ADDRESS

Stackday contracts (real, no owner):

| Contract | Address |
|---|---|
| Payroll | 0xe682485065f5afccB7606Fd4EFE1747658428798 |
| SipRouter | 0x6B86A2a0eb156db241d085C85861bBFec3F7c149 |
| VaultFactory | 0x40fC456Eb518c7F729459a65323bD2F347295CbC |
| EmployeeVault (code every vault uses) | 0x33Ae7b295461C2cA6Bc3239D84cdF9f72c7da7a0 |
| Price adapter | 0x3129A660A3d09c89694c374E8483F6Bf21045EB8 |
| Interest adapter (ERC-4626) | 0x507027301785dbF603f95eE50aB2f2c125883721 |
| Morpho lending adapter, mAAPL | 0xBBBe52E292Bb65F22D8C5cF9c97DF6e31Ea240c2 |
| Morpho lending adapter, mNVDA | 0x06f6c642346372da69C06aac1867964f325007F4 |
| Morpho lending adapter, mcbBTC | 0xDB2a30256988C74E322F13706E80630a841D9ee8 |
| Morpho lending adapter, mWETH | 0xa69CcC8F4Cb70BB5d7B4A695DE0443BaE6228fc0 |
| Morpho lending adapter, mGOOGL | 0xc7C0Ed4423D7904797fADfA3593312e499F22c6F |
| Morpho lending adapter, mMETA | 0xd3eaae7892a331FF62f45C4998020434749eebc4 |
| Morpho lending adapter, mSPCX | 0xc4C9D609c92f0507d54B1421636f77270F381AbB |
| Morpho lending adapter, mPAXG | 0xa557509BD37D18C676AccEF632AD8756AF98462c |
| Price oracle for Morpho, mAAPL | 0xFb31796A37C8bBF902C61b3c79f1Ef0350Ef7A99 |
| Price oracle for Morpho, mNVDA | 0x57da969759E0Bef659DEFdc86B840D5bff268005 |
| Price oracle for Morpho, mcbBTC | 0x6c8B2e8313671B42A0c097E6dd943d04e1Ad9F62 |
| Price oracle for Morpho, mWETH | 0x77D8E40b24451D120Ac1F59afa23f09B2A2fB61c |
| Price oracle for Morpho, mGOOGL | 0x3D13F6270AeB6F5F0D81494dD3f8d3429A12c963 |
| Price oracle for Morpho, mMETA | 0xa9CE4F34A2333B65ACAFFB1C4Ae6D903c9AF3004 |
| Price oracle for Morpho, mSPCX | 0x3CEb30Cd4BE398fc316d1F10eB0faab766eCb5AB |
| Price oracle for Morpho, mPAXG | 0x63086c854775BCbbFFd0A2c0E69B608dB81d7338 |

Existing protocols used as they are (real):

| What | Address |
|---|---|
| Morpho | 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb |
| Morpho interest rate model | 0x46415998764C29aB2a25CbeA6254146D50D22687 |
| USDC (Circle test USDC) | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |

The exact lending markets (Morpho, USDC loan, created by the Stackday deploy script, funded with 2 test USDC each). The liquidation limits match the main real markets on Base for each kind of asset:

| Market | Liquidation limit | Morpho market id |
|---|---|---|
| mAAPL / USDC | 62.5% | 0x65cae300a827b354ae291269cc6c966b834d1830e77a7d835995e9108c8f2e25 |
| mNVDA / USDC | 62.5% | 0xe87862fc19b063f9106f392c37873c36ce2080c14ee8230c8d95383ad6faaa51 |
| mcbBTC / USDC | 86.0% | 0x870358bafe82daa6e99e485826983e459bdf04d9c087faf1946405eb220b55ae |
| mWETH / USDC | 86.0% | 0xe7436c2d9deb5ead7f6a3c5a52cef8a8183509765942556a45cd5b11097f3421 |
| mGOOGL / USDC | 77.0% | 0x4e34df97e3ac7181b2cc6f031aee20814b95e1abfc7be4b817272976a6a3e144 |
| mMETA / USDC | 62.5% | 0x3e5fa7739279e1de1cbe6b0b9c60460b98a6f053bb1d3889efb8a9b6bb3a872d |
| mSPCX / USDC | 62.5% | 0xd7a801035c002a28b255cd7089611b5a68187a0ac45b9c9125cb13f3b89f27b3 |
| mPAXG / USDC | 77.0% | 0x411e8006c1db46f14db09d1099a26715e23a7e19c9e538101a13c11e8727b25b |

MOCKS (testnet stand-ins, owned by the demo wallet so stress scenarios can be triggered):

| Mock | Address |
|---|---|
| mAAPL mock token, stands in for AAPLc (Apple stock) | 0x729677D5dD5f5745c4450cD1017C75517231b94B |
| mAAPL mock price feed | 0x3f20aB2127902f84F38D273258d9faE22c202119 |
| mNVDA mock token, stands in for NVDAc (NVIDIA stock) | 0x5A2A0be7261c6915D1A6C3C7e55116A5B64CC9eA |
| mNVDA mock price feed | 0xF0860F4ed33Bb98c64c10459d3BFf92151D66eCb |
| mcbBTC mock token, stands in for cbBTC (Coinbase Wrapped BTC) | 0xCc34750BCA487838188C31922dAd1b06BFb6648E |
| mcbBTC mock price feed | 0x5196dFE25E8AC48a0fcf65787a582D3298387009 |
| mWETH mock token, stands in for WETH (Ether) | 0xcEF01590Fa59514A4c2d6d4Bdb3D5F2F3A960843 |
| mWETH mock price feed | 0xBe1e8B4EbCF7a92C0d311FFDd107e25A187137a5 |
| mGOOGL mock token, stands in for GOOGLc (Alphabet stock) | 0x70c72FA27FaAdaDAE0Aaf68960c6a2076dB4851C |
| mGOOGL mock price feed | 0x62D52EA311A2Bae47b164Db3cCe8E1D0ffe261eb |
| mMETA mock token, stands in for METAc (Meta stock) | 0x73689283bABcB529260a479Fb2f26F24E8eDED94 |
| mMETA mock price feed | 0x7E58F0eFB34e3E7187257707548d32345c41553E |
| mSPCX mock token, stands in for SPCXc (SpaceX tokenized share) | 0x9880747823D3c089185b56336f3B95FB12C2cf30 |
| mSPCX mock price feed | 0xb42685FB7D52d7D81B6C99C53F05ffC6cf0C11cb |
| mPAXG mock token, stands in for PAXG (PAX Gold, one troy ounce) | 0x94173e0252e8eCaeDF439a45Bc1538D9B5CA228D |
| mPAXG mock price feed | 0x970B5fFa47Bd7bb62979D0992ea9D9a542fd76EB |
| mTSLA mock token, stands in for TSLAc (Tesla stock), invest only | 0x010f0cD31949Ad7719ECE948ec360d2D5cAFd0fC |
| mTSLA mock price feed | 0xb92F47284C0Dc26D48E83D5DbF8dD88bbdBD9CD3 |
| mAMZN mock token, stands in for AMZNc (Amazon stock), invest only | 0x5D103061D746Fc9D5EED8F1ca22d4CFb3599C575 |
| mAMZN mock price feed | 0x1B7fb87ba06BeF3f3608C1714909fb3Df52ec358 |
| mMSFT mock token, stands in for MSFTc (Microsoft stock), invest only | 0xb91C419d320A69e4BC80Ccfc6e0aa5bd41820a11 |
| mMSFT mock price feed | 0xcE81c0aC5AAE5B89dd502884Fa5191428aD7e414 |
| mMSTR mock token, stands in for MSTRc (Strategy stock), invest only | 0x167560e9052131E9bbAc416d8B5F460FbF2B7bF1 |
| mMSTR mock price feed | 0x17a9d232444D711aE5844910B1C239433c230f05 |
| mAMD mock token, stands in for AMDc (AMD stock), invest only | 0x1294085CDd75fA5C0710C7De14b43720dC692410 |
| mAMD mock price feed | 0xe6cDEF1db0662939cC4769Dc84E9021652b301Fd |
| mSPX mock token, stands in for deSPXA (S&P 500 fund token), invest only | 0x9A055021F7B970474DE97f3FD73Eae010F95d950 |
| mSPX mock price feed | 0xD42C8abBFE1437f68439A954C4d7938C1E107E3C |
| mSGOV mock token, stands in for wtSGOV (0-3 month US Treasuries), invest only | 0x9F3111686A9ac285a03179706863DB82180262AC |
| mSGOV mock price feed | 0x10F755779450DBA4Ab9373aCa804565fF7448193 |
| Mock exchange | 0xb173ec9585d1a130fbB214E3AaA70d726F416b0E |
| Mock interest vault | 0x230C070bda9644A761302e7763e0F5437dA5f66d |

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
