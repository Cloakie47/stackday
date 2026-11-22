# Research and improvement plan: five topics

Date: November 21, 2026. Deadline: December 5, 2026 (14 days left).
Status: research and plans only. Nothing in the repo was changed. Every plan below needs Justin's go-ahead before building.

The detailed reports, with every source link and quote, are in `docs/improvements/appendix/` (A to E). Five Sonnet research agents wrote them. I then checked the claims each conclusion depends on myself, against the code, the live site, on-chain data and the official pages. The "Checked" lines below say what I checked and how.

---

## 1. Lending revenue: how platforms earn from liquidations

### How it works

- **Morpho (our lender):** when a loan is liquidated, the liquidator repays the debt and takes collateral worth a bit more. The extra is the bonus: 12.7% at our 62.5% markets, 7.4% at 77% and 4.4% at 86%. **The liquidator keeps all of it. Morpho takes nothing.**
- **Aave:** Aave sends a share of each liquidation bonus to its own treasury, usually 10% of the bonus, 20% for stablecoins. This is the "platforms earn from liquidations" idea. It only applies because Aave is the lending protocol itself. We are not, by founder rule.
- **Apps built on top of these lenders** earn in other ways:
  - their own small fees, which is what we do;
  - curating a lending vault and taking a share of the interest;
  - running a liquidation bot;
  - paid "protect my loan" automation. DeFi Saver charges 0.05% per action.

Checked:
- Morpho's liquidation page says the bonus "goes entirely to the liquidator; Morpho protocol doesn't take a fee".
- Aave V3's code sends the fee to the treasury: `LiquidationLogic.sol` transfers `liquidationProtocolFeeAmount` to `RESERVE_TREASURY_ADDRESS`.
- The live Risk page shows "Liquidation penalty about 12.7%" for Apple, which matches the formula.

### Our model compared

We earn three small fixed fees: 0.15% on recurring buys, 0.1% a year on loans and 0.1% a year from interest. **We earn nothing when a user is liquidated, and the unpaid borrow fee is dropped.** That alignment is a strength. Say it in the submission.

| Idea | Verdict |
|---|---|
| Our own liquidation bot | **No.** We would profit when our own users lose money, which contradicts the product promise. Profit is unknown, the competition is heavy and it needs legal advice. |
| Curate a Morpho USDC vault and take a performance fee | **Founder decision, after the hackathon.** It could be the biggest earner, but it breaks three rules as written: the fee is far above 0.2%, the curator can change the fee, and the deposits are pooled. |
| Free "loan protection" keeper: when health is low, repay part of the loan from the user's own idle USDC, opt-in | **Best idea, after the hackathon.** It fits every rule if it is free. It extends the existing emergency rule. It needs a contract change, so an agreed issue and a redeploy. |
| Extra referral or wrapper fees | **No.** They would stack on our existing fees and break the 0.2% cap. |

**Recommendation:** keep the current model for Dec 5 and tell the alignment story clearly. One correction to the agent's report: it suggested showing the liquidation bonus in the app, but the Risk page already shows it. After the hackathon, propose the free protection keeper as an issue. The agent reported that Morpho is shutting down its own similar "Auto Deleverage" product (reported, not checked by me). If true, that is a reason to treat paid protection as unproven.

Needs Justin: nothing before Dec 5. Later he decides on the vault idea and the protection keeper issue.

---

## 2. Repetition and confusion

I walked the founder's live site page by page (read only) and an agent audited the code. Both found the same problems.

### Biggest problems (with evidence)

1. **The same thing has many names.** One recurring buy is called:
   - "payday plan" (Payday page);
   - "Buy on a schedule" or "recurring buy" (Invest);
   - "Use this split on every payday" (Themes);
   - a "schedule" (Payroll).

   Other names that don't match:
   - The docs say "Home" and "My pay", but the menu says "Portfolio" and "Payday".
   - The menu says "Testnet tools", but the docs say "Demo panel".
   - Phones say "Loan" where desktop says "Borrow".
