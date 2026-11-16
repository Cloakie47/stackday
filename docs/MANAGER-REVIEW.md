# Manager review, November 16, 2026

Reviewer: manager (review only, no code changed). Sources: CLAUDE.md, docs/ANCHOR.md, README.md, docs/START-HERE.md, the contracts in src/, the web code in web/, and the live site https://stackday-rho.vercel.app read page by page (read-only view of the demo wallet 0xC0F2...8190df). On-chain checks were read-only calls to Base Sepolia.

## Verdict

The core of the anchor is built and works: payroll with a treasury and schedules, claim to any wallet, a share of pay into nine assets, one ownerless vault per person, investing without an employer, idle USDC interest, and borrowing on real Morpho markets with a risk screen. Wording is honest in most places, no em dashes were found in the web code, README or docs, and jargon is mostly translated. Three things would hurt a judge today: the landing page's "View a demo vault" opens an empty vault ($0.00 everywhere), every Morpho market on testnet holds only 2 USDC to lend (so the "borrow" step fails for anyone who tries more than about $2 per asset, and the pool runs dry after one or two visitors), and the Borrow page offers two full sets of borrow and repay controls with two different "Health" and two different "You can borrow" figures. Behind those come a list of naming inconsistencies (the same page is called Home, Holdings and Dashboard; the same thing is "locked" and "posted"), a missing mock label on Invest, a Pay page that lets a user pick more assets than the contract accepts, and an ANCHOR.md status table that is out of date in two rows. Themes and Aave are not built, and confidential salaries are not mentioned anywhere public. Fix the Must list below before the walkthrough video is recorded.

## Anchor table

| # | Anchor sentence or part | Status | Evidence | ANCHOR.md accurate? |
|---|---|---|---|---|
| 1 | "Stackday is a payroll and investing app on Base." | Built | Live site, Base Sepolia. But README line 5 and /docs "What Stackday is" still say "A payroll platform / A payroll app", which drops the investing half | Yes |
| 2 | "After connecting a wallet on the landing page, each person chooses an Individual or a Business account" | Built | /start: connect, sign, choose Personal or Business (then owner or team member). Shell redirects a connected wallet without a choice to /start. The UI calls it "Personal", the anchor "Individual" (see naming) | Mostly. Row 2 says the switch is "at the top of the app"; on desktop it is in the sidebar |
| 3 | "...and gets a profile with a unique ID." | Built | /start step 2 creates SD-XXXXXXXX; shown on Home and on the account chip | Yes |
| 4 | "Businesses fund a USDC treasury and pay their team once or on a schedule" | Built | /employer: Treasury, Pay the team (Once, now / On a schedule), Your schedules | Yes |
| 5 | "...and employees claim to any wallet they choose." | Built | /pay "Send the cash part to", any address | Yes |
| 6 | "Before claiming, an employee can send a share of their salary, once or on every payday, into Coinbase tokenized stocks (and Bitcoin or Ether tokens)" | Built (mock tokens on testnet) | /pay "Just this payday / Every payday", nine assets. Bug: UI lets you pick up to 9 assets but Payroll.MAX_ALLOCATIONS is 6 (claim reverts) | Yes |
| 7 | "...held in a vault only they control." | Built | EmployeeVault, onlyOwner withdraw, no admin | Yes |
| 8 | "Individuals without an employer invest the same way, on a regular schedule from their own wallet." | Built | /invest buy once and "Buy on a schedule" (SipRouter) | No. Row 11 still says "No Individual account type around it yet"; the Personal account type now exists |
| 9 | "Positions grow through automatically reinvested dividends" | Partly (property of real tokens; mocks pay none) | Borrow basket shows estimated dividends and says the mocks pay none | Yes |
| 10 | "...and idle USDC can earn interest on Morpho or Aave." | Partly: Morpho-style vault only, mock venue on testnet, Aave not built | /invest "Earn interest on idle USDC". The card has no Mock label on the page | Yes |
| 11 | "When cash is needed, the person borrows USDC against their holdings through the existing Morpho and Aave markets instead of selling" | Partly: real Morpho, Aave not built | /borrow, /risk "Real Morpho contracts". Each market has only 2 USDC of liquidity (checked on-chain: totalSupplyAssets 2,000,000 raw, all nine markets) | Yes |
| 12 | "...because every payday adds more collateral, the loan gets safer as the weeks go by." | Built | EmployeeVault.depositStock auto-locks new stock when a loan is open on that asset. The Borrow page copy does not say this (it implies everything must be locked by hand) | Yes |
| 13 | "A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances" | Missing (labelled "In development") | Landing card 3 of 4 and /docs "Themes and risk rules" describe it; nothing in the app | Yes |
| 14 | "Confidential salary payments are planned as the next step." | Missing from public surfaces | Not mentioned on the site, in /docs or in README (only in START-HERE.md). No separate payout interface in Payroll.sol (claim calls usdc.safeTransfer directly), which CLAUDE.md asks to keep clean for Fairblock-style transfers | ANCHOR.md row 17 says "Next step, not built", accurate, but the public story is missing it |
| 5 (part) | Business account shows owner or employee dashboard | Built | NAVS in web/components/shell.tsx | No. Row 5 says team members get "My pay, Holdings, Borrow and Risk"; the nav also has Invest |

