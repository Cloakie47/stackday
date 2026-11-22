# Research data sources and their terms

Written for the founder on 2026-11-19 and updated on 2026-11-20 for the research spec (docs/research/SPEC.md, section 5) and on 2026-11-22 for the PR 71 review. Every quote below was copied from the page linked next to it on that date. Where a page could not be read, it says so: please read it yourself before switching the source on for public pages.

"Display" means showing the numbers or headlines to users on the public site. "Internal" means the engine and the founder or growth reviewers only. In code, a fact built from a source whose terms do not allow display carries `display: false` (the `Fact.display` field), so the engine can tell internal facts apart.

## Summary

| Data | Source | Key | Env var | Works with no key | Display |
|---|---|---|---|---|---|
| BTC, ETH, PAXG prices (1h, 1d; 1w and 1mo built from 1d) | Coinbase Exchange public candles | none | none | yes | check terms (page not readable to us) |
| AAPL, NVDA, S&P 500 (SPY) prices | pluggable, `RESEARCH_PRICE_PROVIDER`: `none` by default, `twelvedata` for internal review only | Twelve Data key | `RESEARCH_PRICE_API_KEY` | no: "no reading" | **no** on the Twelve Data free plan: every fact from it has `display: false` |
| Rates, real yields, Fed target, dollar, VIX, S&P 500 trend, CPI, payrolls, unemployment | FRED (St. Louis Fed) | optional | `FRED_API_KEY` | yes (public CSV) | yes with citation, except S&P 500 and VIX facts: `display: false` unless `RESEARCH_SHOW_SP_VIX=1` (see 3) |
| FOMC meeting dates | Federal Reserve FOMC calendar page, plus checked-in 2026 and 2027 dates | none | none | yes | yes (US government) |
| CPI and jobs report dates | BLS release schedules, checked-in copy (BLS refuses automated clients) | none | none | yes (copy) | yes (US government) |
| PCE and GDP dates | BEA release schedule page, plus checked-in copy | none | none | yes | yes (US government) |
| Options expiry | computed in code | none | none | yes | yes |
| Headlines from reputable outlets (geopolitics, tariffs, export controls, sanctions, Fed, regulation) | GDELT DOC 2.0 API, filtered to a domain whitelist | none | none | yes, when GDELT is not rate limiting | headline, outlet, date and link only, with GDELT citation |
| Official releases | Federal Reserve, SEC and Treasury OFAC feeds | none | none | Fed and SEC yes; OFAC refused us (403) | yes (US government) |
| Company news (one side only) | Apple and NVIDIA newsroom feeds | none | none | yes | headline and link, confirm |
| Company filings | SEC EDGAR submissions API | User-Agent with contact | `SEC_USER_AGENT` | no: skipped with a problem line | yes (public records) |
| BTC and ETH funding rates | Binance USD-M futures public API, Deribit public API as fallback | none | none | yes (Binance answers 451 in some regions, then Deribit) | check terms |
| Stablecoin supply | DefiLlama stablecoins API | none | none | yes | check terms |
| Bitcoin and Ether ETF flows | none | | | **no reading** | |
| Fed funds expectations (futures) | none | | | **no reading** | |
| Central bank gold buying | none | | | **no reading** | |
| Earnings dates (NVDA, AAPL) | none wired | | | omitted, with a problem line | |
| NYSE holidays and early closes | NYSE published calendar, in code for 2026 and 2027 | none | none | yes | yes |

With a key or User-Agent missing, or a source failing, the item is a "no reading" line in `problems` and nothing is filled in. Every fact carries its source name, a link and a time.

## 1. Coinbase Exchange public candles (crypto and PAXG)

