# Stackday: the anchor and product description

Status: APPROVED by the founder on November 15, 2026. This is the anchor in force. It replaces the earlier, narrower paragraph (kept at the end of docs/BRIEF.md for the record).

## 1. Product description (what Stackday is today, plus the requested updates)

Stackday is a payroll and investing app on Base. A business pays its team in USDC, and every payday can quietly become an investment: before claiming, each person chooses a share of that salary, for example 10 or 20 percent, and what it buys. The purchases land in a vault that only that person controls. When they need cash they borrow USDC against what they hold instead of selling it, and because every payday adds more collateral, the loan gets safer as the weeks go by.

People who are not on anyone's payroll can use the same thing on their own: connect a wallet, set a regular buy from it, and get the same vault and the same borrowing.

How someone moves through it:

1. They land on the landing page.
2. They press start and connect a wallet.
3. They choose an account type: Individual or Business.
4. A profile is created for them in the account database (Supabase) with a unique ID. A new person fills in a few details. A business adds its business name and a description.
5. An Individual goes to their own dashboard and sets up a regular SIP from their wallet.
6. A Business account goes to the right dashboard for who they are: the owner sees the business dashboard (treasury, team, paydays), an employee sees the employee dashboard (salary to claim, plans, vault, loans).

What a business owner does: funds a USDC treasury once, adds the team, and pays them once or on a rhythm (daily, weekly, every 2 weeks, monthly) that keeps running while the treasury is funded. Team members are found and added by their unique ID or name. The owner can also see a simple daily attendance record.

What an employee or individual does: claims pay to any wallet, sends a share into tokenized stocks (and Bitcoin or Ether tokens), once or on every payday, sees holdings, plans and loans on one dashboard, earns interest on idle USDC, and borrows against holdings through an existing lending market with every cost and risk shown on one risk screen.

The planned "Themes" layer: the app learns what the person is interested in (for example AI, clean energy, big tech), follows market news and sentiment, suggests a split of tokenized stocks by theme, and from time to time proposes a rebalance.

What Stackday is not: it runs no lending pool and no pooled fund, it holds nobody's money (each vault belongs to its owner), and it launches no token.

