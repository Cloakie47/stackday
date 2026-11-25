# Research data sources and their terms

Written for the founder on 2026-11-19 and updated on 2026-11-20 for the research spec (docs/research/SPEC.md, section 5) on 2026-11-22 for the PR 71 review, and on 2026-11-25 for the founder's decision to price the stock tokens from chain (section 2) and the PR 71 re-review (sections 3 and 4). Every quote below was copied from the page linked next to it on that date. Where a page could not be read, it says so: please read it yourself before switching the source on for public pages.

"Display" means showing the numbers or headlines to users on the public site. "Internal" means the engine and the founder or growth reviewers only. In code, a fact built from a source whose terms do not allow display carries `display: false` (the `Fact.display` field), so the engine can tell internal facts apart.

## Summary

| Data | Source | Key | Env var | Works with no key | Display |
|---|---|---|---|---|---|
| BTC, ETH, PAXG prices (1h, 1d; 1w and 1mo built from 1d) | Coinbase Exchange public candles | none | none | yes | yes (`display: true`; founder decision 2026-11-25), terms page not readable to us |
| AAPLc, NVDAc, deSPXA on-chain prices on Base (1d; 1w and 1mo built from 1d) | Chainlink "Coinbase AAPL" and "Coinbase NVDA" feeds, the deSPXA Morpho market oracle, the main AAPLc, NVDAc and deSPXA pools; read over a public Base RPC plus a checked-in backfill | none | `RESEARCH_BASE_RPC_URL` (optional, public default) | yes | yes (`display: true`): public blockchain data, labelled as the token's on-chain price, not the exchange price |
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

## 2. Stock tokens: on-chain prices on Base mainnet (onchain.ts)