- Endpoint: `https://api.exchange.coinbase.com/products/{BTC-USD|ETH-USD|PAXG-USD}/candles`
- Docs: https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
- Rate limits: https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits
- Quotes: "The maximum number of data points for a single request is `300` candles." "Requests per second per IP: 10". "Historical rates should *not* be polled frequently."
- How we use it: one hourly request plus up to 7 daily requests per asset per run, spaced 150 ms apart.
- Not read: the Coinbase market data terms page (https://www.coinbase.com/legal/market_data) returned HTTP 403 to our fetch. **Founder: please read it before public display.**

## 2. Stock prices: pluggable provider (`RESEARCH_PRICE_PROVIDER`)

- `RESEARCH_PRICE_PROVIDER` is `none` by default: no wired provider allows display and commercial use, so stock prices stay off. `twelvedata` uses Twelve Data with `RESEARCH_PRICE_API_KEY` for the engine and internal review only: every fact built from its prices (price, changes, indicators, chart read, patterns) carries `display: false`, and the run log says so. Any other value is refused with a problem line. `STOCK_PROVIDERS` in prices.ts records for each provider whether its plan allows display and commercial use; today none does.
- Twelve Data terms: https://twelvedata.com/terms. The free Basic plan is described on https://twelvedata.com/pricing as "Internal non-display usage". Terms: "Use Free Tier data for commercial purposes" is prohibited (2.3(l)); display needs authorization (2.2(e)).
- **The Twelve Data free plan does not allow display.** Stock prices fetched with it are for the engine and internal review only.
- Alternatives checked on 2026-11-19, none plainly allows free public display: Tiingo (free plan "Internal Use Only"), Finnhub (no redistribution), Alpha Vantage (25 requests a day), Alpaca (display terms sit in exchange agreements we did not read). Unofficial scraping endpoints are not used.
- **Founder decision needed:** a paid plan or written permission from a provider that allows display and commercial use (for example a Twelve Data plan with display rights). Adding a provider is one entry in `STOCK_PROVIDERS` (with `display` and `commercial` true), one fetch function and making it the default.
- The S&P 500 is priced through the SPY ETF and labelled as such.

## 3. FRED (St. Louis Fed): macro series

- Without a key: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES&cosd=START`. With `FRED_API_KEY`: `https://api.stlouisfed.org/fred/series/observations` (falls back to the CSV if the API fails).
- Series: DGS2, DGS10 (Treasury yields), DFII10 (10-year real yield), DFF (effective fed funds), DFEDTARL and DFEDTARU (target range), DTWEXBGS (broad dollar index), VIXCLS (VIX), SP500, CPIAUCSL and CPILFESL (CPI and core CPI, year over year), PAYEMS (payroll change), UNRATE.
- Computed in code: changes over 5 and 20 observations, the 2s10s curve, the target range, CPI year over year, the payroll change, and whether the S&P 500 is above its 50- and 200-day averages.
- Terms: https://fred.stlouisfed.org/legal/. Attribution to the original source "accessed through FRED" is required. Quote: "Series with a copyright notice are owned by third parties and have special restrictions."
- The SP500 series page says: "Reproduction of S&P 500 in any form is prohibited except with the prior written permission of S&P Dow Jones Indices LLC." So we **never publish the S&P 500 level**. Its percent changes and the trend against its averages, and every VIX fact (VIXCLS is owned by Cboe; its notice is on https://fred.stlouisfed.org/series/VIXCLS), are kept for the engine but carry `display: false` until `RESEARCH_SHOW_SP_VIX=1` is set (off by default). **Founder decision pending: allow them, or drop SP500 and use the SPY price once a display-licensed stock provider is in place.**
- No look-ahead (macro.ts, `releasedFrom`): FRED dates an observation by the period it measures, not by its release, so each series has a release lag. Daily series are used from the day after the observation. CPI is used from the day after its BLS release when the month is in the checked-in BLS schedule (events.ts, through December 2027), otherwise from the 16th of the next month. Payrolls and unemployment are used from the day after the jobs report when it is checked in, otherwise from the 11th of the next month. A run dated on a release day does not see that release (BLS publishes at 8:30 a.m. New York time, after the 12:00 UTC run). Example: October CPI (dated October 1) is not visible in a run on October 20.
- Revisions: for a backfill (run date before today) with `FRED_API_KEY` set, the API is asked for the ALFRED vintage as of the run date (`realtime_start` and `realtime_end` set to it), so values are the ones first published. The public CSV has no vintages, so a backfill without a key uses revised values and the run log says so.
- **Founder note on the FRED API key:** the API terms reportedly prohibit using FRED content "to build or train AI systems" and caching it. We only pass current readings to the model as context and do not train anything, but please read the API terms before setting `FRED_API_KEY`. The public CSV path works without the key.
- Treasury yields (H.15), the dollar index and the fed funds rate are Federal Reserve data; CPI, payrolls and unemployment are BLS data, all US government works.

## 4. Official calendar

- FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm, parsed in code. On 2026-11-20 it listed 2026 but not yet 2027, so 2027 (and January 2028) come from the press release of November 12, 2026, https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm. The October 26-27, 2027 meeting is a strategy meeting with no policy decision announced, and is labelled that way. Decisions are at 2:00 p.m. New York time.
- Re-checked 2026-11-22: the page now lists 2027 with the same dates (January, March, April, June, July, September, October strategy meeting, November; no December meeting) and January 25-26, 2028. Neither the page nor the press release marks 2027 meetings with a Summary of Economic Projections yet (the page's asterisk). The checked-in copy marks March, June and September 2027 by the usual pattern (projections at the March, June, September and December meetings), and the event says "expected by the usual quarterly pattern (not yet marked by the Fed)". November 2027 is left unmarked because there is no December meeting to follow the pattern. When the page stars a 2027 meeting, the page's marks win.
- When the FOMC, BLS or BEA page cannot be read, the run log says so and the checked-in copy is used; events from a copy cite it as "checked-in copy read (date)", never as the live page.
- CPI and the jobs report: https://www.bls.gov/schedule/news_release/cpi.htm and https://www.bls.gov/schedule/news_release/empsit.htm. BLS answers HTTP 403 to automated clients, so `BLS_FALLBACK` in events.ts holds the dates the pages listed on 2026-11-20 (through December 2027). The code still tries the page first.
- PCE and GDP: https://www.bea.gov/news/schedule, parsed in code; `BEA_FALLBACK` holds the four releases it listed on 2026-11-20 (through December 23, 2026). BEA publishes only a few weeks ahead, so after that a failed page is a "no reading" line.
- events.test.ts fails once the FOMC or BLS copies run out and prints a warning 120 days before.
- Options expiry is computed: third Friday of the month for US equity and index options (moved earlier on an NYSE holiday), last Friday at 08:00 UTC for Deribit's monthly Bitcoin and Ether options.
- Fed speeches and earnings dates are not included yet: no official machine-readable schedule is wired. Earnings are reported as omitted, never guessed.

## 5. Headlines from reputable outlets (GDELT)

- API: `https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=artlist&format=json`, docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- Terms: https://www.gdeltproject.org/about.html: datasets are "available for unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee", and use "must include a citation to the GDELT Project and a link to this website."
- Rate: GDELT asks for at most one request every 5 seconds. We send 7 a run (6 assets and the market), 5.5 seconds apart, and retry once after 6 seconds on HTTP 429. On 2026-11-20 GDELT answered 429 to every request from our network, so the recorded fixture uses synthetic GDELT responses (marked "TEST FIXTURE") and a live run may log "no reading" for headlines.
- GDELT refuses long queries: with all twelve domains in the query it answered "Your query was too short or too long." So each query names only Reuters, AP, Bloomberg, CNBC and the FT (plus the WSJ, or CoinDesk for crypto) and stays under 200 characters (a test checks this).
- Domain whitelist (checked again in code on the host name of every article's link, `new URL(url).hostname`, not GDELT's `domain` field; subdomains such as www. pass, lookalikes such as reuters.com.evil.io do not): reuters.com, apnews.com, bloomberg.com, ft.com, wsj.com, cnbc.com, bbc.co.uk, bbc.com, nytimes.com, economist.com, theguardian.com, npr.org; plus coindesk.com for the crypto assets only.
- Topics per asset are in `GDELT_TOPICS` (tariffs, export controls and China for NVIDIA, antitrust and China for Apple, regulation and ETFs for crypto, central banks and sanctions for gold, Fed and conflicts for the market). Tags such as "geopolitics", "tariffs", "export-controls", "sanctions", "fed", "regulation" are set by code (`TOPICS` in headlines.ts).
- We keep the headline, the outlet, the date and the link, and never fetch the article, so paywalled outlets are not scraped. **Founder: the spec asks for a licensed news API; GDELT is a free open index of headlines, not a licence to the articles. A licensed feed is still your decision.**

## 6. Official feeds

| Feed | URL | Status 2026-11-20 |
|---|---|---|
| Federal Reserve press releases | https://www.federalreserve.gov/feeds/press_all.xml | 200 |
| SEC press releases | https://www.sec.gov/news/pressreleases.rss | 200 |
| US Treasury OFAC recent actions | https://ofac.treasury.gov/system/files/126/ofac.xml | 403 to our client, reported as "no reading" |

Treasury press release feeds on home.treasury.gov timed out for us and are not wired. The market input takes every official item from the last 7 days; an asset takes the items that match its keywords (`ASSET_KEYWORDS`).

## 7. Company newsroom feeds (one side)

| Asset | Feed |
|---|---|
| Apple | https://www.apple.com/newsroom/rss-feed.rss |
| NVIDIA | https://nvidianews.nvidia.com/releases.xml |

At most 3 per asset, tagged "press-release". When a company's releases are the only headlines for an asset, the run log says so. We store headline, link, date and a quote of at most 25 words from the feed's own summary. **Founder may want to confirm** display of these headlines.

All headline text is untrusted: cleaned with the Themes guard (`sanitizeText`, `safeUrl` from `lib/themes/mood.ts`), and any item that reads like instructions to an AI is dropped and logged.

## 8. SEC EDGAR (filings)

- `https://data.sec.gov/submissions/CIK##########.json`, docs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces ("These APIs do not require any authentication or API keys to access.")
- Fair access, https://www.sec.gov/os/accessing-edgar-data: "Current max request rate: 10 requests/second." and "Please declare your user agent in request headers".
- **Founder: set `SEC_USER_AGENT`** to a company name and a contact email you control. Without it EDGAR is skipped and the run log says so.

## 9. Crypto flows

- Funding rates: Binance `https://fapi.binance.com/fapi/v1/fundingRate` (docs https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History). Binance refuses some regions with HTTP 451, which may include US cloud regions such as Vercel's default, so Deribit `https://www.deribit.com/api/v2/public/get_funding_rate_history` (docs https://docs.deribit.com/) is the fallback. We publish the latest 8-hour rate and the 7-day average, annualised. Neither venue's terms page was read in this pass: **check before display**.
- Stablecoin supply: DefiLlama `https://stablecoins.llama.fi/stablecoins?includePrices=false` (docs https://api-docs.defillama.com/), summed over USD-pegged stablecoins, with the 7-day and 30-day change. It gives current figures only, so a backfill for an earlier date is "no reading". Terms not read in this pass: **check before display**.
- ETF flows: issuer pages and aggregators either have no machine-readable feed or terms that do not clearly allow automated use. **No reading** until the founder picks a source.
- Gold: real yields and the dollar come from FRED. Central bank buying (World Gold Council) is **no reading** until its terms are checked.

## 10. NYSE trading calendar

- https://www.nyse.com/markets/hours-calendars: holidays and 1:00 p.m. early closes for 2026 and 2027 are in calendar.ts. Add 2028 from the same page before the end of 2027.

## Recorded fixtures

`fixtures/*.json` hold responses keyed by URL, so `npm test` never uses the network. `mAAPL.json` (2026-11-19) holds Twelve Data with its public `demo` key, the Apple newsroom and a trimmed SEC EDGAR response. `run.json` holds a whole run recorded on 2026-11-20 by `record-fixtures.ts run`: Coinbase, FRED, the Fed, BEA and BLS pages, Fed and SEC feeds, Binance or Deribit and DefiLlama as returned (large responses trimmed to the fields our parsers read, as its `note` says), plus synthetic GDELT responses because GDELT rate limited us. No keys are stored in the fixtures.