Built but not in the anchor paragraph (acceptable, but keep them visibly secondary): attendance check-in (CLAUDE.md calls it supporting), the Demo panel (testnet tool), TradingView real price charts on Invest (supports "Coinbase tokenized stocks", reference only), the Themes hard-caps table in /docs (traces to Themes but describes an unbuilt feature in detail, including tickers SNDK and INTC that the app does not offer).

## Repetition and clarity findings

### Must fix (confuses or misleads)

M1. Landing, "No wallet? View a demo vault"
- What the user sees: /dashboard?view=0xC0F2... shows Net worth $0.00, "Nothing in your vault yet", "No plans yet". The judge sequence withdrew everything and the November 16 redeploy started fresh.
- Why it confuses: the one no-wallet path for judges shows an empty product.
- Fix: founder seeds the demo wallet on the current deployment so it ends with holdings, an open small loan and an every-payday plan (run the claim and borrow steps of script/judge-sequence.sh without the final repay and withdraw). Do not change web/app/page.tsx DEMO_VIEW unless a different seeded wallet is used.

M2. Morpho markets hold 2 USDC each
- What the user sees: /risk "USDC available in the market $2.00". A judge who locks $10 and tries to borrow $5 fails; after one or two visitors borrow, everyone else fails.
- Fix: founder supplies test USDC to each of the nine markets (or at least mAAPL and mcbBTC, the ones the docs use as examples), for example 50 to 100 USDC each. Also show liquidity in the basket: in web/components/collateral-basket.tsx, change the "You can borrow" hint from "Under your borrow limit" to "Limited by your collateral and by the USDC the market has to lend" when market liquidity is the binding limit.

M3. Borrow page: two sets of borrow and repay controls
- What the user sees: the "Collateral basket" card (Lock, Borrow, Repay, Unlock tabs, a "You can borrow" figure, a "Health" figure) and, right below, "One asset at a time" with its own Borrow field, Repay, Repay all, "You can borrow" (with a different hint, "50% of the maximum"), "Health" and a health bar. With no loan, both say "No loan" twice.
- Why it confuses: a new user cannot tell which Borrow button to press, and the two Health and two "You can borrow" numbers will differ once a basket loan is open.
- Fix (remove, do not add): in web/app/(app)/borrow/page.tsx
  - Delete the Borrow field and button and the Repay field and buttons from the "One asset at a time" card (the doBorrow and doRepay calls and their JSX).
  - Rename the heading "One asset at a time" to "Take assets out" and the card title from "Your {asset} loan" to "{asset} in your vault".
  - Keep the asset picker, a single read-only line "Loan $x, health y" for that asset, and the Withdraw field.
  - Delete the "You can borrow" and "Interest now" stats from that card (the basket and the Risk page already show them).
- Then in web/components/collateral-basket.tsx, drop the "Unlock" tab: EmployeeVault.withdraw already releases collateral automatically, so Unlock plus Withdraw is two controls for one job. Change the Repay hint to "Any amount, any time. No penalty." and add nothing else.
- Update the Unlock notice text that points to "One asset at a time" (it disappears with the tab).

M4. Invest page: real ticker shown on a mock token, no Mock label
- What the user sees: the asset picker says "Apple / AAPLc / $357.00", then "In your vault: 0 mAAPL". The interest card has no Mock badge although the venue is a mock. The landing page promises "Mock tokens and prices are labelled everywhere."
- Fix: in web/components/asset-select.tsx, change the second line from the real ticker to "Mock of AAPLc" (Pay already says "stands in for AAPLc", reuse that wording: "Test token, stands in for AAPLc"). In web/app/(app)/invest/page.tsx, give the "Earn interest on idle USDC" card `badge={<MockBadge>Mock interest venue</MockBadge>}` like Risk does.

