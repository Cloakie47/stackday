> Checked on 2026-11-21 against the live site (stackday-rho.vercel.app, read only): the payday plan dead end, the missing account-type check on Themes, the "In development" landing badge, the naming mismatches, and withdraw sitting on Borrow and earn on Invest. Line numbers are approximate in places.

# Stackday web app: code-level UX audit

Scope: `web/app/**`, `web/components/shell.tsx`, `web/components/collateral-basket.tsx`. Source only, no live walk. Line numbers are from the clone at `C:\Stackday\team-repo\stackday` (branch main). Paths below are relative to `web/`. No repo files were edited.

Severity: high = a new user will likely get stuck or misunderstand money. Medium = confusing but recoverable. Low = polish. Effort: S under 1 hour, M a few hours, L a day or more.

## 1. Map of routes and pages

### Public / setup
| Route | File | Purpose | Main actions | Contract calls |
|---|---|---|---|---|
| `/` | `app/page.tsx` | Landing. Hero, 4-step "How it works", "Payroll that invests", trust cards, sample app preview | Get started (/start), Sign in (/start), Open app (/dashboard), View a demo vault (read-only /dashboard?view=0x...) | none |
| `/start` | `app/start/page.tsx` | 3-step onboarding: connect wallet, sign message, choose Personal or Business (owner or team member) | Connect, Sign in, Open Personal / Open Business | none (API: profile, business) |
| `/docs` | `app/docs/page.tsx`, `docs-nav.tsx` | Long single page, 14 sections | read only | reads deployment addresses |

### App (inside `Shell`, `app/(app)/layout.tsx`)
| Route | File | Purpose | Main actions | Contract calls |
|---|---|---|---|---|
| `/dashboard` | `(app)/dashboard/page.tsx` | Nav label "Portfolio". Net worth, health, holdings table, plan cards, loan card, team invitations, account/username/check-in | Buy, Borrow, Repay, Claim it (links), accept/decline team invite, set username, check in, private-pay setup | none directly (reads via `usePortfolio`); private pay setup in `PrivatePaySetup` |
| `/pay` | `(app)/pay/page.tsx` | Nav label "Payday". Employee claims salary with a split into assets | Release pay, Claim, Turn off plan, private collect | `runSchedule`, `claimMany`, `claimWithSipMany`, `setSipPlanMany` |
| `/invest` | `(app)/invest/page.tsx` | Buy once, recurring buy, earn on idle USDC | Buy once, Start/Replace recurring buy, Run now, Cancel, Extend, Start earning, Take it all back | `SipRouter.invest`, `setPlan`, `executePlan`, `cancelPlan`, `createVault`, vault `earn`, `stopEarning`, `approve` |
| `/borrow` | `(app)/borrow/page.tsx` + `components/collateral-basket.tsx` | Tabs Borrow / Repay / Add collateral, collateral table, withdraw, emergency rule | lock, borrow, repay, withdraw, save emergency rule | vault lock/borrow/repay (in basket), `withdraw`, `setEmergencyRule` |
| `/risk` | `(app)/risk/page.tsx` | Read-only cost, limits, stress tests, market details | none (calculator only) | read-only |
| `/themes` | `(app)/themes/page.tsx` | Pick themes + risk level, get a split, buy it once, schedule it, or set it as payday plan; rebalance card; market mood | Use this split on every payday, Buy the split once, Buy on a schedule, Rebalance | `setSipPlanMany`, `SipRouter.invest`, `setPlan` |
| `/employer` | `(app)/employer/page.tsx` | Nav label "Payroll". Treasury, private balance, business profile, team, pay now or schedule, attendance, past paydays | Fund/Withdraw treasury, Pay team now, create schedule, run schedule, pause | `deposit`, `withdrawUnallocated`, `createRun`, `createSchedule`, `runSchedule`, `setScheduleActive` |
| `/demo` | `(app)/demo/page.tsx` | Menu label "Testnet tools". Mock price/pause switches, quick payday | set price, close market, pause transfers, quick payday | mock feed `setPrice`/`setFrozen`, token `setTransfersPaused`, `depositAndCreateRun` |

