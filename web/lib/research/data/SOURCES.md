# Research data sources and their terms

Written for the founder on 2026-11-19, so the terms can be checked before anything goes live. Every quote below was copied from the page linked next to it on that date. Where a page could not be read, it says so: please read it yourself before switching the source on.

## Summary

| Data | Source | Key | Env var | Status |
|---|---|---|---|---|
| BTC, ETH, PAXG (gold) prices, hourly and daily | Coinbase Exchange public candles | none | none | Works now, no key |
| Stock and fund prices (AAPL, NVDA, GOOGL, META, MSFT, AMZN, TSLA, AMD, MSTR, SPY for the S&P 500, SGOV), hourly and daily | Twelve Data time series | free key | `RESEARCH_PRICE_API_KEY` | Off until the founder sets a key and accepts the terms below |
| Company filings | SEC EDGAR submissions API | none, but a User-Agent with a contact | `SEC_USER_AGENT` | Off until the founder sets it |
| Company news | Official newsroom RSS or Atom feeds | none | none | Works now |
| Market holidays and early closes | NYSE published calendar | none | none | Built into code for 2026 and 2027 |

Weekly and monthly bars are built in our code from the daily bars (open of the first day, highest high, lowest low, close of the last day), so they cost no extra requests. SpaceX has no public price and is never fetched. With a key or User-Agent missing, the asset is listed in `problems` and nothing is filled in.

## 1. Coinbase Exchange public candles (crypto and PAXG)

- Endpoint: `https://api.exchange.coinbase.com/products/{BTC-USD|ETH-USD|PAXG-USD}/candles`
- Docs: https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
- Rate limits: https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits
- Quotes:
  - "The maximum number of data points for a single request is `300` candles."
  - Granularity "must be one of the following "second" values: `{60, 300, 900, 3600, 21600, 86400}`"
  - "Requests per second per IP: 10"
  - "Historical rates should *not* be polled frequently."
