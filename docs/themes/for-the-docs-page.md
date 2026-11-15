# Themes: text for the /docs page

Source text for the `/docs#themes` section of the site. The Themes page links here with "Learn more". It is written for people using the app, so it is short and plain. Copy it as is or trim it. Numbers match `web/lib/themes/policy.ts`.

## Themes

Pick the themes you care about and a risk level. Stackday suggests a split across tokenized stocks, Bitcoin and Ether, and you decide whether to use it. The split comes from fixed, published rules. No AI model picks your investments. This is information, not advice.

Themes only use tokenized stocks that really exist on Base. On the test network only some of them have a mock token. The others are shown as a preview and are never bought.

### Risk levels

| | Steady | Balanced | Bold |
|---|---|---|---|
| Stocks | 65% | 73% | 70% |
| Bitcoin and Ether | 5% | 12% | 18% |
| Small risk slice | 0% | up to 5% | 7% |
| Cash cushion | 30% | 10% | 5% |

### The limits

Every split keeps these limits, whatever you pick:

- No single stock above 15%.
- No single theme above 40%. With one theme, at most 40% is invested; pick more themes to invest more.
- NVIDIA, Microsoft, Intel and Sandisk together at most 35%, because they tend to move together.
- Bitcoin, Ether and crypto companies together at most 25% (10% on Steady).
- Each volatile risk-slice name at most 2.5%.
- A cash cushion of at least 5% (20% on Steady).

When a limit is reached, the extra goes to other holdings with room, or stays as cash. Each line of the split says why it is there and which limit it hit.

### The cash cushion

The cushion is not bought. On a payday plan it is paid to you with the rest of your salary. On a buy from your wallet it stays in your wallet. It is dry powder for cheaper weeks and a buffer for price gaps.

### Using a split

- **From your salary:** save the split as your every-payday plan. Before each claim, the share you choose is bought into your own vault. Payday plans hold at most 6 assets.
- **From your wallet:** buy the split once, or set one recurring buy per asset.

Each buy refuses a price more than 1% worse than the reference price. The 0.25% fee applies to each buy.

### Market mood and buying pace

Market mood reads recent news about each stock in your themes. Each article is scored for direction (good or bad), materiality (does it change the business, or is it noise) and how sure the score is. Primary filings count most, opinion pieces and social posts count least, and older news fades over a few days.

Mood never changes what you buy, only how fast. The suggested pace runs from 0.5x to 1.5x of your usual amount:

- Good assets at a lower price, with calm or fearful news, means buy a little more.
- Hype or euphoria means buy less; the rest stays as cash.
- A serious event, such as a CEO leaving or a guidance cut, confirmed by a filing or two reliable sources, caps the pace at 1x. It never speeds buying up.

On the test site, mood comes from a snapshot built by hand from public headlines on one date. It is not live data. Value scores are not measured in that snapshot, so the pace only reacts to the news.

### Rebalancing with new money

Prices move, so your vault drifts away from the split. A holding is off target when it is more than 5 points, or more than a quarter of its target, away.

Stackday never sells for you. When you add money (a payday share or a buy from your wallet), the rebalance proposal sends it to the holdings below target first, and nothing goes to holdings above target. Very small amounts stay as cash, and a payday plan still holds at most 6 assets. You see the proposal and sign it, or ignore it.

### Good to know

- Tokenized stocks are for eligible people outside the United States and carry no voting rights.
- Prices can fall. Nothing here is a recommendation to buy anything.
- On the test network every asset is a mock token, and prices are mock prices.