2. **Dead end:** on Portfolio, "Set a plan" opens the Payday page. There, the plan can only be set while claiming a salary ("Choose 'Every payday' when you claim to set one"). An Individual with no employer can never do it.
3. **Themes offers salary options to everyone.** It defaults to "From my salary" and "Use this split on every payday", even for Individuals who have no salary. The code has no account-type check (`themes/page.tsx`).
4. **Buying has four doors:** Invest, Themes, Payday (a share of the claim) and the Portfolio "Buy" button.
5. **Things sit on the wrong page:**
   - "Take assets out" (withdraw) is on Borrow.
   - "Earn interest on idle USDC" is on Invest, and Portfolio's "Turn on" sends you there.
   - Risk is a separate menu item that repeats Borrow.
6. **The landing page contradicts the app:** it marks Themes "In development", but Themes is live and can buy.
7. **The same asset has three names:** "NVIDIA", "NVDAc" and "testnet mNVDA, mock" on one Themes line. There is also jargon with no explanation on some screens: Liquidation LTV, Morpho, "Health at or below 1.50".
8. **The demo vault link** first shows "$0.00, Connect a wallet" for about 3 seconds before the numbers load.

### Simpler layout (nothing removed)

- **Individual menu:** Portfolio, Invest, Borrow.
- **Team member menu:** Portfolio, Payday, Invest, Borrow.
- **Business owner menu:** Payroll.
- **Pages to merge:**
  - Risk becomes a "Stress test" tab on Borrow.
  - Themes becomes a "Suggested split" section on Invest.
  - Earn and Withdraw move to Portfolio.
- **One name per thing:**
  - "Recurring buy" for any schedule that buys.
  - "Payday share" for the salary part.
  - "Borrow" everywhere.

### Fix order before Dec 5 (frontend only, no contract change)

1. One wording pass on names and labels.
2. Fix the landing badge for Themes.
3. Hide the salary options on Themes for Individuals.
4. Add an always-visible payday plan editor on Payday.
5. Add a visible Stress test link on Borrow, and remove Risk from the owner menu.
6. Add a test-USDC faucet link wherever an empty wallet blocks an action.
7. Add a "next step" card on Portfolio for new users.
8. Use the same mock labels everywhere.
9. Bigger and optional: merge the pages as above.

If only three ship: 1, 3 and 4. These touch the founder's pages, so agree the list with Justin first. Details: appendix B.

---

## 3. Automating the research agent

