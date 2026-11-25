import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEA_FALLBACK,
  BLS_FALLBACK,
  FOMC_FALLBACK,
  cryptoOptionsExpiry,
  equityOptionsExpiry,
  eventsForAsset,
  expiryEvents,
  fetchWeekAhead,
  fomcEvent,
  mergeFomc,
  parseBeaSchedule,
  parseBlsSchedule,
  parseFomcPage,
} from "./events.ts";
import type { DataDeps } from "./deps.ts";

// Same markup as https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (read 2026-11-20), shortened.
const FOMC_HTML = `<div class="panel panel-default"><div class="panel-heading"><h4><a id="42828">2026 FOMC Meetings</a></h4></div>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>October</strong></div>
<div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">27-28</div></div>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>December</strong></div>
<div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">8-9*</div></div></div>
<div class="panel panel-default"><div class="panel-heading"><h4><a id="42827">2025 FOMC Meetings</a></h4></div>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>August</strong></div>
<div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-2">22 (notation vote)</div></div></div>
<div class="panel panel-default"><div class="panel-heading"><h4><a id="39116">2024 FOMC Meetings</a></h4></div>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>Apr/May</strong></div>
<div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">30-1</div></div></div>`;

// Same markup as https://www.bea.gov/news/schedule (read 2026-11-20), shortened.
const BEA_HTML = `<th id="view-field-scheduled-release-date-1-table-column" aria-sort="ascending" scope="col">Year 2026</th>
<tr class="scheduled-releases-type-press"><td class="scheduled-date no-wrap"><div class="release-date">November 25</div><small class="text-muted">8:30 AM</small></td>
<td class="views-field"><div class="icon-letter">N</div></td>
<td class="release-title views-field views-field-field-scheduled-releases-type" headers="x">Personal Income and Outlays, October 2026        </td></tr>
<tr><td class="scheduled-date no-wrap"><div class="release-date">December 8</div></td><td class="views-field"></td>
<td class="release-title views-field" headers="x">U.S. International Trade in Goods and Services, October 2026</td></tr>
<tr><td class="scheduled-date no-wrap"><div class="release-date">January 29</div></td><td class="views-field"></td>
<td class="release-title views-field" headers="x">GDP (Advance Estimate), 4th Quarter and Year 2026</td></tr>`;

test("FOMC page: meetings per year, projections marked, notation votes skipped, month spans handled", () => {
  const m = parseFomcPage(FOMC_HTML);
  assert.deepEqual(m.map((x) => [x.start, x.end, x.sep]), [
    ["2026-10-27", "2026-10-28", false],
    ["2026-12-08", "2026-12-09", true],
    ["2024-04-30", "2024-05-01", false],
  ]);
  const e = fomcEvent(m[1]);
  assert.equal(e.id, "cal.2026-12-09.fomc");
  assert.equal(e.timeUtc, "19:00"); // 2:00 p.m. New York in winter
  assert.match(e.name, /with economic projections/);
  assert.deepEqual(e.assetIds, []);
});

test("the page wins for the years it lists; the checked-in 2027 dates fill the rest", () => {
  const merged = mergeFomc(parseFomcPage(FOMC_HTML));
  assert.ok(merged.some((x) => x.end === "2027-01-27" && x.source.url.includes("monetary20261112a")));
  assert.ok(!merged.some((x) => x.end === "2026-01-28"), "2026 comes from the page only");
  const strategy = FOMC_FALLBACK.find((x) => x.start === "2027-10-26")!;
  assert.equal(strategy.decision, false);
  assert.equal(fomcEvent(strategy).timeUtc, undefined);
  assert.match(fomcEvent(strategy).name, /no policy decision/);
});