M5. Pay page lets you pick more assets than the contract accepts
- What the user sees: nine asset cards with + buttons. Choosing 7 or more (for example 5 percent each) builds a claim that Payroll rejects (TooManyAllocations, MAX_ALLOCATIONS = 6). /docs says "up to 6 assets", the page does not.
- Fix: in web/app/(app)/pay/page.tsx setPct, disable the + button on an unselected asset when 6 are already chosen, with the hint "Up to 6 assets per payday."

M6. Home: account card contradicts itself
- What the user sees: "YOUR STACKDAY ID SD-FND8C4PB ... Copy ID", then right under it "Sign in to get your Stackday ID, pick a name and check in."
- Fix: in web/app/(app)/dashboard/page.tsx line 178, change to "Sign in to pick a name" for Personal and "Sign in to pick a name and check in" for Business. Never say "get your Stackday ID" once uid is shown.

M7. The same page has three names, and a card repeats the page title
- What the user sees: /dashboard is "Home" (Personal nav), "Holdings" (team member nav and page title), "Dashboard" (read-only nav), "Hello, name" (title when named). On the team member's Holdings page the first card is also titled "Holdings". The landing "I have an account" button and README call it Dashboard.
- Fix: one name, "Home", for both modes. In web/components/shell.tsx NAVS.employee and NAVS.all change label to "Home" (and short to "Home"); in dashboard/page.tsx title use "Home" in both modes; keep the "Holdings" card title. README "Dashboard" becomes "Home".

M8. Locked vs posted collateral
- What the user sees: Borrow says "Locked" and "Lock ... as collateral". Home says "posted as loan collateral". Risk says "Borrowing more against collateral already posted". /docs says "Your vault posts its assets as collateral".
- Fix: use "locked" everywhere. dashboard/page.tsx "posted as loan collateral" becomes "locked as collateral"; risk/page.tsx "collateral already posted" becomes "collateral already locked"; docs/page.tsx "posts its assets as collateral" becomes "locks its assets as collateral".

### Should fix

S1. Basket copy contradicts how payday works
- Borrow basket says "Locking first means nothing is put at risk until you choose" and "Every payday share you lock adds collateral". The contract locks new stock automatically when a loan is open on that asset.
- Fix in collateral-basket.tsx: replace both with one sentence: "While a loan is open on an asset, new buys of that asset (including payday shares) are locked automatically, so the loan gets safer." Remove "Every payday share you lock adds collateral" from the dividends paragraph.

S2. Dividend paragraph on Borrow is long and repeats limits shown elsewhere
- Current text (5 sentences) lists per-stock yields and liquidation limits, which the per-asset card, Risk and Docs also show.
- Fix: replace with "Estimated with each real share's yearly dividend. The test tokens pay none." Move the yields list to /docs#borrowing (already there in part).

S3. Emergency rule picker moves the asset picker above it
- In borrow/page.tsx, "Protect the loan on" uses the same `symbol` state as the asset picker, so changing one changes the other.
- Fix: give the rule its own state (`ruleSymbol`). Also rename the card "Emergency rule: protect a loan on payday" so it reads without the Learn more link.

S4. My pay vs Get paid, Payroll vs Run payroll
- Team member nav "My pay", page title "Get paid", start button "Open Business: my pay". Owner nav "Payroll", page title "Run payroll", read-only nav "Run payroll".
- Fix: pick the nav names. pay/page.tsx title "My pay"; NAVS.all "Get paid" becomes "My pay". employer/page.tsx title "Payroll"; NAVS.all "Run payroll" becomes "Payroll". README and START-HERE page lists follow.

S5. One plan, five names
- "share of pay", "every-payday plan", "standing plan" (Pay), "Every payday, automatically" (Home), "recurring buys" and "recurring plan" (Invest), "SIP" (README, CLAUDE.md, contracts).
- Fix: in the UI use two names only: "Payday plan" (share of salary, employees) and "Recurring buy" (from your wallet, Invest). pay/page.tsx: card "Your every-payday plan" becomes "Your payday plan"; empty text "No standing plan" becomes "No payday plan yet". dashboard/page.tsx "Every payday, automatically" becomes "Payday plan". Keep "SIP" out of user-facing copy (it already is) and in README define it once: "SIP (the share of pay that buys assets)".