How it earns: small fixed fees, 0.2 percent at most (issue #45): 0.15 percent on recurring buys (one-time buys are free), 0.1 percent once on borrowed USDC, and 0.1 percent a year on USDC earning interest, taken only out of the interest. All set in the contracts and impossible to change. A per-employee subscription for businesses is planned.

## 2. The anchor

This is the paragraph the build is checked against, followed by the numbered parts a reviewer can tick off.

> Stackday is a payroll and investing app on Base. After connecting a wallet on the landing page, each person chooses an Individual or a Business account and gets a profile with a unique ID. Businesses fund a USDC treasury and pay their team once or on a schedule, and employees claim to any wallet they choose. Before claiming, an employee can send a share of their salary, once or on every payday, into Coinbase tokenized stocks (and Bitcoin or Ether tokens) held in a vault only they control. Individuals without an employer invest the same way, on a regular schedule from their own wallet. Positions grow through automatically reinvested dividends, and idle USDC can earn interest on Morpho or Aave. When cash is needed, the person borrows USDC against their holdings through the existing Morpho and Aave markets instead of selling, and because every payday adds more collateral, the loan gets safer as the weeks go by. A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time. Confidential salary payments are planned as the next step.

### The parts, with today's status

| # | Part of the anchor | Status today |
|---|---|---|
| 1 | Landing page is the start of the platform | Built |
| 2 | Start, connect wallet, then choose Individual or Business | Built. The choice is required: a connected wallet without one is sent to /start. It picks Personal or Business (and, for Business, owner or team member). Personal and Business are separate interfaces with their own pages, switched from the top of the app |
| 3 | A profile with a unique ID is created in Supabase for each new user | Built. First sign-in creates the profile with an ID like SD-7K3F9Q2M. The chosen name is now optional |
| 4 | New business adds business name and description | Built. On /start and editable on Run payroll. Employees see the business name instead of a wallet address |
| 5 | Business account shows the owner dashboard or the employee dashboard depending on who the person is | Built. Business owners get Payroll and Risk. Team members get My pay, Invest, Home, Borrow and Risk. Personal gets Home, Invest, Borrow and Risk. Opening a page from the other interface offers to switch |
| 6 | A business can find people (see open question A) | Built. Search by Stackday ID, name or wallet address. The person is invited and must accept before the business sees their attendance |
| 7 | Businesses fund a treasury and pay once or on a schedule | Built, tested, shown on testnet |
| 8 | Employees claim to any wallet, with a share into assets, once or every payday | Built, tested, shown on testnet |
| 9 | Coinbase tokenized stocks, plus Bitcoin and Ether tokens | Built with mock tokens on testnet. The same code is tested with the real AAPLc token on a copy of Base mainnet. BTC and ETH have no mainnet test yet |
| 10 | A vault only they control | Built, tested. Home shows Total invested (lifetime USDC put in through buys and payday shares, kept on chain by SipRouter and Payroll), what it is worth now and the change |
| 11 | Individuals invest regularly from their own wallet | Built, tested. The Individual account type is called Personal in the app |
| 12 | Dividends reinvested | A property of the real tokens. The testnet mocks pay none |
| 13 | Idle USDC earns interest on Morpho or Aave | Built for Morpho-style vaults (mock on testnet, real Morpho vault tested on a mainnet copy). Aave NOT built |
| 14 | Borrow against holdings through Morpho and Aave instead of selling | Built on Morpho. Aave NOT built. Collateral basket on the Borrow page: lock any mix of assets first (one total, one limit), then borrow; each borrow and repay is split across the Morpho markets so every part has the same health. Each asset is still its own market and can be liquidated on its own; the page says so. Borrow and repay happen only in the basket; taking assets out is one Withdraw control that releases locked assets automatically. Borrow offers three risk levels (Low 30, Mid 50, High 65 percent of the liquidation limit, set from broker, bank and Coinbase practice and Morpho's 12.7 percent liquidation cost on stock markets). Each shows the amount it really gives and the price drop it really survives, and says when market cash cuts it short; High raises the vault's own safety cap to 65 percent in the same signature, only when the amount needs it |
| 15 | Every payday adds collateral, the loan gets safer | Built, tested. Founder decision November 16, 2026 (issue #29): new buys are never locked automatically; the person locks them on Borrow, and only the opt-in emergency rule locks a payday share by itself. So the loan gets safer when payday buys are locked |
| 16 | Themes: news and sentiment, stocks by theme, rebalancing | Partly built (#10 to #13, #34, merged November 16, 2026): /themes page for Personal and team members. Pick themes and a risk level, get a split with targets for new buys (Stackday cannot sell, so holdings can drift; a notice says so), put it to work from salary (one signature) or from the wallet, once or on a schedule. Market mood comes from a dated hand-built snapshot, labelled as not live. Rebalancing proposes new money only. NOT built yet: the weekly live news refresh (plan in docs/themes/weekly-plan.md, founder answers on #3; value tilt ships off). Selling (issue #35) is after the deadline |
| 17 | Confidential salaries | Next step, not built |

Supporting parts that stay required: one risk screen with a stress test, honest labels on everything mocked, the fixed fee, attendance as a record only, and the safety checks in docs/SECURITY-CHECKLIST.md.

## 3. Working assumptions

The founder approved the anchor as drafted without answering the open questions, so the draft's assumptions stand until the founder says otherwise. Each one is easy to change later.

A. "A business can find people" means: a business finds and adds employees by their unique ID or name, instead of pasting a wallet address.

B. Themes is built in steps. First version: the person picks themes, the app suggests a split of tokenized stocks, and the person confirms the buys. Rebalancing needs selling, which the contracts cannot do yet, so "proposes rebalances" starts as a suggestion the person acts on. Nothing is ever moved without the vault owner's approval. Wording stays "information, not advice", and compliance is the team's responsibility.

C. One wallet can be both an Individual and a Business account. The choice sets the default dashboard and can be switched.

D. A wallet is an employee of a business when that business has added it to its team or to a payday. UPDATE November 15: built with an accept step, see below. Original note: the security review (docs/SECURITY-CHECKLIST.md, fix 6) found that adding someone without their agreement lets the business see that person's attendance dates. Recommended change: the person accepts before their attendance is visible. Not yet decided by the founder.

E. Bitcoin and Ether tokens are part of the anchor but secondary. The competition is about tokenized stocks.

Build order agreed in docs/START-HERE.md: account flow first (parts 2 to 6), then the security fixes, then Themes.