API routes (`app/api/*`: attendance, business, employees, keeper, me, memberships, people, profile, session, themes/mood) have no UI of their own.

### Navigation (`components/shell.tsx`)
- Nav items defined at lines 51-58 (`P`). Per role at lines 64-69: Personal = Portfolio, Invest, Borrow, Themes. Owner = Payroll, Risk. Employee = Portfolio, Payday, Invest, Borrow, Themes. Before a choice = all.
- Phone switch (lines 72-77) shows only 2 or 3 of these. Employee phone switch is Portfolio, Borrow, Payday, so Invest and Themes hide in the avatar menu.
- Menu extras (lines 80-85): Docs, Testnet tools, Account. Risk is added to the menu for everyone except owners (lines 623-625).
- A Personal/Business switch lives inside the account menu (`ModeSwitch`, line 99), not in the main bar.
- Wrong-mode pages show a notice (`WrongModeNotice`, line 135) instead of redirecting.

## 2. Repetition findings

### R1. Setting a payday plan: three places, one is a dead end (HIGH, M)
- `/pay` line 286: "No payday plan yet. Choose "Every payday" when you claim to set one." The plan can only be set inside the Claim card, and the Claim card is empty ("Nothing to claim yet.", line 178) until there is a salary.
- `/dashboard` line 317-318: link "Set a plan" / "Edit plan" goes to `/pay`. A team member with no pending salary lands on a page with no way to set it.
- `/themes` line ~592: "Use this split on every payday" also calls `setSipPlanMany` and "Replaces your current payday plan." (line ~600).
- `/borrow` emergency rule also changes what payday does.
- Fix: one place to edit the plan, a standalone "Payday plan" card on `/pay` that is always visible (split picker + Save, no claim required). Claim card then just says "Use my plan" or "Change for this payday". Dashboard "Edit plan" then goes somewhere that works. Themes keeps a button that pre-fills the same card (link with the split) instead of writing its own plan.

### R2. Buying assets: four entry points with different labels (HIGH, M)
- `/invest` "Buy once" (line 196) and "Buy {asset}" button (225).
- `/themes` "Buy the split once" (line ~608) calls the same `invest`.
- `/pay` claim with a share and "Just this payday" buys the same assets (`claimWithSipMany`).
- `/dashboard` "Buy" button (lines 488, 559, 599) links to `/invest`.
- Nothing tells the user how these relate. Fix: label the one canonical place "Invest". Themes should end with "Open in Invest" or share one `BuyCard` component and say "Same as Invest, pre-filled". Rename dashboard "Buy" to "Invest" to match the nav.

### R3. Recurring buys: two places with different names (MEDIUM, M)
- `/invest` card "Buy on a schedule" (line 233), button "Start a recurring buy" (292), list "Your recurring buys" (300).
- `/themes` "Buy the split on a schedule" and success message "Recurring plans saved, one per asset. They show on the Invest page." (line ~513).
- `/dashboard` card "Recurring buys" (368).
- Same feature appears as "schedule", "recurring buy", "recurring plan", "plan". Fix: pick "Recurring buy" everywhere, and reserve "Payday plan" only for the salary split. Add one sentence in the Invest card: "This is for money from your wallet. If you get a salary, your Payday plan is on the Payday page."

### R4. Running a due schedule: same call, three labels (MEDIUM, S)
- `/employer` line 341 "Pay the due payday"; `/pay` line 133 and 170 "Release the payday" / "Release pay" (tooltip: "Moves the due payday into Claim so you can claim it"); `/invest` line 334 "Run now" for recurring buys.
- "Release" is an unexplained word. Fix: employee side "Make my pay claimable", or hide it behind "Claim" (do both in one transaction batch). Employer side keep "Pay now".

### R5. Borrow and Risk overlap (MEDIUM, M)
- `/risk` repeats Loan, Health, Collateral value, Borrow rate, Borrow limit, fee, and "Repay any amount on the Borrow page" (line 186), all of which also appear on `/borrow` (basket) and the dashboard Loan card.
- Risk is reachable only through a tiny text link next to the "Collateral" heading (`collateral-basket.tsx` line 726), a dashboard "Stress test" link that appears only when a loan exists (`dashboard` line 408), and the menu. It is also in the Owner nav (line 66) although an owner page has no loan.
- Fix: make Risk a tab or an expandable "Stress test and market details" section on `/borrow`, remove it from the owner nav, keep `/risk` as a redirect to `/borrow?tab=risk`.