**Most of this is already built** (research PRs #67 to #72):

| Team ask | Status |
|---|---|
| Automate weekly research | **Built.** A Monday 12:00 UTC job writes one report, a reviewer approves it, then it is published. Daily notes and scoring also run on timers. |
| One report for all listed stocks, shared by every payer | **Built exactly this way.** No per-user reports. |
| Payers see the report | **Built in open PRs, not merged yet:** payments, access passes and the gate (paywall off for now). |
| Payers see *their selected* stocks | **Missing, small:** a "My stocks" picker that filters the one shared report. New `research_watchlists` table, a `/api/research/watchlist` route and a filter on the report page. |
| Tell payers a new report is out | **Missing:** in-app banner first, X post next, email later. |
| Use our Grok bot | **Not as the research engine** (see below). |

### Grok

- **Answered 2026-11-22:** the user has X Premium+ only. There is no xAI API key and no paid X developer account.
  - Premium+ gives Grok inside the X app and on grok.com for personal use. It does not give an API that our app or a bot can call.
  - A Grok bot would need an xAI API key (pay per use at console.x.ai, billed separately) and X API credits for posting.
  - So for the hackathon: no Grok bot. The chat demo (item 4) should use Claude through the ANTHROPIC_API_KEY already planned for the research agent, inside our app, not on X.
- Recommended role: **post the approved weekly summary on X.** Posting through the X API costs $0.015 a post, or $0.20 if the post has a link.
- Do not use it to write the research. Justin's spec fixes the models (Claude Opus for the weekly report), and changing that needs his approval.
- Grok could later add X sentiment as one extra data source, passed through the same injection screen as other news.
- The bot must never hold a wallet or keys. The May 2026 Grok and Bankr drain happened because an AI bot could move money.

Checked: X's pricing page ("pay-per-usage pricing. No subscriptions", "$0.015" a post, "$0.200" with a URL) and xAI's model page (grok-4.7 at $2 / $6 per million tokens).

### Two real risks found

1. **The weekly run can be cut off.** It is set to run up to 800 seconds, but Vercel's free Hobby plan stops any function at 300 seconds. Checked on Vercel's docs: "Hobby: 300s default and maximum. Pro and Enterprise: 300s default, 800s maximum". The fix is either the Pro plan, or running one asset per call.
2. **No "already ran this week" check.** A retry could create a second report. I checked `weekly.ts`: it has no such guard. Add one before any retry job.

### Best tools

Keep what is built: Vercel timers plus the Anthropic API. The Batch API would halve the cost of the roughly $2.50 Monday run but needs a rewrite, so not now. Managed agents, n8n and Zapier add cost or moving parts for no gain here.

**Honesty:** a backtest on 3.5 years of prices found the code's levels and views did no better than random. The report must never claim an edge. It is research and context, not a winning signal.

**Before Dec 5:** selected stocks, the retry guard, the in-app banner, and the X post if the account exists. Not before Dec 5: a Grok data source, email, or turning the paywall on. The paywall needs four good Mondays plus a legal check.

Needs Justin:
- merge the research PRs, set the keys and apply the tables;
- move to Pro or approve splitting the run;
- choose the reviewers;
- choose a price feed and news feed whose terms allow showing them;
- say which Grok meaning applies.

Details: appendix C.

---

## 4. Text to buy, borrow or repay (chatbot)

**Feasible and safe if the bot only prepares the transaction and the person approves it in their own wallet.** The bot never holds keys, never signs and never moves money.

Checked in the code:
- The app already batches several steps into one wallet approval (EIP-5792 `sendCalls` in `web/lib/useTx.ts`).
- The Invest and Borrow pages already build every call the bot would need.

### Design

1. The person types "buy $20 of Apple every week" or "borrow $100 against my gold".
2. An AI reads the request and fills in a strict form with action, asset and amount. It can only choose from: buy, recurring buy, cancel, borrow, repay, show position, explain. It never writes addresses or raw transaction data.
3. Ordinary code, not the AI, builds the transaction from the existing contracts.
4. A confirmation card shows:
   - the exact amount;
   - the expected tokens;
   - the fees;
   - the loan health after borrowing;
   - where the money goes.
5. The person approves it in their own wallet.

### Safety

- **The destination is always the connected wallet.** Checked: `EmployeeVault.borrow(..., receiver)` takes a destination address, so this is exactly what an injected message would try to change.
- Amount limits.
- Only Stackday's own contracts are allowed.
- A pending card expires after 2 minutes.
- Text from news, web pages or other bots is never treated as an instruction.
- The bot gives no personal advice. It carries out what the person asks and explains general facts.

### Where it lives

1. **Phase 1, the in-app chat** on the Stackday site, using the wallet that is already connected. About 3 to 5 days.
2. **Phase 2, an X bot that only answers questions** and replies with a link to the app, where the person checks and signs. X's rules:
   - The bot needs the "Automated" label.
   - It may reply only to people who engaged it first, at most once per interaction.
   - It may not reply to everyone who mentions a keyword.
   - AI replies need no written approval if those rules are followed.

Checked: X's developer guidelines.

### Skip

- Base mini apps: Base's docs mark them "Sunset".
- Spending permissions or session keys: these would let the bot spend without a fresh approval each time.

### Not in the anchor

This needs Justin's approval and a change to `docs/ANCHOR.md`. The closest anchor lines are the Themes layer and "borrows ... instead of selling".

**Before Dec 5:** Phase 1, limited to buy, recurring buy and show position, fits if Justin approves in the next few days. Borrow comes second. The X bot is optional.

Needs Justin:
- the anchor change;
- which AI provider and key;
- the amount limits;
- the no-advice wording;
- creating the X account.

Details: appendix D.

---

## 5. Gift stocks

**It works without changing the vault.** Checked in the code:
- Anyone may call `depositStock` on a vault.
- Anyone may call `createVault` for a person.

So a small new "gift box" contract can hold a gift and deliver it straight into the recipient's vault, creating the vault if they have none yet.

### Flow

- **Send:**
  - Pick an asset and amount from free (unlocked) holdings only, never loan collateral.
  - Enter the recipient's Stackday ID, then confirm the name and short wallet.
  - Add an optional message (stored off chain).
  - Set an expiry, 30 days by default.
  - Approve once.
- **Pending:** the gift shows in the recipient's app, with a badge and a "You have a gift to open" card on Portfolio.
- **Revoke:** the sender can take it back any time before it is claimed.
- **Decline:** the recipient can decline it.
- **Expiry:** after it expires, it goes back to the sender.
- **Claim:** only the chosen recipient can claim. It lands in their vault as free stock, not as loan collateral.
- **Fee:** none. The fee rules forbid taking from vault money.

One safety detail checked in the code: `withdraw` silently releases loan collateral when free stock is short. So the send form must cap the amount at free holdings.

### Does it work with the real tokens?

- **Apple (AAPLc):** yes, today. Holding and trading are open to anyone; identity checks happen only when the token is issued or redeemed. Two risks remain:
  - Base's docs say "Onchain policies can block specific addresses, such as sanctioned addresses; a blocked transfer reverts".
  - The same page says allowlist policies "may be implemented". If the issuer ever switches one on, sends into the gift box would fail for everyone.

  So each asset needs a "giftable" switch and a mainnet fork test. The token is also "only available to persons in eligible jurisdictions outside of the U.S."
- **S&P 500 token (deSPXA):** transfers work today, but its issuer can freeze addresses. Checked by the agent only, not re-checked by me.
- **Treasuries token (wtSGOV):** unknown. Leave it out of gifts on mainnet.

Checked on Base mainnet myself:
- the AAPLc address returns symbol "AAPLc" and precompile code `0xef`;
- Base's tokenized stocks page has the quotes above.

### Biggest real risk: legal

Sending a non-US-only token to someone Stackday has not checked. Show a clear warning in the app, and get legal advice before mainnet. The testnet demo is fine.

### Box-opening animation

1. Tap "Open".
2. The box shakes while the claim transaction is pending.
3. On confirmation the lid flies off with a glow and confetti.
4. The stock card rises out and settles.

- It takes about 2.8 seconds and can be skipped.
- It follows the real transaction, so it never shows success before the chain does.
- It has a calm fade version for people who turn motion off.
- On phones it opens as a bottom sheet.

**Tools:** the house rules forbid installing design skills from the internet, so nothing new gets installed.
- Use pure CSS and Tailwind animations, building on the keyframes the site already has (`rise`, `pop`, `fade`, `shimmer` in `globals.css`).
- Optionally add `canvas-confetti` (about 4 KB, ISC license) for the burst.
- Use the built-in `frontend-design` skill for design guidance.
- Lottie or Rive only if a designer makes a custom animation file. Skip 3D (Three.js): it is heavy and limits upgrades.

**Where it lives:** a new `/gifts` page with Received and Sent tabs, a "Gift" action on each holding, "Gifts" in the menu and a badge. No new top tab.

### Before Dec 5

**It does not fit.** The estimate is 12 to 13 working days. Only 10 are left (Monday Nov 23 to Friday Dec 4; Dec 5 is a Saturday). A new contract also needs an agreed issue first, and only Justin can deploy it. Plan it for after the hackathon. The draft issue is ready in appendix E, section 2.3, so it can start the day he agrees.

Needs Justin:
- approval as a supporting feature, with the anchor and ANCHOR.md change;
- agreeing the issue;
- confirming no fee;
- the legal wording;
- deploying the contract.

---

## What to decide first

| # | Topic | Fits before Dec 5? | Contract change? | In the anchor? |
|---|---|---|---|---|
| 1 | Lending revenue | Nothing to build; tell the story | No (the protection keeper later: yes) | Yes (fees, borrowing) |
| 2 | Repetition and confusion | **Yes**, steps 1 to 8 | No | Yes |
| 3 | Research automation | **Yes**, the small missing parts | No | Yes (Themes layer) |
| 4 | Text to buy and borrow | In-app chat MVP if approved this week | No | **No**, needs an anchor change |
| 5 | Gift stocks | **No**, after the hackathon | **Yes**, new contract | **No**, needs an anchor change |

**Time check:** 10 working days are left (Nov 23 to Dec 4), and the submission video and form still have to be made. Rough sizes:
- UX fixes 1 to 8: about 3 to 4 days.
- The research gaps (selected stocks, retry guard, banner): about 2 days.
- The chat MVP: 3 to 5 days.

That is 8 to 11 days, so all three will not fit with the submission.

My recommended order:
1. Item 2 (the UX fixes).
2. Item 3's gaps.
3. Item 4 only as a small demo, and only if Justin approves it this week.
4. Item 5 after the hackathon.
5. Item 1 is a sentence in the submission plus a later issue.

**Grok plan (answered 2026-11-22):** X Premium+ only, so there is no programmable Grok. Item 3 posts nothing on X for now, and item 4 uses Claude inside the app.
