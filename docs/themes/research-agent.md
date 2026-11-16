# Research summary: news agents, evidence and a backtest

A short summary of research done on November 16, 2026, outside this repo (Mutual Interest `docs/07-research-agent.md`). Four research passes and a separate reviewer checked every number against its source. It shapes the weekly plan (weekly-plan.md) and what the app may say.

**Not investment advice. Every backtest number below is illustrative, not a forecast. The assets on testnet are mock tokens.**

## TL;DR

1. **How research agents work.** Fetch news, filings and prices; a language model reads and scores; code combines scores; rules build the portfolio under risk limits. In serious products the model only reads and explains. That is our design.
2. **No credible evidence of an edge for us.** We found no published evidence that a weekly news or LLM signal on mega-cap stocks beats the market after costs. Documented news effects last minutes to about 3 days, are strongest in small stocks, mostly disappear after costs, and are shrinking as LLM use spreads.
3. **What does help retail investors:** investing every paycheck automatically, low costs, capped positions and staying invested through crashes. Investors trail their own funds by about 1.2 points a year (Morningstar, 10 years to end-2024), more than any documented large-cap news-signal gain.
4. **Treat mood as an explainer and a risk flag, not a source of profit.** Log every week against plain weekly buying, and turn the tilt off if it does not help (weekly-plan.md, Evaluation).

## What we must not claim

- "AI beats the market", "AI alpha" or any outperformance.
- Backtested returns as expected returns.
- That the mood score predicts prices. Say it **summarises recent news**.
- That guards "protect" the portfolio, that the value tilt "buys low", or that rebalancing "adds return".
- "Safe", "guaranteed" or "can't lose". Tokenized assets add smart-contract, issuer, custody and liquidity risk.

**Fair to say:** automatic weekly investing, cost control (no selling, low turnover, fees shown), bounded splits (targets, bands), the model explains and never decides, and honest measurement against plain weekly buying.

## History highlights (adjusted closes, Yahoo Finance, to November 13, 2026)

- **Big gains and big falls:** AMZN -94% (1999 to 2001), ETH -94% (2018), NVDA -90% (2002), BTC -83% (2017 to 2018), AAPL -82% (2000 to 2003).
- **Every one of the 9 testnet assets lost money in 2022**, from -26% (AAPL) to -68% (ETH).
- **Slow recoveries happen:** MSFT took 14.6 years to get back to its 1999 peak.
- **They move together when it matters:** in 2022, 13 of 21 stock pairs had weekly correlation of 0.6 or more, and BTC with ETH reached 0.93. Crypto diversified least exactly when it was needed.

## Backtest of the Balanced policy (illustrative)

$100 a week, 30 bps per buy, no sales, signals only from data before each buy, 24 rolling 3-year windows from 2018 to 2026:

- **Against an equal-weight weekly plan** with the same new-money-only rebalancing, the policy earned less in 24 of 24 windows (median 10.5 points of money-weighted return a year, about $3,200 on $15,600 put in). In exchange it fell less in 24 of 24 (median about 10 points shallower).
- **Smart DCA lost to plain weekly buying in 24 of 24 windows** (median 1.4 points a year). With a fixed paycheck it can only spend money it parked earlier, so in long rises it left cash idle. **It is removed** (policy.md).
- **New money cannot hold the caps.** Holdings drifted to about 41% crypto and about 31% in one stock, with NVDA plus MSFT at about 38%. **The caps are therefore targets for new buys, not limits on holdings.** Holding them as limits needs a sell path, a contract change proposed in its own issue.

## Caveats

- **Survivorship and hindsight bias.** These 9 are today's winners, chosen in 2026 knowing how they turned out. GE, Intel, Cisco and Citigroup were among the 50 largest US-traded companies in 2000. From their 2000 peaks they took 17 to 24 years to recover in total-return terms, and Citigroup is still 59% down. Any "beats the S&P 500" result on this list is mostly hindsight.
- **Few independent tests.** The 24 windows overlap: they are roughly three independent 3-year periods, all in one 2018 to 2026 regime that favoured these assets.
- **Very sensitive to start dates.** Moving the start by one quarter changed one plan's 3-year return by up to 65 points.
- **Short crypto history.** BTC from 2014, ETH from late 2017, both with falls above 80%.
- **Not tested:** news mood (no clean historical data, and replaying old news through a model is contaminated by what it memorised), P/E, taxes and the real tokens' own risks (custody, issuer, trading hours, dividends that may not pass through).
- **A few winners carried the results**, NVDA, TSLA and BTC in particular.