### R6. "Available to borrow", "Health", "Loan" shown 3 to 4 times (LOW, S)
- Dashboard: Figure row (lines 538-554) plus `LoanCard` (lines 399-452) repeat Loan, Health meter, Available to borrow. Borrow page: basket stats (344-372) and panel rows (491-520) repeat them again.
- Fix: dashboard summary row stays, make `LoanCard` a short "Loan" status with one button, no repeated numbers.

### R7. Employer vs Pay overlap (MEDIUM, S to M)
- `/employer` has "Pay the team" with "Once, now" and "On a schedule", plus "Past paydays", "Your schedules", a private-pay record. `/pay` has "Your recurring salary" (a read-only copy of the schedule) and its own private-pay record (`PrivateRecords`). Same facts, two screens, different names ("Payroll run #", "payday", "schedule", "recurring salary").
- `/demo` "Quick payday" (line 200) is a third way to create a payday (`depositAndCreateRun`), which duplicates "Pay the team, Once, now".
- Fix: in demo, replace "Quick payday" with a link "Create a test payday on Payroll"; reuse the terms "Payday" and "Schedule" only.

### R8. Account/profile/ID duplicated (LOW, S)
- Name, ID and check-in sit at the bottom of the dashboard (`Account`, lines 114-250) while `/start` also shows the ID and the account type, and the menu shows "Copy Stackday ID" (`shell.tsx` line ~213) and "Account" (line 84, which goes to `/start`, the onboarding page, not an account page).
- Fix: rename menu item to "Profile and settings"; give Account its own small `/account` page (name, ID, switch mode, check-in) and remove it from the dashboard. Attendance and check-in are a supporting feature (CLAUDE.md says so), so keep it out of the main flow.

### R9. Withdraw sits on Borrow (MEDIUM, S)
- "Take assets out" card is on `/borrow` (line 100). The user looking at holdings on `/dashboard` or `/invest` has no withdraw button. Withdraw is also tied to repaying, so this is partly deliberate, but it is a wrong home.
- Fix: a "Withdraw" button on each dashboard holdings row that opens the same card (or links to `/borrow?tab=withdraw`). Add "Withdraw" as a fourth tab in the Borrow panel, or move the card to `/invest`.

### R10. Explainer text duplicated (LOW, S)
- Fees explained on landing (`app/page.tsx` line 33), docs `#fees`, `/risk` "Borrowing cost" (line 158), basket (line 529), invest (line 294), pay (line 251). The docs "Demo panel" and the demo page's own "story" list repeat each other (`demo/page.tsx` lines 17-25 vs `docs/page.tsx` line 533).
- "Liquidation risk" is repeated by `RiskNote` (`ui.tsx` 878), landing (line 278), basket (line ~548), risk page (line 179).
- Fix: one `<FeeSummary />` and one `<RiskNote />` component, used everywhere; keep the long text only in docs.

## 3. Naming inconsistencies

