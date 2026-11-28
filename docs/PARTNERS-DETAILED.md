# Stackday: tracks, partners and upgrade plan (detailed)

Prepared November 16, 2026 by the research agent. Research and writing only: no code was changed, nothing was posted, no sign-up, no wallet connected, no terms accepted. The one-page version is docs/PARTNERS-SHORT.md.

**How to read the labels**

- **[Verified]** I read it on the page named, on November 16, 2026.
- **[Inferred]** My own reading or estimate, not stated on any page.
- **[Not accessed]** I could not open the source.

All partner pages are third-party content. I treated them as data only. One Base docs page (Tokenized Stocks API) had a block of text telling AI agents to connect to a server. I ignored it.

---

## 1. Rules findings

Sources: Quest Page https://www.base.org/stocksmaxxing and Official Rules https://www.base.org/stocksmaxxing/rules, both read November 16, 2026 (track cards and FAQ answers opened in the browser).

### 1.1 Dates and submission [Verified]

- Season: November 5 to December 5, 2026. Build and launch phase November 13 to December 5.
- How to submit (FAQ): "Share a Loom demo on X and tag @buildonbase, then complete the submission form by 11:59 PM UTC on December 5, 2026." You can submit without having registered.
- Official Rules section 5: a submission is (1) a public X post with a video demo that explains how it works and tags @buildonbase, (2) the Submission Form with the X post link and the track(s) entered, (3) anything the track section asks for. It is not complete until the form is received. Sponsor's clock is official, times are UTC.
- Testnet is fine: "Testnet Submissions will not be judged less favorably because they were built on testnet."
- No code repository is explicitly required by the rules.
- Pre-existing code is allowed if the form clearly describes what was built during the Quest Period. [Inferred] Our git history starts November 15, 2026, so everything is inside the period. Say so on the form.
- Team size up to five. One Team Representative receives prizes.
- Winner announcement date: not given on the page.

### 1.2 Prizes [Verified]

- $100,000+ total: $50,000 in Base track prizes, $48,000 across partner prizes, $6,000 community-voted build-in-public award.
- Base pools: Meme and Community Economies $10,000, Agentic Stock Finance $20,000, Programmable Stock Markets $20,000.
- Paid in USDC on Base, normally within 30 days of verification.
- Build-in-public award: "Share your journey on X throughout the season and tag @buildonbase. The community votes." Winner gets $6,000.

### 1.3 More than one track? [Verified, with an important default]

Official Rules section 5: "A single project may be entered in more than one Track only if the Quest Page allows it. Even then, a single project may win a prize in only one Track, unless the Quest Page says otherwise." Each entrant may submit one submission per track.

The Quest Page does not say multi-track entry is allowed. **So the default today is one track per project.** The rules also say dates and criteria "may change", so it is worth asking Base in the support group (links on the Quest Page) before deciding. [Inferred] Even if allowed, a project can only win one track prize, so the gain is small and the second track would need its own strong story.

### 1.4 Launchpad programs and the Base pool [Verified]

Official Rules section 8: partner prizes are funded by the partner, partner winners are chosen with the same Judging Criteria, a partner may add its own terms for non-monetary benefits, and "A Submission may win both a Track prize and a Partner Track prize, unless the Quest Page says otherwise." The Quest Page does not say otherwise. **So joining a partner program does not stop us competing for the Base pool.**

### 1.5 Judging criteria [Verified as missing]

The rules say judges score against "the criteria included on the Quest Page, weighted equally unless the Quest Page sets different weights". On November 16, 2026 **the Quest Page shows no judging criteria**, and the "Ideas to build" resource says "Coming soon". The track cards only list idea names.

[Inferred] docs/BRIEF.md records an earlier capture by the founder of the Track 3 intro ("personalization, better controls, usable capital, new sources of income, clear terms and visible risks") and the idea 3.3 brief ("Put cost, conservative limits, liquidation risk, and repayment options on one screen. Model overnight price gaps and paused collateral transfers... show deposit, borrow, repay, withdraw, with a stress scenario and the exact market used"). That text was not visible on the page today. Treat it as our best guess of what judges want, and re-check the page in the last week.

### 1.6 Eligibility and compliance [Verified]