test("checked-in FOMC dates cite the copy; 2027 projection meetings follow the usual pattern until the Fed marks them", () => {
  for (const x of FOMC_FALLBACK.filter((f) => f.start.startsWith("2026"))) assert.match(x.source.name, /checked-in copy read 2026-11-22/);
  const sep2027 = FOMC_FALLBACK.filter((x) => x.start.startsWith("2027") && x.sep).map((x) => x.end);
  assert.deepEqual(sep2027, ["2027-03-17", "2027-06-09", "2027-09-15"]);
  assert.ok(FOMC_FALLBACK.filter((x) => x.start.startsWith("2027") && x.sep).every((x) => x.sepAssumed));
  const march = fomcEvent(FOMC_FALLBACK.find((x) => x.end === "2027-03-17")!);
  assert.match(march.name, /economic projections expected by the usual quarterly pattern \(not yet marked by the Fed\)/);
  // The Fed page listing 2027 without asterisks (as on 2026-11-22) keeps the assumed projections and the strategy meeting.
  const page2027 = `<h4><a id="1">2027 FOMC Meetings</a></h4>
<div class="fomc-meeting__month"><strong>March</strong></div><div class="fomc-meeting__date">16-17</div>
<div class="fomc-meeting__month"><strong>October</strong></div><div class="fomc-meeting__date">26-27</div>`;
  const merged = mergeFomc(parseFomcPage(page2027));
  const mar = merged.find((x) => x.end === "2027-03-17")!;
  assert.equal(mar.source.url, "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
  assert.ok(mar.sep && mar.sepAssumed);
  assert.equal(merged.find((x) => x.end === "2027-10-27")!.decision, false);
  // Once the page stars a 2027 meeting, the page's own marks win.
  const starred = mergeFomc(parseFomcPage(page2027.replace("16-17", "16-17*")));
  assert.equal(starred.find((x) => x.end === "2027-03-17")!.sepAssumed, undefined);
});

test("checked-in official dates have not run out (warns 120 days ahead, fails once out)", (t) => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [name, last] of [
    ["FOMC", FOMC_FALLBACK.at(-1)!.end],
    ["BLS CPI", BLS_FALLBACK.filter((r) => r.kind === "cpi").at(-1)!.date],
    ["BLS jobs", BLS_FALLBACK.filter((r) => r.kind === "jobs").at(-1)!.date],
    ["BEA", BEA_FALLBACK.at(-1)!.date],
  ] as const) {
    const daysLeft = (Date.parse(last) - Date.parse(today)) / 86_400_000;
    if (daysLeft < 120) t.diagnostic(`WARNING: checked-in ${name} dates end ${last}; refresh them from the official page in events.ts`);
    // BEA only publishes a few weeks ahead, so its copy is allowed to lapse; the live page is the source.
    if (name !== "BEA") assert.ok(daysLeft > 0, `checked-in ${name} dates ran out on ${last}`);
  }
  for (const list of [FOMC_FALLBACK.map((x) => x.end), BLS_FALLBACK.map((r) => r.date), BEA_FALLBACK.map((r) => r.date)]) {
    for (const d of list) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("BEA schedule: PCE and GDP rows kept, the table rolls into the next year", () => {
  const r = parseBeaSchedule(BEA_HTML);
  assert.deepEqual(r.map((x) => [x.date, x.kind]), [["2026-11-25", "pce"], ["2027-01-29", "gdp"]]);
  assert.match(r[0].name, /PCE inflation/);
});

test("BLS schedule rows (date next to 08:30 AM)", () => {
  const html = `<tr><td>November 2026</td><td>Dec. 10, 2026</td><td>08:30 AM</td></tr><tr><td>December 2026</td><td>Jan. 13, 2027</td><td>08:30 AM</td></tr>`;
  const r = parseBlsSchedule(html, "cpi");
  assert.deepEqual(r.map((x) => x.date), ["2026-12-10", "2027-01-13"]);
  assert.match(r[0].name, /Consumer Price Index for November 2026/);
});

test("options expiry: third Friday (earlier on a holiday) and Deribit's last Friday", () => {
  assert.equal(equityOptionsExpiry(2026, 11), "2026-11-20");
  assert.equal(equityOptionsExpiry(2026, 12), "2026-12-18");
  assert.equal(equityOptionsExpiry(2027, 3), "2027-03-19");
  assert.equal(cryptoOptionsExpiry(2026, 11), "2026-11-27");
  assert.equal(cryptoOptionsExpiry(2027, 1), "2027-01-29");
  const ev = expiryEvents("2026-11-20", "2026-11-27");
  assert.deepEqual(ev.map((e) => e.id), ["cal.2026-11-20.options-expiry", "cal.2026-11-27.crypto-options-expiry"]);
  assert.deepEqual(eventsForAsset(ev, "mcbBTC").map((e) => e.date), ["2026-11-27"]);
  assert.deepEqual(eventsForAsset(ev, "mAAPL").map((e) => e.date), ["2026-11-20"]);
});

test("week ahead with every official page failing: checked-in copies, gaps reported, nothing invented", async () => {
  const deps: DataDeps = { fetch: async () => ({ ok: false, status: 403, text: async () => "" }), env: {}, now: () => new Date("2026-11-20T12:00:00Z"), sleep: async () => {} };
  const r = await fetchWeekAhead("2026-11-20", deps);
  const ids = r.events.map((e) => e.id);
  assert.ok(ids.includes("cal.2026-11-25.pce"));
  assert.ok(ids.includes("cal.2026-11-25.gdp"));
  assert.ok(ids.includes("cal.2026-11-20.options-expiry"));
  assert.ok(ids.includes("cal.2026-11-27.crypto-options-expiry"));
  assert.ok(!ids.some((id) => id.endsWith(".fomc")), "no FOMC meeting that week");
  // Every failed page is a line in problems (none silent); the checked-in copies cover the week.
  assert.deepEqual(r.problems, [
    "FOMC calendar page could not be read (HTTP 403), using the checked-in FOMC dates",
    "BLS CPI schedule page could not be read (HTTP 403), using the checked-in copy",
    "BLS jobs report schedule page could not be read (HTTP 403), using the checked-in copy",
    "BEA release schedule page could not be read (HTTP 403), using the checked-in copy",
  ]);
  const dec = await fetchWeekAhead("2026-12-07", deps);
  const fomc = dec.events.find((e) => e.id === "cal.2026-12-09.fomc")!;
  assert.match(fomc.source.name, /checked-in copy read 2026-11-22/, "the fallback is cited as the copy, not the live page");
  // In late December the BEA copy runs out, which is reported instead of guessed.
  const late = await fetchWeekAhead("2026-12-20", deps);
  assert.ok(late.problems.some((p) => /BEA release schedule: dates only known through 2026-12-23/.test(p)));
  assert.ok(late.events.some((e) => e.id === "cal.2026-12-23.pce"));
});