| Concept | Names found | Where | Proposed single name |
|---|---|---|---|
| The overview page | "Portfolio" (nav, `shell.tsx` 52), "Hello, {name}" (dashboard 484), "Home" and "Holdings" (code comment 457, docs 482, 498, `private-collect.tsx` 327) | docs say "Home" but nav says "Portfolio" | **Portfolio** everywhere; fix docs and private-pay copy |
| Employee pay page | "Payday" (nav, page title), "My pay" (docs 490, demo 19 and 73, `private-payday.tsx` 190, `private-collect.tsx` 336, `shell.tsx` 112, start 238 "Open Business: my pay") | nav vs copy | **Payday** |
| Owner page | "Payroll" (nav), route `/employer`, "Business: payroll" | route vs label | keep label "Payroll", rename route to `/payroll` with a redirect (optional) |
| The vault | "vault" (most), "Your vault" (borrow h1, line 77), "Holdings" (dashboard card), "portfolio" | borrow h1 reads "USDC | Your vault" | **Vault** for the container, **Holdings** for the list inside it. Say once on dashboard: "Your vault holds these assets". |
| Salary plan | "payday plan", "Every payday", "plan", "SIP" (ANCHOR.md, code comments only), `setSipPlanMany` | pay, dashboard, themes, docs | **Payday plan** (UI), never "SIP" in UI (already true; keep it that way) |
| Scheduled buys | "recurring buy", "Buy on a schedule", "recurring plan", "plan", "recurring" | invest, themes, dashboard, risk (line 163) | **Recurring buy** |
| Debt | "Loan" (most), "Borrow" (nav, short "Loan" on phone, `shell.tsx` 53), "borrowed", "debt" | nav says Borrow but phone says Loan | **Borrow** (nav, action) and **Loan** (the thing you owe) consistently; remove `short: "Loan"` so the phone does not rename the tab |
| Lock/collateral | "Lock", "Add collateral" (tab), "Lock collateral first" (button), "Locked", "Collateral", "free" vs "idle" | basket lines 330, 553, 700; dashboard "Not used", "Collateral" badge | **Lock as collateral** (action), **Collateral** (state), **Free** (not locked). Drop "idle" in user copy except the earn card ("Idle in your vault"), and rename that card to "USDC not earning". |
| Account types | code `individual`; UI "Personal"; docs "For Personal accounts (no employer needed)"; CLAUDE.md "Individual"; roles "Business · owner", "Business · team member", start "I get paid by a business", docs "employees" | `useAccount.ts`, `shell.tsx` 91-95, docs 308-317 | **Personal**, **Business owner**, **Team member** (not "employee") in the UI. Landing "For the team" is fine. |
| Fees | "Stackday fee", "fee on recurring buys", "SIP fee" (docs), "Borrow fee" | | **Stackday fee** with the scope in brackets |
| Demo page | "Testnet tools" (menu), "Demo panel" (docs 533), "demo operator", route `/demo`, "How the demo works" | | **Testnet tools** everywhere |
| "Health" | "Health", "Health factor" (none found), "Liquidation at 1.00" | OK, but see jargon | keep **Health** |

## 4. Confusion findings

### C1. Landing says Themes is "In development" but it is a live nav item that buys things (HIGH, S)
`app/page.tsx` line 15 `soon: true`, line 233 renders "In development". `/themes` is in every nav and can buy and write the payday plan on testnet. A user sees contradictory status. Fix: change to "Beta" or remove the badge, and label the page with "Suggestions use a fixed news snapshot" (it is a snapshot, `themes/page.tsx` line 59 "Market mood, {date}").

### C2. Themes is offered to Personal users but asks about "my salary" (HIGH, S)
`/themes` has no mode check (grep for `mode`/`personal` returns nothing). "4. Put it to work" defaults to `source = "salary"` (line 447), "From my salary", "10% of salary", "Use this split on every payday" call `Payroll.setSipPlanMany`. A Personal user has no payday. Fix: if `mode === "personal"`, hide the salary option and make the wallet option the only path; for business team members, default to the plan card. Also "Replaces your current payday plan." should only show when a plan exists.

### C3. Step numbering broken on Themes (MEDIUM, S)
Cards are "1. Pick your themes", "2. Your risk level", "3. Your suggested split", then an unnumbered "Market mood" card, then "4. Put it to work", then "5. Rebalance with new money" (`themes/page.tsx` lines 524, 529, 544, 551, 214). The rebalance card sits after "Put it to work", so the numbers read as a flow but step 5 is a separate optional tool. Fix: number 1-4 only, put Market mood as a side card, make Rebalance a separate "Optional" card.

### C4. Dashboard "Set a plan" dead end: see R1 (HIGH).

### C5. Borrow page heading is a logo-style title with no word "Borrow" (MEDIUM, S)
`borrow/page.tsx` lines 70-80: breadcrumb "Borrow / USDC against your vault", h1 "USDC | Your vault", badge "Variable rate". The page title does not say what to do. Fix: `PageHeader title="Borrow" lead="Borrow USDC against what you hold. Repay any time."`

