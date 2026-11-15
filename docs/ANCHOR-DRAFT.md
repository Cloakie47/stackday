# Stackday: product description and proposed new anchor

Status: DRAFT for the founder to approve. Written November 15, 2026.
Until it is approved, the anchor in docs/BRIEF.md and CLAUDE.md stays the one in force.

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

How it earns: a fixed 0.25 percent fee on USDC going into assets, set in the contract and impossible to change. A per-employee subscription for businesses is planned.

## 2. Proposed new anchor

This is the paragraph the build is checked against, followed by the numbered parts a reviewer can tick off.

> Stackday is a payroll and investing app on Base. After connecting a wallet on the landing page, each person chooses an Individual or a Business account and gets a profile with a unique ID. Businesses fund a USDC treasury and pay their team once or on a schedule, and employees claim to any wallet they choose. Before claiming, an employee can send a share of their salary, once or on every payday, into Coinbase tokenized stocks (and Bitcoin or Ether tokens) held in a vault only they control. Individuals without an employer invest the same way, on a regular schedule from their own wallet. Positions grow through automatically reinvested dividends, and idle USDC can earn interest on Morpho or Aave. When cash is needed, the person borrows USDC against their holdings through the existing Morpho and Aave markets instead of selling, and because every payday adds more collateral, the loan gets safer as the weeks go by. A Themes layer reads market news and sentiment, suggests tokenized stocks by the themes a person cares about, and proposes rebalances from time to time. Confidential salary payments are planned as the next step.

### The parts, with today's status

| # | Part of the anchor | Status today |
|---|---|---|
| 1 | Landing page is the start of the platform | Built |
| 2 | Start, connect wallet, then choose Individual or Business | NOT built. Today every page is open to any connected wallet with no account type |
| 3 | A profile with a unique ID is created in Supabase for each new user | PARTLY. The database is connected and each wallet can pick a unique name. There is no automatic unique ID and no profile created on first visit |
| 4 | New business adds business name and description | NOT built |
| 5 | Business account shows the owner dashboard or the employee dashboard depending on who the person is | PARTLY. Both dashboards exist (Run payroll, and Dashboard with Get paid) but the app does not route people by role |
| 6 | A business can find people (see open question A) | NOT built. Today the owner pastes a wallet address |
| 7 | Businesses fund a treasury and pay once or on a schedule | Built, tested, shown on testnet |
| 8 | Employees claim to any wallet, with a share into assets, once or every payday | Built, tested, shown on testnet |
| 9 | Coinbase tokenized stocks, plus Bitcoin and Ether tokens | Built with mock tokens on testnet. The same code is tested with the real AAPLc token on a copy of Base mainnet. BTC and ETH have no mainnet test yet |
| 10 | A vault only they control | Built, tested |
| 11 | Individuals invest regularly from their own wallet | Built, tested. No Individual account type around it yet |
| 12 | Dividends reinvested | A property of the real tokens. The testnet mocks pay none |
| 13 | Idle USDC earns interest on Morpho or Aave | Built for Morpho-style vaults (mock on testnet, real Morpho vault tested on a mainnet copy). Aave NOT built |
| 14 | Borrow against holdings through Morpho and Aave instead of selling | Built on Morpho. Aave NOT built |
| 15 | Every payday adds collateral, the loan gets safer | Built, tested |
| 16 | Themes: news and sentiment, stocks by theme, rebalancing | NOT built (see open question B) |
| 17 | Confidential salaries | Next step, not built |

Supporting parts that stay required: one risk screen with a stress test, honest labels on everything mocked, the fixed fee, attendance as a record only, and the safety checks in docs/SECURITY-CHECKLIST.md.

## 3. Open questions for the founder

A. "Business should be able to find": the sentence in the request stops there. This draft assumes it means a business can find and add employees by their unique ID or name, instead of pasting a wallet address. If it meant something else (for example people finding a business to join), say so.

B. Themes is a second product inside the first. To buy by theme it needs a news and sentiment source and an AI model. To rebalance it needs selling, which the contracts cannot do yet: today they only buy. Because the vault must stay under its owner's control, a rebalance should be a proposal the owner approves (or a rule the owner sets in advance with limits), never something Stackday does on its own. There are 20 days to the deadline and the account flow in parts 2 to 6 is not built either. Recommended: build the account flow first, then Themes as "suggest a split by theme, the user confirms the buys", and leave automatic rebalancing as a stated next step. Suggesting specific investments to a person can also count as investment advice in many places, so the wording must stay "information, not advice" and the compliance responsibility is the team's.

C. Individual versus Business: can one wallet be both (for example a business owner who also invests personally)? This draft assumes yes: the choice sets the default dashboard and can be switched.

D. Who counts as an employee: this draft assumes a wallet is an employee of a business when that business has added it to its team or to a payday. No approval step by the employee.

E. Bitcoin and Ether: this draft makes them part of the anchor, in brackets after stocks. The hackathon is about tokenized stocks, so they stay secondary.