- How we use it: one hourly request plus up to 7 daily requests per asset per run, spaced 150 ms apart, once a day.
- Not read: the Coinbase market data terms page (https://www.coinbase.com/legal/market_data) returned HTTP 403 to our fetch, and the docs pages above do not state a display or redistribution rule. **Founder: please read Coinbase's market data and API terms before public display.**

## 2. Twelve Data time series (stocks and funds)

- Endpoint: `https://api.twelvedata.com/time_series` (two calls per asset per run: `1h` with 500 bars, `1day` with 1300 bars, `timezone=UTC`)
- Terms: https://twelvedata.com/terms (last updated January 1, 2026)
- Pricing: https://twelvedata.com/pricing
- Free Basic plan: 8 API credits per minute, 800 a day, described on the pricing page as "For testing and side projects" with "Internal non-display usage".
- Quotes from the terms:
  - 2.3(l), prohibited: "Use Free Tier data for commercial purposes"
  - 2.1: "access and use the Platform solely for Internal Use during the subscription term"
  - Definition of Internal Use: "use solely for Customer's internal business purposes and not for redistribution or external commercial purposes."
  - Definition of Non-Display Use: "any use of Data that does not involve displaying the Data to natural persons."
  - 2.2(e): "Redistribute or provide external display of Data only if and as expressly authorized"
  - 2.4: "may permit limited redistribution or external display of Data, subject to additional terms, attribution requirements"
  - 2.3(h), prohibited: "Use automated tools to exceed API Rate Limits or create excessive load"
- How we use it: 11 symbols x 2 calls = 22 credits a run, spaced 7.6 seconds apart (under 8 a minute), so a full stock refresh takes about 3 minutes.
- **Founder decision needed.** Our reading: the free Basic key covers internal, non-display use, which fits building and testing the engine, but showing the prices on the public site is "external display" and needs a plan or written permission from Twelve Data (contact in 2.4: sales@twelvedata.com). Options: (a) ask Twelve Data whether a non-commercial testnet hackathon demo may display free-tier data with attribution, (b) buy a plan that includes display, or (c) keep stock prices internal and show only the engine's text and levels until one of those is settled.
- The provider sits behind one function (`fetchPriceHistory` in prices.ts with the `PRICE_SOURCES` map), so swapping it is a small change.

### Alternatives checked (none plainly allows free public display)

- Tiingo, https://www.tiingo.com/about/pricing and https://www.tiingo.com/tos: free Starter is "Internal Use Only"; pricing page: "you may not display or share the data with another person or organization".
- Finnhub, https://finnhub.io/terms-of-service: "You hereby agree to not redistribute or share access to data or derived results from the data obtained from Finnhub".
- Alpha Vantage, https://www.alphavantage.co/support/: free tier is "25 API requests per day" (too few for 11 symbols), and it offers "unlimited API requests for verified open-source or educational projects". Its terms page is a PDF we could not read.
- Alpaca, https://alpaca.markets/data: free IEX feed, 200 calls a minute; display terms are in exchange agreements we did not read.
- Unofficial scraping endpoints (for example Yahoo Finance) are not used, as instructed.

## 3. SEC EDGAR submissions API (filings)

- Endpoint: `https://data.sec.gov/submissions/CIK##########.json` (CIK from `universe.ts`)
- API docs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces ("These APIs do not require any authentication or API keys to access.")
- Fair access: https://www.sec.gov/os/accessing-edgar-data
  - "Current max request rate: 10 requests/second."
  - "Please declare your user agent in request headers:" with the sample "Sample Company Name AdminContact@<sample company domain>.com"
  - "Download only what you need and please moderate requests to minimize server load."
- How we use it: one request per stock per run, spaced 125 ms apart (at most 8 a second). We keep 10-K, 10-Q, 8-K, proxy and registration filings from the last 120 days, at most 5 per asset, and link each to its document on sec.gov. Insider forms 3, 4 and 5 are left out.
- **Founder: set `SEC_USER_AGENT`** to a company name and a contact email you control, for example `Stackday Research ops@yourdomain`. Without it EDGAR is skipped and the run log says so. SEC blocks requests without a declared contact.
- SEC filings are public records from a US government agency.

## 4. Company newsroom feeds (news)

Feeds the companies publish for subscribers, checked 2026-11-19 (HTTP 200):

| Asset | Feed |
|---|---|
| Apple | https://www.apple.com/newsroom/rss-feed.rss |
| NVIDIA | https://nvidianews.nvidia.com/releases.xml |
| Microsoft | https://news.microsoft.com/feed/ |
| Meta | https://about.fb.com/news/feed/ |
| Alphabet | https://blog.google/rss/ |
| Amazon | https://www.aboutamazon.com/rss/feed.rss |
| AMD | https://ir.amd.com/news-events/press-releases/rss |

Tesla and Strategy (MSTR) had no working public feed (404 or 403), so they rely on SEC 8-K filings. Alphabet investor relations had none either, so Alphabet uses the Google blog feed. We store only the headline, link, date and a quote of at most 25 words copied from the feed's own summary, and every item links back to the company's page. We did not find separate terms pages for these feeds; they are published for syndication, but **the founder may want to confirm** before public display.

Feed text is untrusted: it is cleaned with the Themes guard (`sanitizeText` and `safeUrl` from `lib/themes/mood.ts`), and any item that reads like instructions to an AI is dropped and logged.

## 5. NYSE trading calendar

- https://www.nyse.com/markets/hours-calendars: "All NYSE markets observe U.S. holidays as listed below for 2026, 2027, and 2028."
- Copied into `calendar.ts`: the 10 holidays of 2026 and of 2027, and the 1:00 p.m. early closes on November 27, 2026, December 24, 2026 and November 26, 2027 (NYSE lists no other 2027 early close).
- Years after 2027 are not loaded: the run then reports it in `problems` and only knows weekends. Add 2028 from the same page before the end of 2027.

## Recorded fixtures

`fixtures/*.json` hold real responses recorded on 2026-11-19 (`recordedAt` in each file) by `record-fixtures.ts`, so `npm test` never uses the network. Coinbase and the Apple newsroom were recorded as returned. Twelve Data answered with its public `demo` key, which only serves a few symbols such as AAPL. The SEC response was fetched the same day in a browser and trimmed to the 25 newest filings and the fields we read. No keys are stored in the fixtures.