### C6. Borrow page has 4 unrelated blocks and 3 tabs with unclear order (MEDIUM, M)
Panel tabs "Borrow / Repay / Add collateral" (`collateral-basket.tsx` 325-335) but the Borrow button says "Lock collateral first" (553) and sends you to the third tab. Plus the "Collateral" table, "Per year, at today's prices" estimate (805), "Take assets out", and the Emergency rule (business only). Fix: tab order Add collateral, Borrow, Repay, Withdraw (the journey); move Emergency rule into a collapsed "Protect my loan" section; show "Per year" estimate only after a loan exists.

### C7. Emergency rule shown in four places in three vocabularies (MEDIUM, S)
`borrow/page.tsx` 144-183 (set), `pay/page.tsx` 261-267 (warning), `dashboard` 351-357 (row), basket line 554 ("Consider the emergency rule"), `risk` line 191. The rule is set only on Borrow, only for Business, and only acts at claim time. The rule UI says "Health at or below 1.25 (late), 1.50 (balanced), 2.00 (early)" with no say on what happens. Fix: one sentence on Borrow: "If your loan is close to liquidation on payday, your whole next share buys more collateral." and link all four mentions to it. Personal users who borrow should see a one-line "Emergency rule is for salaries" note rather than silence.

### C8. Jargon without an explanation in place (MEDIUM, S)
- "Liquidation LTV" row on `/risk` line 322 (tip exists but "LTV" never spelled out). Fix label to "Liquidation point (loan to value)".
- "Health" has a tooltip on dashboard and risk, but "Health at or below 1.50 (balanced)" on the emergency rule (borrow line 161) does not.
- "Morpho" appears on landing, dashboard tip, risk, basket with no one-line description. Add "Morpho, an existing lending market on Base" once on `/borrow` and landing.
- "Collateral", "Locked", "free": the tip exists only on the basket (line 392). Add a one-line "How borrowing works" strip on `/borrow` when the user has nothing locked.
- "Payroll run #3" (`pay/page.tsx` line 190), "Release" (166), "treasury" without definition on `/employer` first screen (a tip exists at ~line 387; fine for owners but landing never says "treasury is your USDC balance in Stackday").
- "bps": only in code, not shown. Good. Keep it that way.
- "Day (11:00 am New York)" in the recurring form (`invest/page.tsx` 278) with a tip "run while the US market is open"; fine, but the label could be "Weekday (buys run at 11:00 am New York time)".
- "Net worth", "Allocation", "Payday split" (dashboard 628-632) all have tips. OK.

### C9. Mock vs real labelling is uneven (MEDIUM, S)
- Good: `NetworkChip` and footer on every app page; `MockBadge` on Themes picker, Earn card, Risk "Price freshness"; `RealBadge` on Market; docs section "Testnet: real and mocked".
- Gaps: `/invest` "Choose what to buy" (the buy itself) and the dashboard holdings table have no "mock" label, only the page footer; `/pay` claim uses mock tokens; borrow page has no badge; landing sample table (`SAMPLE`, line 44) shows fake numbers ("Sample data" badge exists but is small, in the preview only); "Private pay" says "Real on Base Sepolia" (`private-collect.tsx` 120), which can read as "real money". Fix: add `MockBadge` "Mock tokens" in the headers of Invest, Borrow, Pay, and Portfolio; on private pay say "Real transfers of test USDC on Base Sepolia".
- The landing page promises "tokenized stocks, Bitcoin, Ether or gold" (line 194) while every one is a mock on testnet (labelled only at the bottom, line 34 "Testnet, not audited"). The first screen badge "Live on Base Sepolia testnet" is good; add "mock tokens".

### C10. Too many choices on single screens (MEDIUM, M)
- `/employer`: treasury, private balance, business profile, team list, pay card, schedules, attendance, past paydays, private log. 9 cards.
- `/invest`: asset picker with 15 assets, chart, 2 forms (4 inputs in the schedule), earn card. Earn is unrelated to buying and sits at the bottom.
- `/pay` claim: split picker, frequency, destination wallet, 3 detail rows, 2 optional notices.
- `/borrow` as above.
- Fix: Invest: move "Earn interest" to Portfolio or to its own small tab ("Invest | Earn"). Employer: collapse Business profile, Attendance and Past paydays into an "Activity" tab. Pay: put "Send the cash part to" under an "Advanced" toggle (default connected wallet).

