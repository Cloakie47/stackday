> Checked on 2026-11-21: `depositStock` and `createVault` can be called by anyone, `withdraw` releases collateral when free stock is short, AAPLc on Base mainnet (symbol AAPLc, code `0xef`), and the Base B20 page quotes (blocked transfers revert, KYC only at mint and redeem, eligible jurisdictions outside the U.S.). The deSPXA freeze finding was not re-checked.

# Gift Stocks for Stackday: design, contract sketch, mainnet check, animation

Date of research: November 21, 2026. Nothing in the repo was edited, nothing was installed, no transaction was sent. The only on-chain actions were read-only `eth_call` simulations against the public Base RPC (https://mainnet.base.org).

Marks: **[VERIFIED]** I checked it myself in the repo or on chain. **[SOURCED]** from a primary page with URL and quote. **[UNVERIFIED]** from memory or secondary sources, check before relying on it.

---

## 0. Short answer

- Feasible without touching `EmployeeVault` or `VaultFactory`: a new standalone `GiftEscrow` contract. No vault redeploy. **[VERIFIED]** (`depositStock` is callable by anyone, `createVault(employee)` is callable by anyone and returns the existing vault if there is one.)
- Not in the anchor paragraph. It needs founder approval and a new row or a "supporting feature" note in `docs/ANCHOR.md` before any build (CLAUDE.md: every feature must map to a sentence in the anchor, attendance is the precedent for a "supporting feature").
- A new contract needs an agreed GitHub issue first. Draft issue text is in section 2.
- Mainnet transfer check (the critical item): for AAPLc and deSPXA, transfers to a plain address and to a contract address are **not** gated by an allowlist today. A policy can still block specific addresses and the issuers keep admin power. Details in section 3.
- Biggest real risk is legal, not technical: the Coinbase tokens are for non-US persons only, and a gift sends them to a person Stackday cannot check. See section 4.
- Animation: recommend pure CSS (the repo already has Tailwind v4 keyframes and a global reduced-motion rule), zero new dependencies.
- Fits before December 5 (14 days from today) only if scoped as testnet-first, minimal contract, and the founder decides within a few days. See section 7.

---

## 1. Flow design

### 1.1 Send

1. Where it starts: a "Gift" button on a holding row in Portfolio, or the Gifts page.
2. Asset and amount: only from **free (idle, unlocked)** holdings. In the web app `usePortfolio` already splits `idle` from `collateral` per asset **[VERIFIED]** (`web/lib/usePortfolio.ts`). The picker's maximum is `idle`, never `idle + collateral`. Collateral can never be gifted.
   - Why the UI cap matters: `EmployeeVault.withdraw` will quietly release collateral if idle is not enough **[VERIFIED]** (`src/EmployeeVault.sol`, lines near 181). So the UI must cap the amount at `idleOf(token)`, and the transaction simulation (useTx already simulates first) is the second guard.
   - The gift can also come from the sender's wallet (tokens not in the vault). Same escrow call.
3. Recipient: type a Stackday ID (`SD-XXXXXXXX`). Reuse `GET /api/people` which already searches by ID and returns wallet, uid, username **[VERIFIED]** (`web/app/api/people/route.ts`). Show name plus a short wallet and ask the sender to confirm "Send to Maya (SD-7K3F9Q2M, 0x12ab...9f)". The wallet is fixed into the gift at that moment.
4. Optional message: short plain text (for example 140 characters). Kept off chain in Supabase, not in the contract (on-chain text is public forever and cannot be edited).
5. Expiry: choose 7, 30 (default) or 90 days. Contract bounds: 1 day minimum, 365 days maximum.
6. Transactions: if the gift comes from the vault it is three calls: `vault.withdraw(token, amount, senderWallet)`, `token.approve(escrow, amount)`, `escrow.create(...)`. The repo already has a batching helper (`web/lib/batch.ts`) **[VERIFIED the file exists, not read in detail]**; use one wallet confirmation where the wallet supports batched calls, otherwise three confirmations. Then the app saves the message and gift id in Supabase.

### 1.2 Pending

- Chain is the truth for status (Pending, Claimed, Revoked, Refunded, Declined). Supabase holds only the index (who to notify) and the message.
- Sender sees it under Gifts, tab "Sent", with "Pending, expires in 12 days" and a Revoke button.
- Recipient sees it in the app (section 6) as a closed box.

### 1.3 Revoke, decline, expiry

- **Revoke**: sender only, any time while Pending. Tokens go back to the sender's wallet (not the vault, because the sender might have no vault; the UI then offers "Put back in my vault").
- **Decline**: recipient only, while Pending. Same refund to the sender. This lets a recipient clear unwanted gifts (spam control).
- **Expiry**: after `expiresAt` the recipient can no longer claim. Anyone can call `refundExpired(id)` and the tokens go to the sender. A contract cannot act by itself, so "auto-refund" means: the existing keeper bot (`/api/keeper`, a daily Vercel cron **[VERIFIED in CLAUDE.md]**) calls `refundExpired` for old gifts, and the sender can also press Revoke. The refund destination is fixed (the sender), so letting anyone trigger it is safe.
- Race between claim and revoke: first transaction wins, the second reverts with a clear error. The UI refreshes status and says so.

### 1.4 Claim

1. Recipient connects the wallet that the gift is bound to. If the connected wallet is another one, show "This gift is for the wallet 0x12ab...9f, switch wallet."
2. Press "Open". Contract checks the caller is the stored recipient and the gift is Pending and not expired.
3. The escrow calls `factory.createVault(recipient)` (returns the existing vault, or creates it at its deterministic address), approves the exact amount, calls `vault.depositStock(token, amount)`, and resets the approval to zero. Result: the tokens land in the recipient's own vault as free stock.
4. A recipient with no vault yet is handled by step 3 with no extra work. The vault is created in the same transaction. The recipient pays that gas (a vault clone is cheap on Base). The recipient still needs a Stackday profile only to see the gift in the app, not to claim it on chain.

### 1.5 Edge cases

| Case | Behaviour |
|---|---|
| Recipient never signs up | No profile means no ID, so you cannot send to them by ID. If they signed up and never open it, the gift expires and returns to the sender. |
| Wrong person chosen | Sender confirms name and wallet before sending, and can revoke until it is claimed. Once claimed, it is final. Say so in the confirm step. |
| Asset becomes unsupported | `VaultFactory` is immutable, so the supported list cannot shrink **[VERIFIED]**. A future new factory would be a new deployment; old gifts could then fail to claim, and the sender revokes. Escrow checks `isSupported` at create and the vault checks it again at claim. |
| Token blocks the recipient or the escrow (issuer policy, sanctions) | Claim reverts. Sender can still revoke or wait for expiry, unless the sender is blocked too. Cannot be fixed by us. |
| Recipient's vault has a loan | The gift arrives through `depositStock`, which is explicitly free, not collateral **[VERIFIED]** (founder decision, issue #29). It does not change the loan. The person can lock it later on Borrow. |
| Dividends while in escrow | Real tokens pay dividends through a multiplier that raises the value of each token, balances stay the same (Base docs and `docs/PLAN.md`). So the recipient gets the higher value when they open the box. There is nothing to forward. Testnet mocks pay none. If a token ever changed balances on its own (rebasing) the escrow would break, so the contract checks that exactly `amount` arrived and reverts otherwise. |
| Sending to self | Blocked in the UI and in the contract (`recipient != msg.sender`). |
| Sending to the escrow or zero address | Blocked in the contract. |
| Same asset gifted twice | Each gift has its own id, no clash. |
| Message abuse | Plain text only, length limit, rendered escaped, shown only to the recipient, and the recipient can decline. |

### 1.6 Fees

No fee. The fee rules list exactly three fees (SIP, borrow, earn) and say "never take from money in a vault or collateral, never add a way to change a fee" **[VERIFIED]** (CLAUDE.md). A gift is money leaving the vault, so a gift fee would break that rule. A new fee would also need an explicit founder decision (the 20 bps cap and the immutability rule still apply). Recommendation: free, and mention "no Stackday fee" in the UI. The sender and recipient only pay network gas.

---

## 2. Contract sketch and draft issue

Interface only. No code to be committed from this document.

### 2.1 Interface

```solidity
interface IGiftEscrow {
    enum Status { None, Pending, Claimed, Revoked, Refunded, Declined }

    struct Gift {
        address sender;      // who funded it, only address that can revoke
        address recipient;   // wallet fixed at send time, only address that can claim or decline
        address token;       // must be factory.isSupported(token)
        uint96  expiresAt;   // claim allowed while block.timestamp < expiresAt
        uint256 amount;      // exact amount received by the escrow (checked)
        Status  status;
    }

    // immutable: VaultFactory factory;  (no owner, no admin, no pause, no upgrade, no fee)

    function create(address recipient, address token, uint256 amount, uint96 expiresAt) external returns (uint256 id);
    function claim(uint256 id) external;          // msg.sender == recipient
    function revoke(uint256 id) external;         // msg.sender == sender, any time while Pending
    function decline(uint256 id) external;        // msg.sender == recipient
    function refundExpired(uint256 id) external;  // anyone, only after expiresAt, pays the sender
    function giftOf(uint256 id) external view returns (Gift memory);
    function nextId() external view returns (uint256);

    event GiftCreated(uint256 indexed id, address indexed sender, address indexed recipient, address token, uint256 amount, uint256 expiresAt);
    event GiftClaimed(uint256 indexed id, address indexed recipient, address vault);
    event GiftRevoked(uint256 indexed id, address indexed sender);
    event GiftDeclined(uint256 indexed id, address indexed recipient);
    event GiftRefunded(uint256 indexed id, address indexed sender);

    error ZeroAmount(); error ZeroAddress(); error SelfGift(); error UnsupportedToken(address);
    error BadExpiry(); error NotPending(); error NotRecipient(); error NotSender();
    error Expired(); error NotExpired(); error AmountMismatch();
}
```

Storage: `mapping(uint256 => Gift) gifts; uint256 nextId; VaultFactory immutable factory;`. Nothing else. No per-user arrays (the app lists gifts from events plus the Supabase index).

### 2.2 Logic rules

- `create`: checks `recipient != 0`, `recipient != msg.sender`, `recipient != address(this)`, `amount > 0`, `factory.isSupported(token)`, expiry between now + 1 day and now + 365 days. Pull with `safeTransferFrom(msg.sender, this, amount)`, compare balance before and after, revert `AmountMismatch` if it differs (guards fee-on-transfer or rebasing tokens). Set status Pending, emit event.
- `claim`: caller must be the stored recipient, status Pending, `block.timestamp < expiresAt`. Set status Claimed **before** any external call. `vault = factory.createVault(recipient)`, `forceApprove(vault, amount)`, `EmployeeVault(vault).depositStock(token, amount)`, `forceApprove(vault, 0)`. Claim binds to the **wallet** chosen at send time; the vault address is derived from that wallet by the factory (deterministic), so the sender cannot redirect it and nobody else can claim.
- `revoke`, `decline`, `refundExpired`: set status first, then `safeTransfer` to `gift.sender`. The refund address is always the sender, never a caller-supplied address, so no function lets anyone choose where funds go.
- Reentrancy: `nonReentrant` on every state-changing function plus checks-effects-interactions (status set before transfers). The `depositStock` call goes into our own vault code, which is itself `nonReentrant` **[VERIFIED]**.
- Governance: no owner, no admin, no pause, no upgrade proxy, no fee setter, no rescue function. This matches the product rule "no admin or owner function may move funds" (written for vaults, apply it here too). Consequence: tokens sent to the escrow by mistake (not via `create`) are stuck. Accept that, and say so.
- Token behaviour: B20/ERC-20 only, measured by balance change; no ETH.
- Tests needed (CLAUDE.md "tests on every money path"): create/claim/revoke/decline/expire; wrong caller on each; double claim; claim after expiry; claim race with revoke; recipient with no vault; recipient with a loan (gift stays idle); fee-on-transfer mock reverts; unsupported token; self gift; plus a **Base mainnet fork test** with real AAPLc and real deSPXA through the escrow into a vault (same pattern as `test/fork/BaseMainnetFork.t.sol`, `test/fork/SpxMorphoFork.t.sol`).

### 2.3 Draft GitHub issue

> **Title:** GiftEscrow: send a free stock position to another Stackday user (needs founder approval)
>
> **Status:** proposal. Gift Stocks is not in the anchor paragraph. Needs a founder decision and a `docs/ANCHOR.md` update (supporting feature, like attendance) before work starts.
>
> **Why:** People want to give a stock to a friend or a team member by Stackday ID. It grows the number of vaults and uses only existing parts.
>
> **Scope (contract):** one new contract, `GiftEscrow`, standalone. No change to `EmployeeVault`, `VaultFactory`, `Payroll` or `SipRouter`, so no vault redeploy. The new address goes into the deployment file (founder only touches the official one).
>
> **Behaviour:**
> - `create(recipient, token, amount, expiresAt)`: sender locks free tokens in escrow. Only assets with `factory.isSupported` allowed. Recipient wallet is fixed at this moment.
> - `claim(id)`: only the recipient wallet. The escrow calls `factory.createVault(recipient)` then `vault.depositStock`. Tokens arrive as free stock, never collateral.
> - `revoke(id)`: only the sender, any time before claim. `decline(id)`: only the recipient. `refundExpired(id)`: anyone, after expiry, always pays the sender.
> - No owner, no admin, no pause, no upgrade, no fee. Cannot move anyone's funds except by these rules.
>
> **Off chain (web):** Gifts page, pending badge, optional 140 character message in Supabase (new table `gifts`, server-only, same RLS pattern as other tables), box-opening animation (CSS only, no new dependency).
>
> **Out of scope:** fees, gifting collateral, gifting USDC, bulk gifts, mainnet deployment (founder only).
>
> **Safety and tests:** reentrancy guard, checks-effects-interactions, balance-delta check, tests on every path listed above, plus a mainnet fork test with real AAPLc and deSPXA.
>
> **Open questions for the founder:** (1) approve as a supporting feature? (2) US-person warning wording (see legal note). (3) testnet only for the hackathon demo, yes or no. (4) default expiry 30 days ok?
>
> **Acceptance:** `forge test` green, fork test green, ANCHOR.md row added, UI labelled as testnet, no em dashes in copy.

---

## 3. CRITICAL: do the real mainnet tokens allow wallet to escrow to vault transfers?

Which tokens Stackday targets on mainnet **[VERIFIED in repo]**: Coinbase tokenized stocks (AAPLc `0xb200000000000000000000C2e324d24d7eEcd1fb`, also NVDAc, GOOGLc, METAc, SPCXc...), cbBTC, WETH, PAXG, "deSPXA" `0x9c5C365e764829876243d0b289733B9D2b729685`, and wtSGOV (a README stand-in; no real address in the repo).

**Correction to the brief:** deSPXA is not a Dinari dShare. On chain its name is "S&P 500 DeFi (Centrifuge)", symbol deSPXA **[VERIFIED by `cast call name()`]**. It is a Centrifuge token. Backed xStocks and Dinari dShares are not in Stackday's asset list, so they matter only if the team adds them later. Dinari result is still given below for completeness.

### 3.1 Coinbase tokenized stocks (AAPLc and siblings), B20 standard

- Source: https://docs.base.org/specifications/b20/tokenized-stocks-on-base
  - Policies exist: "Policies determine whether a transfer is allowed or rejected." (Policies section)
  - Blocklists exist: "Onchain policies can block specific addresses, such as sanctioned addresses; a blocked transfer reverts" (Compliance section)
  - KYC is only at issuance: "KYC only happens during mint and redeem flows taken by Authorized Participants" (Compliance section). Paraphrase-grade quote, check the page wording.
  - Eligibility: "only available to persons in eligible jurisdictions outside of the U.S." (Disclaimer)
  - Policy types: allowlist and blocklist policies "may be implemented" (Policies section). The page does not say which policy AAPLc has today.
  - Transfers during corporate actions are not paused: "the token is not paused onchain, so transfers are not blocked." (Price Feeds section)
  - Admin power: no timelock ("the B20 standard has no built-in timelock") and the issuer controls token settings. The page does not mention freeze or seize.
- Source code cannot be read: the AAPLc address returns the bytecode `0xef` on Base **[VERIFIED by `cast code`]**. That is a native precompile, not a deployed contract, so basescan/blockscout have no source to read. (Blockscout API also returned 403 to my fetch.)
- Live test (read-only simulation on Base mainnet, today) **[VERIFIED]**:
  - `transfer(0x2222...2222, 1)` simulated from the Morpho contract (holds about 36 AAPLc, 8 decimals) returned `true`. That is a plain address that has never held the token and is not a member of anything.
  - Same transfer to a contract address (the USDC contract) returned `true`.
  - Transfer to the zero address reverts (normal ERC-20 rule).
- Conclusion for AAPLc: **a transfer to an arbitrary address or contract works today, so wallet to escrow to vault should work.** Residual risks: the policy is changeable by the issuer, a sanctioned address (sender, escrow or recipient vault) would revert, and I could not read freeze or seize powers (**[UNVERIFIED]**). Fork tests already show a contract vault can hold AAPLc **[VERIFIED]** (`test/fork/BaseMainnetFork.t.sol`), and Morpho (a contract) holds it.
- Other Coinbase stock tokens: assumed to use the same B20 standard and policy model **[UNVERIFIED individually]**. Run the same simulation per token before listing it for gifts.

### 3.2 deSPXA (Centrifuge deRWA token)

- On chain **[VERIFIED]**: it is a normal contract (not a precompile) with 18 decimals and a `hook()` pointing to `0x2a9B9C14851Baf7AD19f26607C9171CA1E7a1A61`. The token has `checkTransferRestriction(address,address,uint256)`. The hook contract has `isMember`, `isFrozen`, `updateMember`, `freeze` and `updateRestriction` selectors, meaning **the issuer can in principle freeze addresses and maintain a member list**.
- Live test **[VERIFIED]**: `isMember` is false for both Morpho and a random address, `isFrozen` is false for a random address, `checkTransferRestriction` returned `true` for Morpho to a random address, and a simulated `transfer` from Morpho to a random address returned `true`. So **today a non-member can receive it** and the member list is not enforced for transfers.
- Source (secondary, **[UNVERIFIED]**): DefiLlama lists the access model as permissionless, and search results say it is aimed at non-US users and that mint and redeem is restricted to authorized participants. Centrifuge's own blog (https://centrifuge.io/blog/despxa-on-base) returned 403 to my fetch, so I have no primary quote on holder eligibility.
- Conclusion: wallet to escrow to vault works today. Because a freeze function exists, a frozen escrow could trap pending gifts (small tail risk, the sender could not revoke either).

### 3.3 wtSGOV (0 to 3 month Treasuries)

- I could not confirm the real address or issuer from the repo. A search hit points to a Base address `0x3aa880d06fa191581762976a0e0d1a2ecae3874e` and an issuer "ST0x", but when I called it, it behaved like a DEX pair contract, not a token, so that lead is probably wrong. **[UNVERIFIED]**.
- WisdomTree's own tokenized funds use whitelist oracles and are listed as "Permissioned" on DefiLlama **[UNVERIFIED, secondary]**. If wtSGOV were a WisdomTree token it would likely fail for non-whitelisted escrow or recipients. Recommendation: **do not allow gifts of invest-only fund tokens (wtSGOV) on mainnet until the transfer rules are verified from the contract.** On testnet the mock is free.

### 3.4 Dinari dShares and Backed xStocks (not in the list, for reference)

- Dinari: its restrictions page only covers unsupported countries ("regretfully cannot support business activities in some countries", https://docs.dinari.com/docs/restrictions). It has no page on transfer rules. A secondary summary says wallets are checked before tokens reach a customer **[UNVERIFIED]**. Treat dShares as possibly allowlisted.
- Backed xStocks: I found no primary issuer page (docs.xstocks.fi was not returned by search). Kraken says "xStocks not available in the USA" (https://support.kraken.com/articles/xstocks-availability, secondary). Not verified; not in Stackday's list.

### 3.5 What this means

- Testnet: mocks are freely transferable, so the whole flow can be demoed.
- Mainnet: AAPLc and deSPXA pass today. Add a fork test that runs the real gift path with both tokens; this is the proof the CLAUDE.md rule asks for ("prove the real thing with fork tests"). Add a "can this token be gifted" flag in the UI per asset, default on for tokens that have a passing fork test.
- Any mainnet transaction needs the founder (CLAUDE.md safety rules). Do not run any.

---

## 4. Tax and legal, plain words (not advice, all UNVERIFIED unless stated)

- **Who may hold the tokens (important).** The Coinbase tokens are only for people in eligible places outside the US **[SOURCED]** (Base docs: "only available to persons in eligible jurisdictions outside of the U.S."). A gift lets one person hand tokens to someone Stackday has never checked. A sender or recipient in the US could break the issuer's terms. Stackday should show a clear warning at send and at open ("Only for people in eligible countries outside the US") and the founder should get legal advice before the feature goes on mainnet.
- **Gift tax.** In many countries a gift above some yearly amount must be reported by the giver, and sometimes taxed. The US annual gift-tax exclusion is about 19,000 USD per recipient for 2026 **[UNVERIFIED, check IRS]**. Other countries differ widely.
- **Cost basis.** When someone gives a stock, the receiver usually inherits the giver's original purchase price for later profit calculation (the "carryover basis" rule in the US). So the receiver can owe tax on gains that happened before they got it **[UNVERIFIED]**.
- **Dividends.** Real tokens already have fees and up to 30 percent US withholding built into the multiplier (existing app copy). That continues for the recipient. No change.
- **Records.** The app should show a gift receipt (date, asset, amount, value that day, sender, recipient) with a CSV export, like the payday log, so people can report it.
- **Is Stackday a custodian?** The escrow has no owner, so Stackday cannot touch the funds. That helps, but whether a no-owner escrow of securities-like tokens creates any duty is a lawyer's question.
- Add one line in the UI: "Gifts may have tax or reporting rules where you live. Stackday does not give tax advice."

---

## 5. Animation: box-opening reveal

### 5.1 Principle

Do not fake the reveal around a transaction. The animation must follow what really happens: the recipient presses Open, signs the claim, and only on a confirmed transaction does the box open. If the claim fails, the box stays closed and shows the error.

Honesty note: the gift's contents are public on chain (and shown in the list). A "surprise" mode can hide the asset name in the list until opened, but that is cosmetic and must not be called private. Keep it simple: show "A gift from Maya" in the list and the stock name only on open.

### 5.2 States and timing (total about 2.8 seconds after confirmation, skippable)

| State | Trigger | What the user sees | Time |
|---|---|---|---|
| closed | gift in list | Wrapped box, soft idle bob (2px, 3s loop), badge "Gift from Maya" | loop |
| ready | tap Open | Box scales to 1.04, message sheet slides up (the sender's note, if any) | 250 ms |
| waiting | wallet and transaction pending | Gentle shake loop (rotate +/-2 degrees, 600 ms), "Opening in your vault..." | until confirmed (usually 2 to 8 s) |
| burst | transaction confirmed | Lid lifts and tilts (420 ms ease-out), light rays and glow fade in (300 ms), 16 to 24 particles fly out (900 ms) | ~1.0 s |
| reveal | burst peak | Stock card rises out of the box (scale 0.8 to 1, rise 24px, 500 ms ease-out) with the real asset logo (`web/lib/asset-logos.ts`), name, amount, value, sender and message | ~0.5 s |
| settled | card in place | Box fades to 30 percent, buttons "View in my vault" and "Done" fade in | 300 ms |
| error | tx fails or rejected | Shake stops, box returns to closed, inline message with Retry | 200 ms |

- Skip: any tap on the box area after "burst" jumps to settled.
- Sound (optional, off by default): one short 300 ms sound at burst, 30 percent volume, only after a user gesture, with a mute toggle remembered in localStorage. Skip sound for the hackathon unless time is left.
- Haptics (optional): `navigator.vibrate(30)` at burst on supporting phones.

### 5.3 Reduced motion

Use the existing pattern. `web/app/globals.css` already has a global `@media (prefers-reduced-motion: reduce)` block that shrinks all animation and transition durations to near zero **[VERIFIED]**. On top of that:
- No shake, no bob, no particles, no confetti.
- Crossfade (200 ms) from the closed box to the revealed card.
- Move focus to the revealed card and announce "Gift opened: 0.5 AAPLc from Maya added to your vault" in an `aria-live="polite"` region.
- The Open button is a real `<button>` with a text label; the animation is decoration only.

### 5.4 Mobile

- Open as a full-height bottom sheet, `100dvh`, box about 60 percent of the width, centered.
- Open button at least 48 px high, in thumb reach (bottom).
- Animate only `transform` and `opacity` (GPU friendly), cap particles at 16 on small screens or low-power devices.
- No hover-only effects. Safe-area padding at the bottom.
- Light and dark theme: use existing CSS variables (`--surface`, etc.) like the rest of the app.

### 5.5 Tooling options (no new design skills installed)

Already in the repo **[VERIFIED]**: Next.js 16.4.6, React 19.3.0, Tailwind 4.3.3, existing `@theme` keyframes (`rise`, `fade`, `pop`, `shimmer`) and easing tokens, and the global reduced-motion rule. No animation library is installed (`web/package.json` has none). Next.js version differs from older docs, so read `web/node_modules/next/dist/docs/` before adding client components (rule in `web/AGENTS.md`).

License and version from `npm view` **[VERIFIED]**; bundle sizes are from memory **[UNVERIFIED]**, measure with `npm run build` before choosing.

| Option | License | Approx. bundle (gzip, unverified) | Effort | Fit with Next 16 / React 19.3 |
|---|---|---|---|---|
| Built-in `frontend-design` skill guidance | Part of Claude Code, nothing to install | 0 KB | Guidance only, helps choose look and motion style | Fits. It is guidance, not a package. Use it during the build. |
| Pure CSS / Tailwind keyframes (3D transform box, CSS particles) | none | 0 KB | About 1.5 to 2 days, full control | Best fit. Same system as existing animations, reduced-motion handled globally. |
| Framer Motion / `motion` 14.14.0 | MIT | ~5 KB with LazyMotion `m`, ~35 KB full | About 1 to 1.5 days, nice sequencing | Peer React `^18 || ^19` ok. Needs `"use client"`. Adds a dependency for little gain over CSS here. |
| Lottie: `lottie-web` 5.13.0 or `@lottiefiles/dotlottie-react` 0.22.3 | MIT (library); animation file license varies | lottie-web ~50 to 80 KB; dotLottie player loads a WASM file (large, ~100s of KB) | 1 day if you find a free box animation, 3+ days to make one | Works, but no control over the exact stock reveal and file licences need checking. |
| Rive `@rive-app/react-canvas` 4.41.0 | MIT (runtime); Rive editor has a free tier | WASM runtime ~100s of KB | 3 to 5 days: must design the .riv file in the Rive editor | Peer React 19 ok. Best for interactive state machines, overkill for a 3 second reveal. |
| Three.js 0.187.0 + `@react-three/fiber` 9.8.2 | MIT | three ~150+ KB, r3f ~40 KB, plus a GLB box model | 4 to 6 days | r3f peer is `>=19 <19.4`, our React 19.3.0 fits but would block an upgrade to 19.4. Heavy for mobile. Not worth it. |
| `canvas-confetti` 1.9.4 | ISC | ~4 KB | 0.5 day | No React peer needed. Has a "disable for reduced motion" option. Dynamic-import it only on reveal. |

**Recommendation: pure CSS/Tailwind keyframes for the box, lid, glow and card, with 16 CSS particles, zero new dependencies.** Reasons: smallest risk before the deadline, no supply-chain surface, matches existing animation tokens, reduced-motion already handled, works on low-end phones. If the team wants richer confetti, add `canvas-confetti` (ISC, tiny) loaded with dynamic import as the only optional extra. Use the built-in `frontend-design` guidance for look and feel (do not install any design skill from the internet, per CLAUDE.md).

Suggested files (for the later build, not now): `web/components/gift-box.tsx` (animation, props: state, asset, amount, sender, note), keyframes added next to the existing ones in `web/app/globals.css`.

---

## 6. UI placement in the existing app

Existing structure **[VERIFIED]**: pages under `web/app/(app)/`: dashboard, pay, invest, borrow, themes, risk, employer, demo. Nav is defined in `web/components/shell.tsx`: individual = Portfolio, Invest, Borrow, Themes; employee = Portfolio, Payday, Invest, Borrow, Themes; owner = Payroll, Risk. The phone has a 3-item segmented switch plus a "More" menu fed by an `EXTRA` list (Docs, Testnet tools, Account).

Proposal:
- **No new top-level tab.** The nav is already full and phones have only three slots.
- **New page** `web/app/(app)/gifts/page.tsx` with two tabs: Received and Sent, and a "Send a gift" form.
- **Entry points:**
  1. Portfolio (`/dashboard`): a card at the top, "You have 2 gifts to open", shown only when there are pending incoming gifts. And a "Gift" action on each holding row, enabled only if the asset has free (idle) balance.
  2. The menu: add "Gifts" to the `EXTRA` list so it is always reachable.
- **Notification badge:** a small dot with a count on the menu button (phone and desktop) and next to "Gifts". Count comes from `GET /api/gifts?box=in&status=pending` (new route, signed-in only, same session pattern as `/api/people`), refreshed every 60 s with react-query (already installed). Chain remains the truth: the app confirms status with `giftOf(id)` before showing "Open".
- **Pending gifts list:** card per gift: sender name and ID, message preview, expiry countdown, closed-box thumbnail, "Open" button. Sent tab: status chip (Pending, Claimed, Revoked, Expired) and Revoke on pending ones.
- **Who sees it:** Personal and Business team members (they have vaults). Business owners without a vault do not see it. A person with no profile cannot receive by ID.
- **Labels:** on testnet show the existing "Mock" badge on mock assets, and a "Testnet gift" label.

New server pieces: Supabase table `gifts` (gift id, chain id, sender wallet, recipient wallet, note, tx hash, created_at) with RLS on and no public policies, written only by the server after the sender signs in, same as the other tables. Rate limit per sender (the `rate_limits` table exists **[VERIFIED]**).

---

## 7. Can it ship before December 5, 2026?

Today is November 21, so there are 14 days. Rough estimate (one contributor, one Claude):

| Piece | Days |
|---|---|
| Founder decision and ANCHOR.md edit | 0.5 (blocking) |
| Contract plus tests plus fork test | 3 |
| Supabase table, API routes, ABI generation (`python web/scripts/gen-abis.py`) | 2 |
| Gifts page, send form, pending list, badge | 3 |
| Box animation (CSS) and reduced-motion | 2 |
| Testnet deploy (founder only), QA, docs, demo script | 2 |
| **Total** | **about 12 to 13 working days** |

That is very tight. Fits only if the founder approves within the next 2 to 3 days and the scope stays: testnet only, no fee, no notes, no decline function if time runs short (keep create, claim, revoke, refundExpired). Risks to the deadline: review time on a money contract, gas and fork-test debugging, and the manager check that "every feature maps to the anchor". Gift Stocks does not, so it could be marked as drift. Safer option: build it as a clearly labelled supporting feature, and put it behind the hackathon core (loans, payroll, SIP) in priority.

### Needs from founder (Justin)

1. Approval that Gift Stocks is in scope, and the `docs/ANCHOR.md` change (supporting feature wording).
2. Agreement to the GitHub issue (section 2.3) so a new contract may be written.
3. A decision on fees: confirm none (recommended).
4. A decision on the legal wording and the non-US eligibility warning. Mainnet use only after legal advice.
5. He alone deploys the new contract on Base Sepolia and updates `deployments/base-sepolia.json` and the live site (CLAUDE.md team workflow).
6. Any mainnet transaction or fork-test RPC needing real money stays with him. The fork tests cost nothing.
7. Which assets are giftable on mainnet (AAPLc and other B20 stocks plus deSPXA pass today; leave wtSGOV out until verified).

---

## 8. Unverified items to check

- Whether AAPLc's B20 policy can freeze or seize (Base page does not mention it).
- Each other Coinbase stock token's policy (only AAPLc simulated).
- Centrifuge's own wording on holder eligibility (page returned 403).
- wtSGOV's real address, issuer and transfer rules.
- Dinari and Backed rules (not in the asset list).
- All bundle sizes in 5.5 (from memory, measure).
- All tax and legal statements in section 4, including the 19,000 USD figure.
- Whether `web/lib/batch.ts` supports the three-call flow as is (file exists, I did not read it).
