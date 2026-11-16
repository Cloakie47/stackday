# Themes: text for the /docs page

Source text for the `/docs#themes` section of the site. The Themes page links here with "Learn more". It is written for people using the app, so it is short and plain. Copy it as is or trim it. Numbers match `web/lib/themes/policy.ts`.

## Themes

Pick the themes you care about and a risk level. Stackday suggests a split for your next buys across tokenized stocks, Bitcoin and Ether, and you decide whether to use it. The split comes from fixed, published rules. No AI model picks your investments. This is information, not advice, and it does not aim to beat the market.

Themes only use tokenized stocks that really exist on Base. On the test network only some of them have a mock token. The others are shown as a preview and are never bought.

### Risk levels

| | Steady | Balanced | Bold |
|---|---|---|---|
| Stocks | 65% | 73% | 70% |
| Bitcoin and Ether | 5% | 12% | 18% |
| Small risk slice | 0% | up to 5% | 7% |
| Cash cushion | 30% | 10% | 5% |

### Targets for new buys

Every suggested split keeps these targets:

- No single stock above 15%.
- No single theme above 40%. With one theme, at most 40% is invested; pick more themes to invest more.
- NVIDIA, Microsoft, Intel and Sandisk together at most 35%, because they tend to move together.
- Bitcoin, Ether and crypto companies together at most 25% (10% on Steady).
- Each volatile risk-slice name at most 2.5%.
- A cash cushion of at least 5% (20% on Steady).

These targets shape your **new** buys. They are not limits on what you hold: Stackday cannot sell for you, so a holding that rises can grow above its target and stay there. When that happens the Themes page shows a notice, and new money goes to other holdings first.

### The cash cushion

The cushion is not bought. On a payday plan it is paid to you with the rest of your salary. On a buy from your wallet it stays in your wallet.

### Using a split

- **From your salary:** save the split as your every-payday plan. Before each claim, the share you choose is bought into your own vault. Payday plans hold at most 6 assets.
- **From your wallet:** buy the split once, or set one recurring buy per asset.

Each buy refuses a price more than 1% worse than the reference price, and buying pauses for any asset whose price feed is frozen or whose transfers are paused. The 0.25% fee applies to each buy.

### Market mood

Market mood summarises recent news about each stock in your themes. Each article is scored for direction (good or bad), materiality (does it change the business, or is it noise) and how sure the score is. Filings count most, opinion pieces and social posts least, and older news fades over a few days.

Mood does not predict prices and does not change your amounts. A serious event, such as a CEO leaving, confirmed by a filing or two reliable sources, is flagged so you can look at it.

On the test site, mood comes from a snapshot built by hand from public headlines on one date. It is not live data.

### Rebalancing with new money

Prices move, so your vault drifts away from the split. A holding is off target when it is more than 5 points, or more than a quarter of its target, away.

When you add money (a payday share or a buy from your wallet), the rebalance proposal sends it to the holdings below target first, and nothing goes to holdings above target. Very small amounts stay as cash. You see the proposal and sign it, or ignore it. Rebalancing does not add return; it keeps the mix closer to what you chose.

### Good to know

- Tokenized stocks are for eligible people outside the United States and carry no voting rights.
- Prices can fall, a lot: every one of these assets lost money in 2022. Tokenized assets also carry smart-contract, issuer, custody and liquidity risk. Nothing here is safe or guaranteed, and nothing is a recommendation to buy.
- On the test network every asset is a mock token, and prices are mock prices.
