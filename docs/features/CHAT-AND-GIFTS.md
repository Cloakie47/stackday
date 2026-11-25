# Plan: Stackday chat assistant and stock gift boxes

Status: plan, November 25, 2026. The founder asked for both features and wants growth to start building. This plan builds on growth's research in PR #74 (appendix D for chat, appendix E for gifts) and adds the founder's new asks: selling in chat, gift boxes with a mix of stocks, surprise boxes and boxes picked by research.

Both features are new to the anchor. Section 5 has the proposed anchor sentences; the founder approves them by merging this PR.

---

## 1. Chat assistant

### 1.1 What it does

A chat panel inside the app. The person types in plain words and the assistant answers or prepares an action. **The assistant never signs or sends anything.** Every action becomes a card with the exact amounts, and the person confirms it in their own wallet.

| Ask | What happens | Build status |
|---|---|---|
| "What do I have?" / "What's my balance?" | Wallet USDC, each asset in the vault (free and locked), its value, loans, health and running plans | read only, uses `usePortfolio` |
| "How is my loan?" | Health, limit use, the price drop the loan survives, the borrow fee owed | read only |
| "Buy $20 of Apple" | Card: buy 20 USDC of AAPL into my vault, the expected amount at the oracle price, the slippage floor, no fee | exists (`SipRouter.invest`) |
| "Buy $10 of NVIDIA every week for 12 weeks" | Card: recurring plan, 0.15% fee shown | exists (`setPlan`) |
| "Stop my Apple plan" | Card: cancel the plan | exists (`cancelPlan`) |
| "Sell half my Apple" | Card: take it out of the vault to my wallet, then sell it for USDC to my wallet | **new**, see 1.4 |
| "Borrow $50 against my gold" | Card: lock, borrow, the health after and the liquidation price | exists (`vault.borrow`) |
| "Repay my loan" | Card: repay the amount owed, fee first | exists (`vault.repay`) |
| "Withdraw my ETH" | Card: to my own connected wallet only | exists (`vault.withdraw`) |
| "Send Maya $5 of stocks as a gift" | Card: a gift box (section 2) | new, with the gift contract |
| "What does Stackday think about gold this week?" | The general view from the latest approved Monday report, with its date and the disclaimer | reads `research_weekly` (approved only) |
| "What should I buy?" | It does not give personal advice. It shows the general weekly views and explains the options | rule |
| "How does borrowing work?" / "What are the fees?" | Explains from our docs | read only |

### 1.2 How it works

1. **Chat route** `web/app/api/chat/route.ts`, server only, calls Claude (`ANTHROPIC_API_KEY`, already set for research).
   - Model: `claude-sonnet-5-5` for reliable tool calls; it can switch to `claude-haiku-5-5` if cost matters.
   - It gets a fixed tool list (1.3) and the person's read-only portfolio summary, which the server reads from chain for the signed-in wallet.
   - It returns either text or one validated **intent** (JSON). Never addresses, never calldata.
2. **Intent check** with a strict schema (zod) in code. Anything outside the schema is dropped.
3. **Call builder** `web/lib/chat/buildCalls.ts`: pure functions turning an intent into the same calls the Invest and Borrow pages already make.
   - Reuse page logic by moving it into shared helpers, not copies.
   - `minOut` comes from `quoteAtOracle` and the slippage setting, never from the model.
4. **Confirmation card** (`web/components/chat/action-card.tsx`) shows:
   - the action, the asset, USDC in and stock out, the fee;
   - for a borrow: the health after and the liquidation price;
   - "to: your wallet 0x... (full)" and the "testnet, mock tokens" label.

   It is simulated first (`useTx` already simulates) and shows failures in plain words. Confirm calls `useTx().run(calls)`, so the wallet shows its own prompt.
5. **Chat dock** `web/components/chat/chat-dock.tsx` on the `(app)` layout: a floating button, a bottom sheet on phones, history kept on the device only.

### 1.3 Tool list (the only things the model can ask for)