S6. Personal vs Individual
- Anchor and docs say Individual; the site says Personal. /docs heading "For individuals without an employer".
- Fix: keep "Personal" in the UI and change the /docs heading to "For Personal accounts (no employer needed)". Add one line to docs/ANCHOR.md assumption C: "The UI calls the Individual account Personal."

S7. Bitcoin vs cbBTC, Ether vs WETH
- Landing, Start and Docs say "cbBTC or Ether"; README says "Bitcoin or Ether tokens"; the price chart says "Live Bitcoin price ... cbBTC tracks Bitcoin 1 to 1".
- Fix: in user-facing copy say "Bitcoin (cbBTC)" and "Ether (WETH)" on first mention per page, then cbBTC and Ether. In web/lib/contracts.ts change the mcbBTC name from "cbBTC" to "Bitcoin" with realTicker "cbBTC", so the picker reads "Bitcoin / cbBTC" like "Apple / AAPLc".

S8. Testnet notice appears three or four times on every app page
- Every app page has: the yellow top banner ("Testnet. Test tokens and prices, no real money."), the sidebar line "Testnet, not audited. Testnet tools", the footer ("Not investment advice"), and on Borrow and Risk the RiskNote ("Not financial advice").
- Fix: in web/components/shell.tsx, delete "Testnet, not audited." from the sidebar and keep only the "Testnet tools" link (the banner already says testnet). In risk/page.tsx, drop the top `<RiskNote />` because the page's Liquidation risk card says the same thing ("part of your collateral can be sold with no warning").

S9. Risk page ignores the basket
- A basket loan is split across many markets, but /risk shows one asset at a time with its own example numbers. The Borrow page links to it as "Risk screen and stress test".
- Fix (text only, before the deadline): in risk/page.tsx under the asset picker add "A basket loan is one loan per asset. Pick each asset to see its own numbers." If time allows, default the picker to the weakest part.

S10. "Release payday" banner on My pay
- "Your weekly payday from X is due ... Anyone can release it from the employer's treasury." An employee will not know why they have to press something before they can claim.
- Fix in pay/page.tsx: "Your weekly pay from X is ready. Press Release to move it into Claim." Button "Release payday" becomes "Release pay".

S11. Free balance mixes vault and wallet
- Basket "Free: $0.99 (0.002794 mAAPL)" while Home says "Nothing in your vault yet" and Invest says "In your vault: 0 mAAPL" for the same wallet. The basket counts wallet tokens as free.
- Fix in collateral-basket.tsx hint: "Free: $0.99 (0.002794 mAAPL, in your wallet)" when the vault part is zero, or "in your vault and wallet" when both.

S12. ANCHOR.md and README out of date
- ANCHOR.md row 5: add Invest to the team member list. Row 11: replace "No Individual account type around it yet" with "Personal account type built". Row 14: add "Unlock is automatic on withdraw" once M3 is done.
- README line 5: "A payroll and investing app on Base ...". README "Frontend, Pages" list lacks /start, Personal and Business modes and the collateral basket. README recurring payroll table repeats the row "S4. First payday released" twice; delete one. Add one line under "What it does": "Next step: confidential salary payments (Fairblock-style), not built."

### Nice to have

N1. Invest button "Start a Apple plan": use "Start a recurring buy" (also fixes "a Apple"). invest/page.tsx.
N2. Risk stress table: "Down 40%(your pick)" lacks a space, and "$1000.00" lacks the thousands comma used elsewhere ("$1,000.00"). risk/page.tsx.
N3. Pay presets "10% A good start" and "20% Builds faster" read as nudges. Change hints to none, or "Optional". pay/page.tsx lines 34 and 35.
N4. Landing "How it works" puts Themes (not built) as step 3 of 4 between Vault and Borrow. Make it a separate "Coming next: Themes and confidential salaries" line under the three built steps. web/app/page.tsx.
N5. /docs Themes caps table names SNDK and INTC, which the app does not offer, and runs long for an unbuilt feature. Cut to three bullets ("You pick themes, the app suggests a capped split, you confirm. No selling, no leverage. Information, not advice.") and keep the full table in docs/ files.
N6. Risk "Liquidation limit (LLTV)": drop "(LLTV)" or add "the share of collateral value you can owe before liquidation". Borrow card "Health" hint: "Above 1.00 is safe" reads better than "Below 1.00 can be liquidated" next to "No loan".
N7. Home has no way to withdraw. Add "Withdraw" as a second action next to "Buy more" linking to /borrow (the Take assets out card), rather than another withdraw form.
N8. /demo step 03 says "take a USDC loan against one of them"; with the basket it is "lock some, then borrow". Step 07 "repay everything, then withdraw" is right once Unlock is gone.

