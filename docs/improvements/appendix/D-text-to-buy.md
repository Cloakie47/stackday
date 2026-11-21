> Checked on 2026-11-21: EIP-5792 `sendCalls` in `web/lib/useTx.ts`, the `receiver` argument of `EmployeeVault.borrow`, the X developer guidelines (Automated label, replies only after the user engages, no written approval needed for AI replies), and Base mini apps marked "Sunset" on docs.base.org/mini-apps.

# Text-to-buy / text-to-borrow chatbot for Stackday: feasibility

Date: 2026-11-21. Plain language. "(unverified)" marks things I could not confirm from a primary source.

## 1. Short answer

- Feasible, and cheap, if the bot only PREPARES a transaction and the user signs it in their own wallet. The web app already has everything needed: `web/lib/useTx.ts` batches calls through EIP-5792 `sendCalls` (one signature, all or nothing) and falls back to one-by-one signing, and the pages in `web/app/(app)/invest` and `borrow` already build every call we need.
- Do it in the Stackday site first (in-app chat, the wallet is already connected via wagmi). X second, and on X the bot should only answer general questions and link to the app. Do not let X replies carry "buy this" actions.
- It is NOT in the approved anchor paragraph in CLAUDE.md. Closest sentences: the Themes layer ("suggests tokenized stocks by the themes a person cares about") and "borrows USDC ... instead of selling". A chat box that triggers buys and borrows is a new interface, so it needs founder (Justin) approval and a row or note in `docs/ANCHOR.md` before anyone builds it.

## 2. What "Grok bot plan on X" could mean