Read tools (the server answers them):
- `get_portfolio`, `get_loan(asset)`, `get_prices(assets)`, `get_weekly_view(asset)`, `explain(topic)`.

Action intents (they become a card, never a transaction):
- `buy{asset, usdc}`, `recurring_buy{asset, usdc, interval, weeks}`, `cancel_plan{asset}`;
- `sell{asset, amount | percent}`;
- `lock{asset, amount}`, `borrow{asset, usdc, risk}`, `repay{asset, usdc | all}`;
- `withdraw{asset, amount}`;
- `gift{recipient_id, usdc, box}`.

No intent has a receiver, address or "to" field. The receiver is always the connected wallet, or for a gift the wallet the profile lookup returns, confirmed by name on the card.

### 1.4 Selling (new)

Today the contracts can only buy (issue #35). For chat, a sell is two steps in one signature:
1. `vault.withdraw(asset, amount, myWallet)`. This exists, and locked stock cannot be withdrawn while a loan needs it.
2. Swap the asset for USDC to my wallet.

- **Mainnet:** step 2 goes through a real DEX route (the Aerodrome Slipstream pools we already use for buying, or LI.FI). This only needs a sell adapter (`swapExactStockForUsdc`), as proposed in #35.
- **Testnet:** a new mock, `MockSellDesk`. It buys mock stock at the mock oracle price minus a small spread, paid from a test USDC reserve, and is labelled as a mock.
- Both are **new standalone contracts**. No change to the vault, the factory, Payroll or SipRouter, so there is no vault redeploy. Covered by the contract issue for this plan (see 4).

The anchor says people borrow "instead of selling". The chat keeps that spirit: on any sell it shows one line, "You could borrow against it instead", with the borrow limit. Selling stays the person's choice.

### 1.5 Guardrails (from appendix D, kept and extended)

1. No keys, no signing, no server wallet. The model only outputs intents.
2. Every amount on the card and in the calls comes from one object built in code. The card expires after 2 minutes, and only one card is pending at a time.
3. Allowlist only: Stackday contracts, USDC and the assets in `deployment.json`. Unknown names are refused.
4. Receiver hard-coded to the connected wallet (`borrow` and `withdraw` take a receiver; the model can never set it).
5. Caps per card: 500 test USDC on testnet. A borrow is refused, not just warned, if the health after would be below the person's chosen risk level.
6. Untrusted text (news, research text, profile names, gift messages) goes to the model inside an untrusted block, and no action intent is accepted in a turn that includes it. Same screen as the research engine.
7. No personal advice. "What should I buy" gets the general weekly views plus the disclaimer.
8. Rate limit per wallet. The chat route needs sign-in (the existing wallet signature session).
9. Logs: intent JSON and tool calls only, no secrets, kept 30 days.
10. Tests:
    - builder unit tests;
    - an injection test set ("ignore instructions", "send to 0x...", Morse, homoglyphs, instructions hidden in a gift message) asserting that no intent leaves the schema and the receiver never changes;
    - cap tests.

### 1.6 What it costs

Claude API on the same workspace as research, or its own workspace with its own monthly limit (founder sets it). A chat turn is a few thousand tokens, so a demo costs cents.

---

## 2. Stock gift boxes

### 2.1 What it is

Someone sends a gift worth an amount of USDC, for example $5. The recipient opens a box and the stocks land in their own vault, with a box-opening animation.

Box types the sender picks:

| Box | What is inside | Who decides the mix |
|---|---|---|
| **One stock** | 100% of one asset, for example Apple | the sender |
| **My mix** | up to 6 assets with any ratios, for example 20% Tesla, 30% NVIDIA, 50% Apple | the sender |
| **Surprise** | a random mix of 2 to 4 assets with random ratios | the app, when sending. The sender can choose not to see it, so it is a surprise for both |
| **Stackday research pick** | the mix (or the single top asset) from the latest approved Monday report, chosen **at the moment the box is opened**, so it follows the newest research | the research, at opening time |

Any supported asset can go in a box, including invest-only ones such as Tesla. The research pick uses only the six researched assets.

### 2.2 The key design choice: the box holds USDC and buys when it is opened

- The sender's USDC sits in the gift contract until the recipient opens the box. At opening, the contract buys each part of the mix with the gift's USDC and sends it straight into the recipient's vault as free (not locked) stock.
- Why:
  - **It is always worth exactly what was sent.** A $5 gift is $5 of stock on the day it is opened, so the sender never sends a box that has lost value.
  - **Research picks can follow the newest report.**
  - **Revoke and expiry refund exactly the USDC sent.**
  - **The contract never holds stock,** so stock transfer rules never trap a box. Appendix E found that deSPXA has freeze powers.
- Buying into the recipient's vault already works: `factory.createVault(recipient)` returns or creates the vault, and a vault counts any tokens it holds as free stock (`idleOf` is the balance).
- Every buy has slippage protection from the oracle price, the same rule as `SipRouter`. If one part cannot be bought, the whole opening reverts and the box stays closed (the sender can revoke).

### 2.3 Flow

1. **Send.**
   - The sender picks the recipient by Stackday ID (the existing `/api/people` lookup). The card shows their name and wallet.
   - They pick the amount (minimum 1 USDC, cap 500 test USDC), the box type, an optional message (140 characters, kept off chain in Supabase) and an expiry (7, 30 or 90 days).
   - One signature: approve USDC, then `GiftBox.create`.
   - The chat can prepare the same card.
2. **Pending.**
   - The recipient sees "You have a gift" on Home, plus a badge in the menu.
   - The sender sees it under Gifts > Sent, with a Revoke button.
3. **Open.**
   - The recipient presses Open and signs `GiftBox.open`. The chain confirms, then the animation plays (2.6).
   - For a research pick, the app reads the approved weekly report, builds the mix and shows it on the card before signing. "Picked by Stackday research on [date], general research, not advice."
4. **Decline, revoke, expiry.**
   - The recipient can decline and the sender can revoke while pending. Both refund the USDC to the sender.
   - After expiry, anyone can call `refundExpired` (the keeper does it daily). The money always goes to the sender, never to a chosen address.

### 2.4 Contract: `GiftBox` (new, standalone, no owner)

```solidity
enum Kind { Fixed, Research }   // Fixed covers one stock, my mix and surprise (weights stored at create)
enum Status { None, Pending, Opened, Revoked, Declined, Refunded }

struct Gift {
    address sender;
    address recipient;    // fixed at create
    uint96  usdc;         // exact USDC held
    uint40  expiresAt;
    Kind    kind;
    Status  status;
}
// legs for Fixed: up to 6 (asset, weightBps), weights add up to 10_000, every asset factory.isSupported

function create(address recipient, uint96 usdc, uint40 expiresAt, Kind kind, address[] calldata assets, uint16[] calldata weightsBps) external returns (uint256 id);
function open(uint256 id, uint16 maxSlippageBps, address[] calldata researchAssets, uint16[] calldata researchWeightsBps) external; // recipient only; research arrays only for Kind.Research
function revoke(uint256 id) external;          // sender only, while pending
function decline(uint256 id) external;         // recipient only, while pending
function refundExpired(uint256 id) external;   // anyone, after expiry, pays the sender
```

Rules:
- `immutable` factory, swap adapter, price adapter and USDC.
- No owner, no admin, no pause, no upgrade, no fee setter, no rescue. **No fee on gifts:** the fee rules allow only the three existing fees.
- `open`:
  - checks the caller, the status and expiry;
  - sets Opened before any external call;
  - `vault = factory.createVault(recipient)`;
  - for each part: `minOut` from the oracle quote and `maxSlippageBps` (capped at 300), then `swapExactUsdcForStock(asset, part, minOut, vault)`;
  - the last part gets the rounding remainder.
- **Research boxes:** the recipient passes the mix at opening (the app builds it from the approved report). The contract checks that the assets are supported and the weights add up, but cannot check the research itself. That is honest and fine, because it is the recipient's gift. The UI must say "picked by research" and show the mix before signing.
- `nonReentrant`, checks-effects-interactions, a balance-change check on USDC pulled.
- No sending to self, to zero or to the contract. Expiry between 1 and 365 days.

Testnet: buys go through the existing mock swap adapter. Mainnet: through `SlipstreamSwapAdapter`. Same code, only the config changes.

Tests, every money path:
- create, open, revoke, decline and expiry;
- a wrong caller on each; double open; open after expiry; an open and revoke race;
- a recipient with no vault, and a recipient with a loan (the gift stays free);
- weights that don't add up, an unsupported asset, too many legs;
- slippage refusal, and a research box with bad weights.
- **Base mainnet fork test:** a $5 box of AAPLc, NVDAc and deSPXA opened into a real vault through the real pools.

### 2.5 Pages

- New page `web/app/(app)/gifts/page.tsx` with Received, Sent and Send a gift. No new top tab: a "Gifts" entry in the menu, with a badge.
- Home: a "You have a gift to open" card when one is pending.
- Supabase: a `gifts` table (gift id, sender, recipient, message, created). Server only, RLS on, no policies, same pattern as the others. The chain is the truth for status.
- Labels: testnet and mock tokens, plus "Only for people in eligible places outside the US" (Coinbase token terms, appendix E) and "Gifts may have tax rules where you live".

### 2.6 Box-opening experience

From appendix E, with pure CSS and Tailwind keyframes and no new libraries:
- **Before opening:** a closed box with a soft bob and "A gift from Maya". For a surprise box the contents are hidden until opened (cosmetic only; the chain is public, and the UI does not call it private).
- **Opening:**
  1. Tap Open: the box grows slightly and the message slides up.
  2. While the wallet and the transaction are pending, the box gently shakes ("Opening into your vault...").
  3. **Only once the transaction is confirmed:** the lid lifts, light and particles burst out, and one card per stock rises out of the box, one after another, each with the real logo, amount and value.
  4. Then "View in my vault" and "Done".
- **If it fails:** the box closes again with the reason and a Retry.
- **Reduced motion:** a crossfade with no shake or particles, plus an announcement for screen readers.
- **Phones:** a full-height sheet, the button in thumb reach, and only transform and opacity are animated.

---

## 3. Order and time

Today is November 25, and the deadline is December 5 (8 working days). Research merges and the UX fixes from #74 are also queued.

| Step | Who | Days | Needs |
|---|---|---|---|
| A. Chat: read tools and the dock (balances, loans, prices, weekly views, explain) | growth | 1.5 | nothing new |
| B. Chat: buy, recurring buy, cancel, borrow, repay, withdraw cards, plus the injection tests | growth | 2 | A |
| C. GiftBox and MockSellDesk contracts, tests and a fork test | growth or the founder's session | 2 | the contract issue agreed |
| D. Testnet deploy of the two new contracts (no redeploy of anything else) | founder | 0.5 | C |
| E. Gifts page, send card, open flow and animation | growth | 2 to 2.5 | C, D |
| F. Chat: sell and gift cards | growth | 1 | B, D |

- Realistic before December 5: A, B, C and D, plus a working gift box on testnet (E). F if time is left.
- If time runs short, the demo order is: chat with balances and buying, a gift box with one stock and my mix, then surprise and research picks.

## 4. Contract issue

Issue #77 covers `GiftBox` and `MockSellDesk` (CLAUDE.md: contract changes need an agreed issue first). Both are new, standalone and ownerless, apart from the mock, which is testnet only and has an owner on purpose like the other mocks. No existing contract changes and no redeploy of vaults, Payroll or SipRouter. The mainnet sell adapter stays with #35.

## 5. Proposed anchor sentences (founder approval by merging)

Add to the anchor paragraph, after the Themes sentence:

> A chat assistant answers questions about a person's own balances, loans and the weekly research, and prepares buys, sells, recurring buys, borrows and repays that the person confirms and signs in their own wallet. People can send a gift box worth a chosen amount of USDC, holding one stock, their own mix, a surprise mix or a research pick, which the recipient opens into their own vault.