Founder decision of 2026-11-25 (spec section 5): price Apple, NVIDIA and the S&P 500 from the tokens' own on-chain prices on Base and drop the previous stock data provider completely. Every fact says "on-chain price of AAPLc (NVDAc, deSPXA) on Base, not Apple's (NVIDIA's) exchange price (the S&P 500 index)" and cites the feed, oracle or pool address with the round or block it was read at. Reads are read-only JSON-RPC calls (`eth_call`, `eth_getLogs`, `eth_getBlockByNumber`): no wallet, no transactions, no keys.

| Asset | Current price | Daily bars | Volume |
|---|---|---|---|
| Apple, token AAPLc `0xb200000000000000000000c2e324d24d7eecd1fb` (8 decimals) | Chainlink "Coinbase AAPL" `0x787f13dEa48Db0897CbCDD985de77809D837F988` (8 decimals), `latestRoundData` | feed rounds: phase 1 rounds 1 to 73 (aggregator `0xcae1fdaa5f7e3c3643476ac349eb65a4f6f3a126`, August 3 to 14, 2026), phase 2 from round 1 (aggregator `0xc37b6f754e90d4cca1f533f5a08f7d532b3d0d9d`, from August 5, 2026) | AAPLc/USDC pool `0xf5fcb9cdafce67d50afef298f88e709d2b946ba6` (token0 USDC, token1 AAPLc, fee 158, tick spacing 10, factory `0x9cb220581b91b0c83223012fe69688b92ad07a76`), from the backfill only |
| NVIDIA, token NVDAc `0xb20000000000000000000078ee7ce2fe4908108c` (8 decimals) | Chainlink "Coinbase NVDA" `0x04689a41629776563E6822F76f2e57D148d28513` (8 decimals) | phase 1 rounds 1 to 115 (aggregator `0x1469c86475f6356de848349d64c45c43189a8f6e`), phase 2 from round 1 (aggregator `0xf72b1eb5932800f3d2a5eec5f99e6cd586479675`) | NVDAc/USDC pool `0xf668e21993f0acd7ab00bb1cfbaed0df28a3c8ec` (token0 USDC, token1 NVDAc, fee 399, same factory), from the backfill only |
| S&P 500, fund token deSPXA `0x9c5c365e764829876243d0b289733b9d2b729685` (18 decimals) | Morpho market oracle `0x98c27f1C7772d66bCF837F0b8A435A31E6e85b6d`, `price()` | deSPXA/USDC Uniswap v3 pool `0xd08f1fb797bfacded23323178672557034c64cfa` (token0 USDC, token1 deSPXA, fee 500, factory `0x33128a8fc17869897dce68ed026d694621f6fdfd`): Swap events | same pool, backfill plus live tail |

What was checked on chain on 2026-11-25 (block about 61,978,500, chain id 8453), and is checked again on every run (chain id, feed description and decimals, pool token0 and token1):

- Feeds: `description()` returned "Coinbase AAPL" and "Coinbase NVDA", `decimals()` 8, `phaseId()` 2. `latestRoundData()`: AAPL 354.50 (round 2.630, 2026-11-24 21:01 UTC), NVDA 152.04 (round 2.1848). These match the founder's 354.50 and 152.04.
- Pools: `slot0()` gave 352.85 USDC per AAPLc, 152.01 per NVDAc and 738.39 per deSPXA (founder's last pool closes: 351.54, 151.21, 741.19). The AAPLc and NVDAc pools are 45-byte minimal proxies with a 6-field `slot0` (a Slipstream-style pool); their Swap event has the Uniswap v3 layout.
- Oracle: Morpho Blue `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` market `0x4440abd9...206604` lends USDC against deSPXA with this oracle (LLTV 77 percent). Morpho prices are 1e36 times loan-token units per collateral-token unit, so the scale is 10^(36 + 6 - 18) = 1e24, derived from the token decimals; the oracle's own `SCALE_FACTOR()` is 1e6 with an 18-decimal `BASE_FEED_1` (`0x97165ad36d96567a521958cc46914160b968752b`), which gives the same 1e24. `price()` = 7.2045e26, so 720.45 USDC per deSPXA (founder: 720.54). The base feed always reports round 1 and emits no events, so the oracle has no history to read: past oracle values would need archive `eth_call`s.

How the bars are built:

- NYSE session calendar: a trading day's bar covers from the previous trading day's close to that day's close (16:00 New York, 13:00 on early closes). The tokens trade around the clock, so evening and weekend moves land in the next session's bar and the close is the on-chain price at the NYSE close.
- Chainlink bars: open is the price carried in from the last round before the window, high and low span it and every round in the window, close is the last round at or before the close. Measured: AAPL has 2 to 49 rounds per session (median 7), NVDA 3 to 133 (median 12); no session since August 5 had no round. A session without a round would be skipped and reported, never filled.
- Phases overlap from August 5 to 14, 2026 (the new aggregator posted before the proxy moved to it). Rule: a phase's rounds are used until the first round of the next phase. Rounds of the two phases within 10 minutes of each other differ by at most 0.36 percent (AAPL) and 0.31 percent (NVDA).
- deSPXA pool bars: hourly volume-weighted prices; a swap more than 2 percent from both neighbours while they agree is a single-swap spike and counts for volume only; a session with fewer than 3 priced trades is skipped and reported. The oracle is the current price; the pool's premium over it is its own fact (`px.pool.premium`: about +2.5 percent in our reads on 2026-11-25, 738.39 against 720.45; the founder measured about 2.9 percent), as is the pool price (`px.pool.last`) for all three tokens.
- No hourly bars for these assets.

Cost and the backfill (`onchain-backfill.json`, written by `build-onchain-backfill.ts`):

- Measured on 2026-11-25: Base now makes a block every 0.2 seconds (432,000 a day; about 2 seconds a block before early November). https://mainnet.base.org refused every `eth_getLogs` ("request limit reached"). The default RPC, https://base-rpc.publicnode.com, allows 50,000 blocks per `eth_getLogs` (about 2.8 hours now) and keeps about 11 million blocks (archive reads need a token). It answers JSON-RPC batches (200 `getRoundData` calls in about 250 ms) and sometimes HTTP 429. Other free endpoints allowed 50 or 100 blocks per request.
- Swaps per day: AAPLc about 6,500 (6 MB of logs a day), NVDAc about 26,000 (24 MB), deSPXA 2 to 700 (about 14 on 2026-11-24). Reading the AAPLc and NVDAc pools for one day takes 9 requests and up to 24 MB, so their volume comes from the backfill only, and sessions after it have no volume (the run log says so). The deSPXA pool tail is read at run time: 9 `eth_getLogs` ranges a day of gap, sent in JSON-RPC batches of 10. Measured on 2026-11-25 with a backfill ending 7 days earlier: 61 ranges in 7 batches, 9 requests in all, 8.7 seconds, and the bars matched the full backfill exactly; at that speed the 15-second budget covers about 10 to 12 days of gap, after which the rest is a problem line. Chainlink tails for the same test (100 AAPL and 300 NVDA rounds) took 1.0 and 1.3 seconds. Chainlink rounds after the backfill are read at run time in batches of 200.
- The run's on-chain read has a 15-second budget and 8-second request timeouts; anything not read is a problem line and the bars end there.
- The backfill records, per asset, every Chainlink round read (with the last round per phase) and the first and last pool block read with their times. Regenerate it before a run for current volume: `cd web; node lib/research/data/build-onchain-backfill.ts`. Pool history older than the RPC's window (on 2026-11-25: from September 12, 2026; the AAPLc and NVDAc pools start October 21) needs an archive RPC in `RESEARCH_BASE_RPC_URL`.

Honest limits:

- Short history: AAPL and NVDA feeds start on August 3, 2026 (about 80 sessions), the pools on October 21. So there is no 200-day average, no 52-week high or low and no golden or death cross yet, and the monthly chart has too few bars: each says "no reading" (`detectorMinBars` in chart.ts). deSPXA pool bars start where the backfill starts.
- The pool and the oracle disagree (deSPXA pool about 2.5 to 2.9 percent above the oracle); the oracle is the price, the premium is published separately. The deSPXA chart (levels, patterns) is built from pool prices, so it sits on the pool's level, not the oracle's; its facts name the pool.
- The RPC operator's terms (PublicNode, Allnodes) were not read in this pass: **check before relying on it in production, or set `RESEARCH_BASE_RPC_URL` to a provider you have terms with.** The data itself is public blockchain state.
- The S&P 500 index level from FRED stays `display: false` (section 3); the deSPXA token price replaces it for display.

## 3. FRED (St. Louis Fed): macro series

- Without a key: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES&cosd=START`. With `FRED_API_KEY`: `https://api.stlouisfed.org/fred/series/observations` (falls back to the CSV if the API fails).
- Series: DGS2, DGS10 (Treasury yields), DFII10 (10-year real yield), DFF (effective fed funds), DFEDTARL and DFEDTARU (target range), DTWEXBGS (broad dollar index), VIXCLS (VIX), SP500, CPIAUCSL and CPILFESL (CPI and core CPI, year over year), PAYEMS (payroll change), UNRATE.
- Computed in code: changes over 5 and 20 observations, the 2s10s curve, the target range, CPI year over year, the payroll change, and whether the S&P 500 is above its 50- and 200-day averages.
- Terms: https://fred.stlouisfed.org/legal/. Attribution to the original source "accessed through FRED" is required. Quote: "Series with a copyright notice are owned by third parties and have special restrictions."
- The SP500 series page says: "Reproduction of S&P 500 in any form is prohibited except with the prior written permission of S&P Dow Jones Indices LLC." So we **never publish the S&P 500 level**. Its percent changes and the trend against its averages, and every VIX fact (VIXCLS is owned by Cboe; its notice is on https://fred.stlouisfed.org/series/VIXCLS), are kept for the engine but carry `display: false` until `RESEARCH_SHOW_SP_VIX=1` is set (off by default). Founder decision of 2026-11-25: the FRED S&P 500 figures stay `display: false`; the deSPXA token's on-chain price (section 2) replaces them for display.
- No look-ahead (macro.ts, `releasedFrom`): FRED dates an observation by the period it measures, not by its release, so each series has a release lag. Daily series are used from the day after the observation. CPI is used from the day after its BLS release when the month is in the checked-in BLS schedule (events.ts, through December 2027), otherwise from the 16th of the next month. Payrolls and unemployment are used from the day after the jobs report when it is checked in, otherwise from the 11th of the next month. A run dated on a release day does not see that release (BLS publishes at 8:30 a.m. New York time, after the 12:00 UTC run). Example: October CPI (dated October 1) is not visible in a run on October 20. A run that passes its real time as `cutAt` (the daily note at 22:30 UTC) also sees a release from earlier that day where the publisher states the time: H.15 and H.10 at 4:15 p.m. New York, BLS at 8:30 a.m. New York (`releaseInstant`). VIX, S&P 500 and the target range keep the day-after rule, because FRED does not document when it posts them.
- Run time for prices (gather.ts, `cutSeries`): bars are cut at 12:00 UTC on the run date (the weekly run and every backfill), or at `cutAt` when the caller passes it, capped at the end of the run date and at the clock. Only bars whose period has ended by then are kept, so a 22:30 UTC run includes that day's NYSE session (closed at 21:00 UTC in winter, 18:00 UTC on an early close) and crypto hours up to 22:00, but not the crypto UTC day, which is still open.
- Federal Reserve releases (fixed 2026-11-25, pages read that day): H.15 (DGS2, DGS10, DFII10, DFF): "The release is posted daily Monday through Friday at 4:15pm" (https://www.federalreserve.gov/releases/h15/; the page names no time zone), and the release dated November 24, 2026 ends with November 23, so day D's rates are used from the day after the next Board business day. H.10 (DTWEXBGS): "On Mondays at 4:15 p.m." for "the previous business week", the next business day after a Monday holiday (https://www.federalreserve.gov/releases/h10/), so a Monday run sees the dollar through the Friday before last. Board holidays from https://www.federalreserve.gov/aboutthefed/k8.htm: a Sunday holiday moves to Monday, and for a Saturday holiday the Board is closed on Friday (`isFedHoliday`).
- BLS release days (fixed 2026-11-25): `BLS_RELEASED_FOR` in events.ts maps each CPI and jobs reference month to its real release day, read from the BLS release archives (https://www.bls.gov/bls/news-release/cpi.htm, https://www.bls.gov/bls/news-release/empsit.htm) and the 2025 lapse page (https://www.bls.gov/bls/2025-lapse-revised-release-dates.htm). The 2025 shutdown moved the September 2025 jobs report to November 20, 2025, cancelled October 2025 CPI (never visible), put October 2025 payrolls into the December 16, 2025 report (no October unemployment rate) and moved November 2025 CPI to December 18; the early 2026 lapse moved January 2026 CPI to February 13 and jobs to February 11. Releases were matched by calendar month before, which let a backfill see delayed data early.
- Revisions: for a backfill (run date before today) with `FRED_API_KEY` set, the API is asked for the ALFRED vintage as of the run date (`realtime_start` and `realtime_end` set to it), so values are the ones first published. The public CSV has no vintages, so a backfill without a key uses revised values and the run log says so; a keyed ALFRED call that fails and falls back to the CSV adds its own problem line.
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

`fixtures/*.json` hold responses keyed by URL, so `npm test` never uses the network. `mAAPL.json` (2026-11-19) holds the Apple newsroom and a trimmed SEC EDGAR response (the previous stock provider's responses were removed). `run.json` holds a whole run recorded on 2026-11-20 by `record-fixtures.ts run`: Coinbase, FRED, the Fed, BEA and BLS pages, Fed and SEC feeds, Binance or Deribit and DefiLlama as returned (large responses trimmed to the fields our parsers read, as its `note` says), plus synthetic GDELT responses because GDELT rate limited us; it has no on-chain answers, so its stock assets show the "on-chain price read failed" path. `onchain.json` holds the Base JSON-RPC answers recorded on 2026-11-25 by `record-fixtures.ts onchain --backfill=...` for the three stock tokens, per asset and keyed by method and parameters (never the RPC URL), with the backfill copy they were recorded against: a copy truncated 100 AAPL rounds, 300 NVDA rounds and 7 days of deSPXA pool logs early, so the replay exercises the run-time tail. No keys are stored in the fixtures.