### C11. Navigation oddities (MEDIUM, S)
- Owner nav contains "Risk" (`shell.tsx` 66). An owner who has not invested sees an empty loan page.
- Employee phone section switch hides Invest and Themes in the avatar menu (line 75).
- "Account" menu item leads to the onboarding page (line 84), which for an already-set-up user shows "Let's set you up" with three steps (`start/page.tsx` 147).
- Landing: "Sign in" and "Get started" both go to `/start`; "Open app" goes to `/dashboard`, which for an unconnected visitor shows "Connect a wallet to see your portfolio" with no connect button in the body (`dashboard` line 501; connect exists only in the header).
- `WrongModeNotice` shows for pages of the other interface, but `/invest` is unreachable from the owner nav and an owner who wants to invest must switch mode and may not understand why.
- Mode switch is hidden in the account menu; the first-time user may not realise Personal and Business are two separate sides of the same wallet.
- Fix: a visible Personal/Business switch in the header, rename "Account" to "Profile", change the Dashboard empty state to include the "Connect wallet" button, drop Risk from the owner nav.

### C12. Docs page is one 657-line page with 14 sections (LOW, M)
`docs/page.tsx`. Several in-app help links go to deep anchors (`/docs#employees`, `/docs#individuals`, `/docs#themes`, `/docs#borrowing`). Docs refer to "Home" and "My pay" and "Demo panel", which do not exist in the nav. Fix: rewrite those words; add a 5-line "Quick start" at the top of docs and on the dashboard for first-time users with a checklist (see section 6).

### C13. Wallet-less empty states (LOW, S)
Every page has its own "Connect a wallet to ..." notice (`dashboard` 501, `pay` 153, `invest` 177, `borrow` 89, `themes` 520, `employer` 360). Fix: one shared `<ConnectNotice />` with a button.

## 5. Page-level summary of what is confusing for a first-time user
1. Landing sells "turn payday into investments" but the Personal path starts with "Invest". The Business path splits two ways (owner, team member). The choice on `/start` step 3 is a 2-then-2 decision; the explanation is good but long.
2. After onboarding the user lands on a Portfolio page that is empty and has 6 buttons (Buy, Repay, Borrow USDC, "Turn on", "Start one", "Set a plan") but no "start here" instruction.
3. The four things a team member must understand (claim, split, payday plan, emergency rule) live on three pages.
4. Testnet setup (get test USDC) is only mentioned in docs `#testnet` and the landing CTA ("Try it with test USDC"); no link to the faucet in the app itself, so a user with an empty wallet sees "Not enough USDC in your wallet" (`invest` line 227) with no next step. Fix: show a "Get test USDC (Circle faucet)" link in that message and in the empty `Wallet: 0 USDC` hint.

## 6. Proposed simpler information architecture

Keep every anchor feature. Fewer top-level destinations, consistent names, one place per action.