- FAQ: "projects that enable trading for US users are not eligible." **This is the most important rule finding.**
- Rules section 6: must comply with laws on securities, lending, money transmission and so on; must not misrepresent a relationship with Base, partners, token issuers or public companies; must not claim rights the asset does not give, such as voting rights.
- Quest Page footer: "Teams are solely responsible for their own legal and regulatory compliance, including any license required to offer lending..."
- No token holding or payment is needed to enter. Launching a token is optional. Teams that launched a token before August 5 are not eligible by default.
- Winners must pass identity checks, sanctions screening, and give a W-9 or W-8 (or local equivalent) within seven days of being contacted. Every team member may need to verify.
- Base docs (https://docs.base.org/sdks/tokenized-stocks/overview, read November 16): "Coinbase tokenized stocks are available only to persons in eligible jurisdictions outside of the United States."

What Stackday does today [Verified in the repo]: web/app/docs/page.tsx says the app "does not check where you are" and asks US users not to use it with real tokenized stocks. [Inferred] That is a warning, not a gate. See upgrade U2.

---

## 2. Track by track fit

Track ideas as shown on the Quest Page track cards on November 16, 2026 [Verified].

### 2.1 Programmable Stock Markets ($20,000): best fit, rank 1

Ideas: build-your-own stock indexes, covered call and put desks, **borrow against your stocks**, earnings prediction markets. Track text: "custom portfolios, indexes, structured products, financing tools..."

| Stackday feature (built) | Track idea it maps to | Strength |
|---|---|---|
| Borrow USDC against holdings through real Morpho markets, risk screen with stress test | Borrow against your stocks; financing tools | Direct hit |
| Collateral basket: lock any mix, one total, borrow split so each part has equal health | Borrow against your stocks; close to custom portfolios | Strong, and novel |
| Every payday adds collateral, emergency rule sends next SIP share to collateral | Financing tools (safer loans over time) | Strong differentiator |
| Multi-asset SIP split (AAPL, NVDA, cbBTC, WETH) | Custom portfolios | Medium |
| Themes suggested split (not built) | Build-your-own index, custom portfolios | Medium once built |

Partners in this track: Bankr and BaseStonk only.

### 2.2 Agentic Stock Finance ($20,000): rank 2, only with an agent

Ideas: agents that earn a stock treasury, **research-to-portfolio agents**, stock-backed credit for agents, **agent-managed rebalancing**.

- Themes (anchor part 16, not built) is a research-to-portfolio flow: read news, suggest a split, propose a rebalance. [Inferred] Judges in an "agentic" track will expect something that acts on its own, within limits. Our anchor working assumption B says nothing moves without the vault owner's approval and rebalancing starts as a suggestion. That is safe but reads as a recommender, not an agent.
- "Stock-backed credit for agents" and "agents that earn a stock treasury" could map to a business paying an AI agent through payroll. Not in the anchor.
- Partners: Bankr and BaseStonk.

### 2.3 Meme and Community Economies ($10,000): rank 3, weak

Ideas: stock-quoted community coins, fee-funded stock treasuries, holder clubs with real perks, local-first stock apps, giftable stock collectibles.

- Employer payroll into stock is not really a "fee-funded stock treasury" (that idea is about a coin's trading fees buying stock). [Inferred]
- "Giftable stock" could map to an employer sending a stock bonus into an employee vault. Not in the anchor.
- All six partners here are coin launchpads (see section 3).

### 2.4 Recommendation

Enter **Programmable Stock Markets** only, unless Base confirms multi-track entry and Themes ships as an agent. Apply to the **Bankr** partner program in the same track (no token needed, same criteria, can win both).

---

## 3. Partner by partner

### 3.1 Bankr (all three tracks)

Sources, all read November 16, 2026:
- Program page: https://melodic-spandex-01b.notion.site/Bankr-Stocks-Maxxing-40ef95a255db8027866ad73cffdd8506
- Quest Page card: https://www.base.org/stocksmaxxing
- Docs: https://docs.bankr.bot, https://docs.bankr.bot/agent-api/overview, https://docs.bankr.bot/features/overview, full text https://docs.bankr.bot/llms-full.txt

**Offer [Verified]:** supports all 3 tracks. Program page: "$3,000 prize pool", "$100 in LLM credits for top projects", office hours and mentorship, design and marketing (SEO, PR, Agent Hour features), intros to first customers, "Tokenomics, launch and incorporation support", swag. The Base Quest Page card says "$1,000 in rewards". The two figures disagree; ask Bankr which is current. **No token launch is required** on either page. No separate deadline stated.

**Product [Verified from docs]:**
- An AI agent with its own wallet per user (Privy embedded wallet), reached by web chat, X, Telegram, CLI and a REST API (`https://api.bankr.bot`, `POST /agent/prompt`, poll `GET /agent/job/{id}`, API key in `X-API-Key`).
- Wallet API for swaps, transfers, signing and raw transaction submit.
- Automations: "Limit orders, stop-loss, DCA, TWAP, scheduled agent commands."
- Base B20 tokenized stocks (AAPL, NVDA and about 36 more) can be traded, but "Requires location verification; not available in the US, UK, or sanctioned regions."
- Arbitrary contract calls (Morpho, Aave and so on) are possible but **off by default**; turning them on needs multi-factor authentication. Gas sponsorship does not cover arbitrary calls.
- Skills: anyone can publish a `SKILL.md` that teaches the Bankr agent a new capability (up to 50 per wallet).
- LLM Gateway: an OpenAI-compatible model proxy (where the $100 credits would apply).
- Index tokens: an ERC-20 backed by 2 to 20 tokens including tokenized stocks, $100 minimum first buy, permanent fee. **This is a token launch.**
- Supported chains list Base mainnet and others. **No Base Sepolia or testnet support is mentioned anywhere in the docs.** [Verified by text search of llms-full.txt]

**What Stackday could integrate [Inferred]:**

| Option | What it is | Anchor sentence | Effort | Testnet? | Verdict |
|---|---|---|---|---|---|
| A. Stackday read-only skill | A `SKILL.md` plus a small public read route on our site (`/api/agent/summary?address=`) so the Bankr agent can answer "what did my payday buy, how healthy is my loan, what does Themes suggest this week". No signing. | "proposes rebalances from time to time" and the risk screen. A chat channel is new, so **needs founder approval to widen the anchor**. | About 1 day | Yes. It reads our Base Sepolia data through our own API. | Recommended if approved |
| B. Bankr LLM Gateway for Themes scoring | Use Bankr's model proxy (and the $100 credits) for the weekly news scoring that Themes needs anyway | "A Themes layer reads market news and sentiment" | 2 to 4 hours on top of Themes | Yes (off-chain) | Fits the anchor. Good, cheap, honest integration |
| C. Bankr agent executes SIP and repay from chat | Agent signs Stackday transactions | Investing on a schedule; repay | 2 to 4 days, plus MFA and arbitrary-call setup | **No.** Mainnet only, and the Bankr wallet is not the person's own Stackday wallet, so vault ownership gets messy | Skip for the hackathon |
| D. Bankr index token for a Themes basket | Launch an index token | Not in anchor | 1 day | Mainnet only, $100 real money | **Conflict: token launch.** Skip |

**Verdict: apply, and integrate lightly (B now, A if the founder approves).** Risk: low. Bankr's own docs say tokenized stocks are geo-gated, which supports our not-for-US wording.

### 3.2 BaseStonk (all three tracks)

Sources, read November 16, 2026:
- Program page: https://melodic-spandex-01b.notion.site/Base-Stonk-Stocks-Maxxing-40ef95a255db80818e62eae19ecfcdbc
- Site: https://basestonk.io (mostly a disclaimer when fetched)
- Market data (search result snapshot, may be stale): https://defillama.com/protocol/basestonk

**Offer [Verified]:** "Our monetary incentive is not a prize pot. It is the revenue a creator earns from the token they launch." Launching is free, the creator keeps up to half of each trade tax, BaseStonk takes half, capped at 1% per side. Non-monetary: launch advisory, graphics, social amplification with Base, intros, "Free agent and API access... so a team can build an agent that launches tokens", featured placement. Claims a live AI connector in Claude and ChatGPT with 14 tools. No deadline stated.

**Product [Verified]:** a launchpad where tokens trade against tokenized stocks and pay holders in those assets. The site says it is non-custodial and not affiliated with Coinbase, Base or Robinhood. I found no public API docs. [Not accessed] the agent API itself, which is given to entrants.

**Verdict: skip.** Every reward depends on launching a token, which conflicts with our no-token rule. [Inferred] Trade-off: a stock-paired "Stackday" token could earn creator fees and community attention, but it would contradict "launches no token" in the anchor, add securities and market-manipulation questions, and take days away from the judged path. No integration of value without a token.

### 3.3 Stonks Exchange (Meme track)

Source: https://melodic-spandex-01b.notion.site/Stonks-Exchange-Stocks-Maxxing-40ef95a255db808099dec70811a3ba6e, read November 16, 2026.

**Offer [Verified]:** "$25k overal prize pool". About $15,000 matches creator-fee payouts to holders of coins launched on Stonks, and about $10,000 pays bounties for "the first coin on each newly listed Base stock that becomes a runner", a runner being a token that holds a $100K market cap. Anti-abuse rules (per-wallet caps, no team wallets, no wash trading). Non-monetary: narrative incubation, distribution, GTM help.

**Verdict: skip.** Requires launching a coin. Conflict with the no-token rule.

### 3.4 o1 Exchange (Meme track)

Source: https://app.notion.com/p/o1-exchange-Launchpad-Ecosystem-3b3d90ea3737808daed4f102443e9665, read November 16, 2026. It opened publicly in the browser without sign-in.

**Offer [Verified]:** "What support we can provide for team launching on launch.o1.exchange launchpad": KOL promotion (Western and Chinese-speaking), featuring on o1 Alpha, tokenomics and exchange-listing advice, venture intros, possible protocol revenue share for strong projects, product mentorship. Technical docs: https://docs.o1.exchange/launchpad/introduction (not opened). The $10,000 figure appears on the Quest Page card; the Notion page does not explain how it is awarded.

**Verdict: skip.** Built around launching a token on their launchpad. Conflict.

### 3.5 Feel.cash, by charms (Meme track)

Source: https://charmsgg.notion.site/Stock-Maxing-Season-3fb229559adf80109b80f70698eb2c03, read November 16, 2026.

**Offer [Verified]:** "Launch the Next Meme Stock", $10,000 ($6,000 best launch, $3,000 community and narrative, $1,000 most promising). "Launch on Feel.cash. Create a new coin paired with a stock on Base." To qualify: at least $300,000 cumulative organic trading volume and an average market cap of at least $100,000 over any 72 hours.

**Verdict: skip.** Requires a coin and large trading volume. Conflict.

### 3.6 Hydropump by Hydrex (Meme track)

Source: https://yielding-decision-cc4.notion.site/Hydrex-Stocks-Maxxing-40e3c9b469178000a6dbc74ac8610322. **[Not accessed]**: the page stayed blank in the browser after three tries, and a plain fetch returned "429 Too Many Requests". A web search found no public "Hydropump" product page.

What the Quest Page card says [Verified]: "75% creator share of trading fees", BD and Base intros, marketing and distribution, direct team access. Background: Hydrex is a liquidity protocol (DEX) on Base, about $4.18m TVL per https://defillama.com/protocol/hydrex (search snippet, dated October 28, 2026).

**Verdict: skip.** [Inferred] "creator share of trading fees" means a token launch. Conflict.

### 3.7 Summary

| Partner | Tracks | Reward | Token required? | Verdict |
|---|---|---|---|---|
| Bankr | All 3 | $3,000 pool + $100 AI credits (page) / $1,000 (Base card) | No | Apply, light integration |
| BaseStonk | All 3 | Creator fees from your token | Yes | Skip |
| Stonks Exchange | Meme | $25,000 | Yes | Skip |
| o1 Exchange | Meme | $10,000 (Base card) | Yes (launchpad) | Skip |
| Feel.cash | Meme | $10,000 | Yes, plus $300k volume | Skip |
| Hydropump | Meme | 75% creator fees | Yes (inferred) | Skip (page not accessed) |

---

## 4. Integration designs

### 4.1 Bankr LLM Gateway inside Themes (fits the anchor)

- Where: the weekly Themes refresh job already planned in docs/THEMES-WEEKLY-BRIEF.md (a protected Vercel Cron route that fetches news, scores it and stores a dated snapshot).
- Change: point the scoring model call at Bankr's OpenAI-compatible gateway instead of another provider. The output still has to pass `parseNewsItem`; article text stays untrusted data.
- Keys: the founder puts the gateway key in Vercel environment variables. Never in chat or the repo.
- Effort: 2 to 4 hours once the cron route exists. Testnet: not relevant (off-chain).
- Demo line: "This week's theme reading was scored through Bankr's model gateway."

### 4.2 Stackday skill for Bankr (needs founder approval)

- Build a public, read-only route on our site returning, for one wallet: holdings by asset, loan health per Morpho market, basket total, next payday share, this week's Themes suggestion with its date and the not-advice label. No personal data from Supabase beyond what is already public on chain.
- Write a `SKILL.md` that tells the Bankr agent how to call it and how to word answers (date, not advice, testnet and mocks labelled).
- Install it on a Bankr account the founder controls (the founder does the sign-in; I must not).
- Effort: about 1 day. Testnet: yes. Risk: low; rate-limit the route.
- Anchor: the chat channel is new. Flag: **needs founder approval to widen the anchor.**

### 4.3 What not to build with partners

Agent execution through Bankr (mainnet only, wallet mismatch), any index or community token (rule conflict), any launchpad listing.

---

## 5. Ranked upgrade backlog (19 days left)

Impact is my judgment of how much it raises the chance of winning Track 3. Effort assumes one developer with an AI assistant.

### 5.1 Fits the current anchor

| Rank | Upgrade | Why it matters | Effort | Anchor part |
|---|---|---|---|---|
| U1 | Submission pack: 2 to 3 minute Loom on the judged path (deposit, borrow, stress, repay, withdraw), showing the exact Morpho market, the collateral basket, and the payday-adds-collateral story; public X post tagging @buildonbase; form answers; README check. Submit by December 3. | Without it nothing counts. The rules make the video the main thing judges see. | 1 day | All; supporting "honest labels" |
| U2 | Not-for-US gate: a one-time "I confirm I am not a US person and I am in an eligible place" step before the first buy, stored per wallet; same wording in footer and docs; no voting rights claim. | FAQ: "projects that enable trading for US users are not eligible". A warning alone may not satisfy a judge doing the eligibility check. | Half a day | Supporting: safety checks. [Inferred] Founder should confirm, see decisions |
| U3 | Ship Themes v1: update PRs #3, #10, #11, #13, #12 from current main, weekly protected cron, suggested split, person confirms in their own wallet. | Only unbuilt core anchor part. Adds the "custom portfolio" story to Track 3. | 2 to 4 days | Part 16 |
| U4 | Real-asset proof: on the risk screen and in the video, name the real Base mainnet Morpho markets the testnet mocks stand in for; short clip of the AAPLc fork test passing; read the dividend multiplier for real tokens from the free Coinbase Tokenized Stocks API (`https://api.coinbase.com/v1/tokenized-stocks`). | Judges want "the exact market used" and honesty about mocks. Shows dividends reinvest via the multiplier. | 1 day | Parts 9, 12, 14 |
| U5 | Builder Codes (ERC-8021 attribution suffix via wagmi/viem) on all Stackday transactions. Source: https://docs.base.org/build-on-base/assign-user-attributes | Base-native polish, shows we follow Base's own standards. | 2 to 4 hours | No new user feature [Inferred] |
| U6 | Build-in-public posts on X tagging @buildonbase (progress clips). Founder posts. | Separate $6,000 community award, and it builds the audience for the main post. | Founder time only | None (marketing) |
| U7 | Bankr LLM Gateway for Themes scoring (section 4.1). | Partner integration with no anchor change. | 2 to 4 hours after U3 | Part 16 |
| U8 | Stress test polish: make the overnight gap and paused-transfer scenarios one click each on the risk screen and in the video. [Inferred: check what the screen shows today] | Matches the earlier idea 3.3 brief word for word. | Half a day | Supporting: risk screen |
| U9 | Aave adapter behind the same lending interface (mocked on testnet, fork test on mainnet). | Anchor says "Morpho and Aave"; a manager will notice. Lower judging impact than U1 to U4. | 2 to 4 days | Parts 13, 14 |

### 5.2 Needs founder approval to widen the anchor

| Rank | Upgrade | Track gain | Effort | Note |
|---|---|---|---|---|
| W1 | Bankr read-only skill / chat channel (section 4.2) | Bankr partner prize odds | 1 day | Small widening: a new channel, no new money path |
| W2 | Themes as a bounded agent: runs the weekly reading and prepares the new split; the person signs. Later, opt-in limits for automatic SIP split changes. | Agentic track (only if multi-track is allowed) | 2 to 3 days on top of U3; automatic execution would need a contract change and an agreed issue | Assumption B says nothing moves without the owner's approval; keep that |
| W3 | "Save my basket as my index": name and share a personal split (no token). | Strengthens "build-your-own stock indexes" | 1 day | Framing only, no token. Ask before adding |
| W4 | Employer stock bonus: a business sends a stock gift straight into an employee vault. | Meme track "giftable stock" / "holder perks" | 2 to 3 days, contract change | Distraction risk |
| W5 | Pay AI agents through payroll (agent as employee). | Agentic "stock-backed credit for agents" | 2 days | Distraction risk |
| W6 | Any token (index token, community coin, partner launchpad) | Five partner programs | 1 to 3 days | **Conflicts with the no-token rule.** Not recommended |

---

## 6. Risks and conflicts

1. **US eligibility [Verified rule].** The FAQ excludes projects that enable trading for US users. Coinbase tokenized stocks are for non-US persons only. Fix with U2 and clear wording. Severity: high.
2. **Token-launch conflict.** BaseStonk, Stonks Exchange, o1 Exchange, Feel.cash and (inferred) Hydropump all reward launching a coin. The anchor says Stackday "launches no token", and CLAUDE.md lists token launch as out of scope. Trade-off: a token could bring partner money and attention, but it adds securities and manipulation risk, takes days, and Feel.cash and Stonks also need real trading volume and market cap that a three-week-old token is unlikely to reach. Recommendation: keep the rule.
3. **Securities and lending wording.** Rules forbid claiming rights the token does not give (voting) and misrepresenting endorsement. The Quest Page says teams need any license required to offer lending. Wording to use: "Stackday does not lend. You borrow directly from a Morpho market from your own vault." "Information, not investment advice." "Not affiliated with Coinbase or Base." Never say "guaranteed", "safe", or that dividends are paid in cash (they show up through the token multiplier).
4. **Judging criteria not published.** We are guessing from an older capture. Re-check the Quest Page around November 28 and before recording the video.
5. **Multi-track assumption.** Entering two tracks without the page allowing it could void the extra entry or confuse judges. Default to one.
6. **Distraction from the judged path.** Aave, agents and partner work must not break deposit, borrow, stress, repay, withdraw. Run `bash script/judge-sequence.sh` after every merge in the last week.
7. **Stale Themes branches.** PR #13 would delete security work if merged as is (noted in docs/THEMES-WEEKLY-BRIEF.md). Merge main into each branch first.
8. **Winner verification.** Identity check, sanctions screening, W-9 or W-8, within seven days. The founder should be ready, and every team member may be asked.
9. **Partner figures may change.** Bankr shows $3,000 on its page and $1,000 on the Base card.

---

## 7. Open questions

1. Does Base allow one project in more than one track this season? (Ask in the support group.)
2. When will judging criteria and the winner date be published?
3. Bankr: is the prize $1,000 or $3,000, and does a project need to use Bankr to qualify for its partner prize? Its page does not say.
4. Hydropump: program terms (page not accessible).
5. o1 Exchange: how its $10,000 is awarded (not on its page).
6. Does a self-attested not-for-US gate satisfy Base's eligibility check, or do they expect geo-blocking? (Ask Base.)

---

## 8. Sources (all read November 16, 2026)

- Base Quest Page: https://www.base.org/stocksmaxxing (track cards and FAQ opened in the browser)
- Official Rules: https://www.base.org/stocksmaxxing/rules
- Base Tokenized Stocks API: https://docs.base.org/sdks/tokenized-stocks/overview
- Base Builder Codes: https://docs.base.org/build-on-base/assign-user-attributes
- Bankr program: https://melodic-spandex-01b.notion.site/Bankr-Stocks-Maxxing-40ef95a255db8027866ad73cffdd8506
- Bankr docs: https://docs.bankr.bot, https://docs.bankr.bot/agent-api/overview, https://docs.bankr.bot/features/overview, https://docs.bankr.bot/llms-full.txt
- BaseStonk program: https://melodic-spandex-01b.notion.site/Base-Stonk-Stocks-Maxxing-40ef95a255db80818e62eae19ecfcdbc
- BaseStonk site: https://basestonk.io
- Stonks Exchange program: https://melodic-spandex-01b.notion.site/Stonks-Exchange-Stocks-Maxxing-40ef95a255db808099dec70811a3ba6e
- o1 Exchange program: https://app.notion.com/p/o1-exchange-Launchpad-Ecosystem-3b3d90ea3737808daed4f102443e9665
- Feel.cash program: https://charmsgg.notion.site/Stock-Maxing-Season-3fb229559adf80109b80f70698eb2c03
- Hydrex program (not accessed): https://yielding-decision-cc4.notion.site/Hydrex-Stocks-Maxxing-40e3c9b469178000a6dbc74ac8610322
- Hydrex background: https://defillama.com/protocol/hydrex
- Repo: docs/ANCHOR.md, docs/BRIEF.md, docs/THEMES-WEEKLY-BRIEF.md, web/app/docs/page.tsx, git history