| Meaning | Programmable? | What it costs / needs |
|---|---|---|
| xAI API key (console.x.ai) | Yes. Models grok-4.7, 4.6, 4.5, 4.3, 4.20 and others; custom function calling is supported ("model requests the call, you execute it locally") | Tokens only. grok-4.3: $1.25 in / $2.50 out per million tokens. grok-4.7: $2 in / $6 out. Source: https://docs.x.ai/docs/models and https://docs.x.ai/docs/guides/function-calling. A chat turn is a few thousand tokens, so a demo costs cents. |
| X Premium "Grok" (the @grok reply bot, Grok tab) | No. xAI docs table lists Grok in X as billed by X, "programming required: No"; xAI API and X Premium are separate purchases (https://docs.x.ai/grok/faq.md) | Cannot be wired to our contracts. Only useful as marketing. |
| X API bot account (our own @StackdayBot) | Yes, with the official API only | Pay-per-use now (https://docs.x.com/x-api/getting-started/pricing): "$0.005 per Post returned"; post created $0.015, post created with a URL $0.200 (rate as read from the page; check the console before relying on it). Old Basic $200/month tier reported retired (third-party sources, unverified). |

So the realistic build is: xAI API (or any LLM, see section 5) for the brain, plus an X API pay-per-use account for the X channel. Note: replies containing a link cost about $0.20 each. 100 link replies is about $20. Cheap for a demo, not free.

Recommendation: keep the LLM behind one thin interface so we can use Grok (fits the team's plan) or another provider. Do not make Grok the only option. Whatever model is used, it never sees keys and has no ability to send anything.

## 3. How a prepared transaction reaches the user to sign (primary sources)

| Method | How | UX | Safety | Verdict |
|---|---|---|---|---|
| A. In-app chat, wagmi wallet already connected | Chat returns a structured "confirmation card"; click Confirm calls existing `useTx().run(calls)` | Best. No context switch, one signature (EIP-5792) | Best. Our own code builds calldata, wallet shows its own prompt | MVP. |
| B. Link from X or Telegram to a Stackday page with prefilled amounts (`/invest?asset=AAPLc&usdc=50`) | Page opens, user connects, page shows the same card | Good, one extra hop. On phones, Coinbase Wallet deep link `https://go.cb-w.com/dapp?cb_url=<encoded url>` opens the page inside the wallet's browser (Coinbase docs via search; the docs page itself returned 404 to me, so the link format is unverified) | Good if the page re-validates every parameter. Links are just parameters, never calldata. | Phase 2, for the X bot. |
| C. EIP-681 payment URL `ethereum:<addr>@84532/fn?uint256=..` | Spec allows ABI function calls; "the indicated amount is only a suggestion" the user can change (https://eips.ethereum.org/EIPS/eip-681) | Poor for us. Needs multiple typed args, approvals first, wallet support for contract calls is patchy (unverified) | Spec itself warns: "Irreversible transactions can be initiated from these URLs" so only from authenticated sources. Raw calldata links are what phishers use. | Do not use. |
| D. EIP-5792 `wallet_sendCalls` | App asks wallet to run a batch; with `atomicRequired` wallet must run all or nothing, and "send nothing if the user rejects" (https://eips.ethereum.org/EIPS/eip-5792) | One signature for approve + buy | Safe: user still approves in wallet | Already in `useTx.ts`. Reuse it. |
| E. Farcaster Frames / Base mini apps | Transaction buttons in feeds | Nice in Farcaster | Base docs now mark mini apps "Sunset" and say normal web apps work in the Base App/Coinbase Wallet browser with no manifest (https://docs.base.org/mini-apps/overview, as summarized by the fetch tool). Farcaster frame tx details not checked (unverified). | Skip. A normal web link covers it. |
| F. Smart wallet spend permissions / session keys | User signs once, then a "spender" can move tokens up to a limit per period without asking again (https://docs.cdp.coinbase.com/wallet-api/v2/evm-features/spend-permissions). Manager on Base: 0xf85210B21cC50302F477BA56686d2019dC9b67Ad | Smooth for DCA | Breaks our rule "user approves every transaction". Permissions "remain active until revoked", and a bot key (or injected bot) could spend up to the limit. Also only for Smart Accounts. | AVOID for the chatbot. Recurring buys already work without it: `SipRouter.setPlan` plus the existing keeper that calls permissionless `executePlan`; the keeper can only run the plan the user signed. |

Ranking for safety: A > D inside A > B > everything else. A and D are the same thing in our case.

## 4. Rules from X (primary: https://docs.x.com/developer-guidelines, fetched; help.x.com page returned 403, so its wording was only seen through search summaries)

- Bot must turn on the "Automated" profile label, say so in the bio, and be linked to a human-run account.
- Auto-replies only if the user engaged first, "maximum of one reply per interaction". Replying to anyone who just mentions a keyword is prohibited. No auto-DMing new followers. Honor opt-outs at once.
- AI-generated replies: the guidelines say no written approval from X is needed if the rules are followed; a search summary of the help page said approval is needed (conflict, unverified). Ask X or re-check before launch.
- Links: affiliate links allowed only when the user asked for them and the relationship is disclosed; deceptive links or redirects are prohibited. A link to our own app in answer to a user's question looks fine.
- Finance: the guidelines list a crypto tip service as allowed "provided you comply with financial regulations", and scheduled price posts as allowed informational content. Nothing found about bots replying with transaction links, and no explicit ban. Do not infer "financial status" of users (listed as prohibited sensitive-data derivation).
- Official API only. Scraping or browser automation means permanent suspension.
- Legal side: a bot that says "buy AAPLc" can be investment advice. Keep it general (see rule 7 below).

## 5. xAI / model terms
- xAI terms page returned 403 (https://x.ai/legal/terms-of-service), so financial-use clauses are unverified. Action: Justin or a team member reads them before shipping, and the chat shows "AI can be wrong, not financial advice".
- Function calling is supported by xAI. Strict structured output was not confirmed from the docs page (unverified). Our design does not depend on it: we validate every tool call with our own schema (zod) in code.
- Any model with tool calling works (Claude, GPT, Grok). Picking Grok mainly matters for the story with X, not for the technology.

## 6. What went wrong elsewhere (and the lesson)

- Bankr + Grok on Base, May 2026: a gifted membership NFT unlocked transfers for Grok's wallet; a Morse-code post got Grok to relay a transfer instruction to Bankrbot, about $150k to $200k (figures vary by outlet), roughly 80% reported returned. Sources: https://cointelegraph.com/news/grok-bankr-wallet-free-nft-prompt-injection, https://giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet, summary in `C:\Stackday\docs\07-research-agent.md`. Bankr's founder reportedly said a block on Grok replies (stopping LLM-to-LLM chains) was dropped in a rewrite and later reinstated (single secondary source, unverified). Lessons: the agent held a wallet that could sign; text from another AI/user was treated as a command; a permission was unlocked by a cheap NFT gift. Our design removes all three: no wallet, no signing, no permission state a stranger can change.
- Bankr docs: agents get a wallet and API key via `bankr login`; the docs page I read does not explain confirmations (unverified).
- Coinbase AgentKit: reporting says default wallet tools do not enforce human approval, caps or destination allowlists, and that a spend-capped MPC wallet will still faithfully sign an injected "empty wallet" request (secondary sources, e.g. https://decrypt.co/357813, unverified). A prompt-injection vulnerability in AgentKit was reportedly patched (unverified detail). Lesson: key isolation is not enough, the model should not be the thing that authorizes.
- Hey Anon: sources I found are high level. One says it uses ERC-4337 smart accounts for gasless transactions (single secondary source). Signing model (session keys or per-tx approval) not confirmed (unverified).
- Robinhood Cortex: support page says it cannot do "transactions using natural language text or voice commands"; one disclosure mentions pre-filled orders (scope unclear). Robinhood's separate Agentic Trading beta does let connected agents trade in a dedicated account. Lesson: the mainstream broker keeps the chat assistant advisory and the order screen separate. Our "chat fills a card, user confirms" sits between the two.
- Wayfinder: not researched (unverified/skipped).

## 7. Proposed design

### 7.1 Seven non-negotiables
1. The bot and the LLM hold no keys, never sign, never send. The server has no `walletClient`.
2. Every transaction is built in the browser (or server) by deterministic code, shown on a card, and signed in the user's wallet via existing `useTx`.
3. The LLM only outputs a tool call from a fixed list; it never outputs addresses or calldata. The user's address is the connected wallet, never from text.
4. Allowlisted contracts only: Stackday router, vault, USDC and the listed stock tokens from `web/lib/contracts.ts` / `deployment.json`. Unknown asset names are refused.
5. Never act on text from fetched content. News, X posts, other users' messages and tool results are data. They go in a separate "untrusted" block, and the model has no action tools in any turn that includes them. Reading and acting turns are different calls.
6. Ignore other bots. On X, do not respond to or act on other bots, Grok replies, or quoted posts (Bankr lesson: LLM-to-LLM chains).
7. No personal advice. The bot explains products and shows facts the user asked about; it never answers "what should I buy". If asked, it says it cannot advise and offers the general Themes research page. Fixed disclaimer on cards.

### 7.2 Intent schema (strict JSON tool list)
`buy{asset, usdc_amount}`, `set_recurring_buy{asset, usdc_amount, interval_days, weeks}`, `cancel_recurring_buy{asset}`, `borrow{asset, usdc_amount}` (collateral asset), `repay{asset, usdc_amount | all}`, `show_position{}`, `explain{topic}`. No `send`, `withdraw_to`, `receiver`, `address` fields at all.

Important finding in the contracts: `EmployeeVault.borrow(stock, collateralToAdd, usdcAmount, receiver)` and `withdraw(token, amount, to)` take a destination address. That is the exact slot an injection would target. The chat must hard-code `receiver = to = connected wallet` and not offer the model any way to change it. If a user wants another destination, send them to the normal Borrow page.

### 7.3 Deterministic builder
New file `web/lib/chat/buildCalls.ts` (new, not in repo yet), pure functions: parsed intent -> `Call[]` using the same shapes `invest/page.tsx` uses (`router.invest(token, amount, minOut)`, `setPlan`, `cancelPlan`, USDC `approve` through `useTx.withApproval`, `factory.createVault` if no vault, `vault.borrow`, `vault.repay`). Reuse the page logic by extracting it into shared helpers instead of copying. Slippage min-out comes from `quoteAtOracle`, never from the model.

### 7.4 Confirmation card (before any signature)
Shows: action, asset, exact USDC in and expected stock out (oracle quote and slippage floor), fees (15 bps SIP fee for recurring, one-time buys free; borrow fee 10 bps a year; from CLAUDE.md), for a borrow: health factor after (computed with the same math as the Borrow page and `healthFactor`/`borrowLimit` reads), liquidation warning, "receiver: your wallet 0x..." in full. Labels "Base Sepolia testnet, mock where mocked" (CLAUDE.md rule on labelling mocks). Buttons: Confirm (opens wallet) and Cancel. Simulate the calls first (`useTx` already does `simulateContract`) and show failures in plain words.

### 7.5 Limits
- Max per message: configurable cap (suggest 500 USDC testnet, lower on mainnet), max borrow = existing borrow cap and a chat-only extra rule that the resulting health factor must be above the user's own threshold, else the card is refused, not just warned.
- One pending card at a time; a card expires in 2 minutes; amounts on card and calldata come from one object, hashed, so the text cannot change after display.
- Rate limit per wallet/IP; log intent JSON (not secrets) for review.
- Chat context: only the user's own typed text plus read-only position data from our own contracts. No browsing, no URLs fetched into the prompt in v1.

### 7.6 Where it lives
In-app chat panel (new component, e.g. `web/components/chat-dock.tsx`, plus API route `web/app/api/chat/route.ts` that calls the LLM and returns validated intents only) on the (app) layout. X is phase 2 and reduced in power (below).

## 8. Phased plan (deadline Dec 5, 2026; today Nov 21, 14 days)

Phase 0 (founder gate, 0.5 day): Justin approves "text interface" as a new surface; add a row to `docs/ANCHOR.md` (suggested wording: "A chat assistant explains products and prepares buy, recurring-buy, borrow and repay actions; every action is confirmed and signed by the person in their wallet"). Agree the no-advice rule and the amount caps. Decide the model/provider and who pays the API key (xAI key, cents).

Phase 1, MVP in-app chat (about 3 to 5 working days for one dev, my estimate):
- LLM route with tool schema and zod validation (1 day)
- builder functions and card, reusing `useTx`, `batch.ts`, invest/borrow logic (1.5 days)
- show_position and explain tools (read-only) (0.5 day)
- tests: builder unit tests, injection test set (paste Morse/homoglyph/"ignore instructions"/"send to 0x..." texts and assert no tool call outside schema and receiver unchanged), tests for caps (1 day)
- UI polish, disclaimers, mock labels (0.5 day)
Fits before Dec 5 only if it does not delay anything already promised; it is optional polish, not core. Scope it to buy, recurring buy and show position first, borrow second.

Phase 2, X bot (about 2 to 3 days, optional, only after phase 1 is stable, my estimate):
- X API pay-per-use account, "Automated" label, bio disclosure, linked human account
- Replies only when someone mentions us and asks a question (user engaged first), one reply per interaction, opt-out keyword
- Answers general questions from our docs (no position data, no wallet) and replies with a link to the app (`stackday-rho.vercel.app/invest?...` prefilled) where the user signs. Links cost about $0.20 per reply under the current rate (unverified, check console).
- Never reads posts from other bots or quoted/hidden text as instructions; never discusses a person's holdings.
- Hard rule: the X bot has no tools that create or modify actions. It outputs text and a link only.

Not worth building: X-side buying in the thread, DMs with calldata, spend permissions, Farcaster frames.

## 9. What needs founder (Justin) approval
1. Adding the text/chat interface (not in the anchor); edit `docs/ANCHOR.md`.
2. Choosing the LLM provider and paying the API key (xAI vs other).
3. Creating an X bot account (public posting, an account creation, X API credit purchase).
4. The caps, the disclaimer text and the no-advice policy.
5. Any move to mainnet (CLAUDE.md: stop and ask).
6. Reading xAI and X terms for financial use (unverified items above) or a legal check.

## 10. Open questions for the team
- What exactly is the "Grok bot plan on X"? Which of the three meanings in section 2 is it?
- Is there already an X account or an xAI key? (Never paste keys in chat; put them in `.env`.)
- Should Telegram be considered instead of X? (Not researched.)