### Personal (4 items)
1. **Portfolio**: summary, holdings (each row has Invest, Withdraw), loan status, a "next step" card, idle USDC earn (moved here from Invest, as a card "USDC not earning / earning").
2. **Invest**: one canvas, two tabs: "Buy once", "Recurring". Themes becomes a "Suggest a split" side panel and a button "Use a theme split" that pre-fills the asset list. Market mood and rebalancing become a "Themes" section on this page (collapsed by default).
3. **Borrow**: tabs Add collateral, Borrow, Repay, Withdraw, and a collapsed "Stress test and market details" (today's Risk page).
4. Menu: Profile (name, ID, switch Personal/Business), Docs, Testnet tools.

### Business owner (2 items)
1. **Payroll**: treasury, pay team, schedules; collapsed "Activity" for profile, attendance, private record, past paydays.
2. Menu: Profile, Docs, Testnet tools.

### Team member (4 items)
1. **Portfolio**
2. **Payday**: ready-to-claim, a persistent **Payday plan** card (the single editor), recurring salary list, private pay.
3. **Invest** (same as Personal; Themes inside it)
4. **Borrow** (with the Emergency rule in a collapsed "Protect my loan" section)

### Merges
- Risk into Borrow (tab or collapsed section). `/risk` redirects.
- Themes into Invest. `/themes` redirects. The anchor "Themes layer" is kept: suggested split, news mood, rebalance. Landing keeps "Themes" as step 3.
- Earn from Invest to Portfolio.
- Account out of the dashboard into Profile.
- Quick payday (demo) replaced with a link to Payroll.
- One payday-plan editor on Payday; Themes and Dashboard link to it.

### Terms (UI glossary)
Portfolio, Payday, Payday plan, Invest, Recurring buy, Vault, Holdings, Collateral (Lock), Borrow, Loan, Repay, Health, Emergency rule, Personal, Business owner, Team member, Testnet tools.

## 7. Ordered fix list (ship before Dec 5, 2026)

Priority order, high impact and low risk first. Nothing here touches contracts.

1. **Naming pass (S, 1 to 2 h).** Docs and copy: replace "Home" and "My pay" with "Portfolio" and "Payday"; "Demo panel" with "Testnet tools"; remove `short: "Loan"` from nav; rename the "Account" menu item; borrow h1 to "Borrow". Files: `app/docs/page.tsx`, `components/private-*.tsx`, `shell.tsx`, `(app)/borrow/page.tsx`, `(app)/demo/page.tsx`, `app/start/page.tsx`.
2. **Landing honesty (S).** Remove "In development" on Themes or change to "Beta"; add "mock tokens" to the hero badge; make "Open app" show a Connect button in the dashboard empty state (`app/page.tsx`, `dashboard/page.tsx` 501).
3. **Fix Personal on Themes (S).** Hide the "From my salary" option and the payday-plan button when `mode === "personal"` (`themes/page.tsx` 444-460, 553-600).
4. **Fix the payday plan dead end (M).** Always show a Payday plan editor on `/pay`; point dashboard "Set a plan" to it (`pay/page.tsx` 284-304, `dashboard/page.tsx` 317).
5. **Remove Risk from the owner nav; link Risk from Borrow with a visible "Stress test" button (S).** (`shell.tsx` 66, 74; `collateral-basket.tsx` 726.)
6. **Add "Get test USDC" link where a wallet is empty (S).** (`invest` 183 and 227, `employer`, `pay`.)
7. **Add a "next step" card on Portfolio for new users (S to M).** Three states: no vault ("Buy your first asset"), assets but no loan ("You can borrow up to $X"), team member with salary waiting ("Claim"). Reuse existing data in `usePortfolio`.
8. **Number and order the Themes cards (S).** (`themes/page.tsx` 524-570, 214.)
9. **Consistent mock badges (S).** `MockBadge` in headers of Invest, Pay, Borrow, Portfolio (`ui.tsx` already has the component).
10. **Merge Risk into Borrow, Themes into Invest, Earn into Portfolio (L).** Do after the above only if time remains; use redirects so links do not break. If time is short, ship the nav change only: keep the pages but remove Themes and Risk from top-level nav and link them from Invest and Borrow.
11. **Jargon pass (S).** One-line definitions on first use for "collateral", "health", "Morpho", "treasury", "Liquidation LTV"; spell out LTV.
12. **Shared components (M).** `FeeSummary`, `RiskNote`, `ConnectNotice`, one `BuyCard` for Invest and Themes.

If only three can ship, do 1, 3 and 4: they fix wrong labels, a broken path for Personal users, and the one true dead end.

## 8. Items that look odd but are probably fine (do not change)
- No "SIP" in any user-facing string; keep it that way (it appears only in comments and docs ANCHOR.md).
- `NetworkChip` plus `SiteNotices` on every page meets the CLAUDE.md rule "anything mocked must be labelled".
- Private pay is labelled "Real on Base Sepolia", matches docs.
- Attendance and check-in are marked as a record only (not in the anchor), which matches CLAUDE.md. Keep it out of the main flow but it does not need removal.