## Honesty and wording

- Em dashes: none found in web/app, web/components, web/lib, README.md or docs/. Good.
- Mock labels: Risk (price feed, collateral token), Demo (market switches, interest venue), Docs ("Testnet: real and mocked"), README ("What is mocked") are good. Missing on Invest (asset picker shows the real ticker AAPLc on a mock token; interest card is a mock venue with no badge) and on Home holdings (rows show mock symbols with no badge). The landing claim "labelled everywhere" is not true until M4 is done.
- Real labelled real: "Real Morpho contracts" on Risk, "Real market price" on the Invest chart with the sentence that buys use the test price. Good.
- Investment advice: footer and RiskNote say "Not investment advice / Not financial advice". The Pay preset hints ("A good start", "Builds faster") are the only soft nudge (N3). Themes copy says "You confirm every change". Good.
- Aave: the anchor names Aave twice; the site honestly says Morpho only. ANCHOR.md rows 13 and 14 say Aave not built. Consider a one-line note in /docs "Borrowing and health": "Aave is planned behind the same adapter, not built."
- Confidential salaries: anchor sentence with no public mention (row 14 of the table above).
- Demo switches: /docs and /demo both say only the operator wallet can use them. Good, but the judged path depends on it (see below).

## Judged path walkthrough (deposit, borrow, stress, repay, withdraw)

1. Deposit. A judge with a wallet goes /start, picks Business and "I get paid by a business", then has no employer. The Demo panel "Quick payday" pays the connected wallet from its own test USDC, which works for anyone, but nothing on My pay points to it. Fix: in pay/page.tsx empty state add "On testnet, create a payday for yourself in Testnet tools" with a link to /demo. Personal users deposit by "Buy once" on Invest, which is clear.
2. Borrow. Two sets of controls (M3) and 2 USDC per market (M2) are the blockers. With the basket only, the flow Lock then Borrow is clear and the split preview ("Split so every part stays equally safe") is good.
3. Stress. A judge cannot run it: the price and pause switches only work for the operator wallet. What a judge can do is the Risk page stress table and "Try your own gap", which is simulated. Say so on /demo above the switches: "Visitors: use the stress table on Risk, or see the recorded run in README (judges' sequence)." Also note the README judges' sequence ran on the retired v3 deployment; re-run script/judge-sequence.sh on the current deployment so the transaction links match the live addresses.
4. Repay. Clear in the basket ("Any amount, any time. No penalty."). Works during a pause (documented on Risk).
5. Withdraw. Today a user must find "Withdraw Apple to your wallet" inside the "One asset at a time" card under the loan controls, or the basket Unlock tab, which only moves tokens back to free inside the vault. After M3 this is one "Take assets out" card. Home should link to it (N7).

## Top 10 fixes in priority order

1. Seed the demo wallet so "View a demo vault" shows holdings and a loan (founder, script/judge-sequence.sh without the last two steps).
2. Add test USDC liquidity to the nine Morpho markets (founder).
3. Remove the duplicate Borrow and Repay from "One asset at a time" and drop the basket Unlock tab (web/app/(app)/borrow/page.tsx, web/components/collateral-basket.tsx).
4. Label mocks on Invest: picker second line and interest card badge (web/components/asset-select.tsx, web/app/(app)/invest/page.tsx).
5. Cap the Pay allocation at 6 assets (web/app/(app)/pay/page.tsx).
6. Fix the "Sign in to get your Stackday ID" contradiction (web/app/(app)/dashboard/page.tsx).
7. One name for the home page, "Home" (web/components/shell.tsx, dashboard/page.tsx, README.md).
8. "locked" everywhere instead of "posted" (dashboard/page.tsx, risk/page.tsx, docs/page.tsx).
9. Replace the basket copy with "new buys are locked automatically while a loan is open" (collateral-basket.tsx).
10. Update docs/ANCHOR.md rows 5 and 11, README line 5, the duplicate S4 row, and mention confidential salaries as the next step (docs/ANCHOR.md, README.md, web/app/docs/page.tsx).
