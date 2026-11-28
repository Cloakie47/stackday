import { test } from "node:test";
import assert from "node:assert/strict";
import { ESCALATION_TRIGGERS, RESEARCH_MODELS } from "../flags.ts";
import type { AssetResearchInput, Fact } from "../types.ts";
import { NO_CURRENT_PRICE } from "../types.ts";
import { dayMove, escalationSlots, escalationTriggers, marketCrisis, nearInvalidation, runDaily, staleFeed, takeSlot, ESCALATE_MAX_TOKENS, TRIAGE_MAX_TOKENS, type GatherFn } from "./daily.ts";
import { computeLevels } from "./levels.ts";
import { worstCaseCost } from "./model.ts";
import { memoryStore } from "./store.ts";
import { chartRead, fakeModel, goodDaily, makeInput } from "./test-helpers.ts";

// Founder plan item 5: the stronger model only when it matters, with the cap and the budget as hard limits.

const DATE = "2026-11-19";
const NOW = Date.parse(`${DATE}T22:30:00Z`);
const THURSDAY = () => new Date(NOW);
const src = { name: "Test fixture" };
const pxLast = (value: number, asOf = `${DATE}T22:00:00Z`): Fact => ({ id: "px.last", kind: "price", label: "Last price", value, unit: "USD", source: src, asOf });
const withPx = (input: AssetResearchInput, value: number, asOf?: string): AssetResearchInput => ({ ...input, facts: [...input.facts, pxLast(value, asOf)] });
const calm = { conviction: "medium" as const, levels: null };
const triggers = (input: AssetResearchInput, over: Partial<Parameters<typeof escalationTriggers>[0]> = {}) =>
  escalationTriggers({ input, crypto: false, nowMs: NOW, market: {}, reading: calm, ...over });

test("a calm asset in a calm market triggers nothing", () => {
  const input = makeInput("mAAPL", DATE);
  assert.deepEqual(triggers(input, { market: { btc: makeInput("mcbBTC", DATE), spx: makeInput("mSPX", DATE) } }), []);
});

test("crisis: Bitcoin or the S&P 500 down more than the threshold in a day escalates every asset", () => {
  const t = ESCALATION_TRIGGERS;
  // Bitcoin at 22:30: yesterday's daily bar was calm, but the latest price is 8% below that close.
  const btcDown = withPx(makeInput("mcbBTC", DATE, { bar1: 0.004 }), 92);
  assert.ok(Math.abs(dayMove(btcDown)! + 0.08) < 1e-9);
  assert.match(marketCrisis(btcDown, null)!, /Bitcoin down 8\.0% in a day/);
  // Just under the threshold is not a crisis.
  assert.equal(marketCrisis(withPx(makeInput("mcbBTC", DATE), 100 * (1 - (t.btcDayDropPct - 0.5) / 100)), null), null);
  // S&P 500: today's session (the last closed daily bar) down 3.5%.
  const spxDown = makeInput("mSPX", DATE, { bar1: -0.035 });
  assert.match(marketCrisis(null, spxDown)!, /S&P 500 down 3\.5% in a day/);
  assert.equal(marketCrisis(null, makeInput("mSPX", DATE, { bar1: -0.02 })), null);
  // Unknown is no crisis.
  assert.equal(marketCrisis(null, null), null);
  // It escalates an unrelated asset (gold) too.
  assert.match(triggers(makeInput("mPAXG", DATE), { market: { btc: btcDown } }).join(), /market crisis/);
});

test("stale price feed: the data step's no-current-price line, or an old crypto price", () => {
  const chainDown = { ...makeInput("mAAPL", DATE), problems: [`mAAPL: latest Base block not read after a retry (timeout); bars from the backfill and stored tail only, up to 2026-11-19T21:00 UTC, ${NO_CURRENT_PRICE}`] };
  assert.match(staleFeed(chainDown, false, NOW)!, /current price could not be read/);
  assert.match(triggers(chainDown).join(), /stale price feed/);
  const oldBtc = withPx(makeInput("mcbBTC", DATE), 100, `${DATE}T18:00:00Z`);
  assert.match(staleFeed(oldBtc, true, NOW)!, /4\.5 hours old/);
  assert.equal(staleFeed(withPx(makeInput("mcbBTC", DATE), 100), true, NOW), null);
  // Stocks are not judged by the age of their price (after the close it is hours old by design).
  assert.equal(staleFeed(withPx(makeInput("mAAPL", DATE), 100, `${DATE}T18:00:00Z`), false, NOW), null);
});

test("low conviction near invalidation, measured with the real code levels", () => {
  // Hold with support 0.25 ATR under the close (ATR 2): invalidation 97.5, 1.25 ATR away.
  const near = makeInput("mAAPL", DATE, { chart: { "1d": chartRead("1d", 100, { support: [99.5, 94] }) } });
  const levels = computeLevels("hold", near.indicators["1d"], near.chart["1d"]);
  assert.equal(levels?.invalidation, 97.5);
  assert.match(nearInvalidation("low", levels, near)!, /low conviction 1\.3 ATR from the invalidation level 97\.5/);
  assert.equal(nearInvalidation("medium", levels, near), null);
  // Support 3% under the close: invalidation 95, 2.5 ATR away.
  const far = makeInput("mAAPL", DATE);
  assert.equal(nearInvalidation("low", computeLevels("hold", far.indicators["1d"], far.chart["1d"]), far), null);
  // Accumulate: the zone starts at support, invalidation 1.5 ATR below it. A price that fell to
  // the zone since the close (px.last) fires; the close alone (3 ATR above invalidation) does not.
  const acc = computeLevels("accumulate", far.indicators["1d"], far.chart["1d"]);
  assert.equal(nearInvalidation("low", acc, far), null);
  assert.match(nearInvalidation("low", acc, withPx(far, 97))!, /1\.5 ATR/);
  assert.match(triggers(near, { reading: { conviction: "low", levels } }).join(), /low conviction/);
});

test("slots: the newer triggers leave the last one for failed answers and big movers", () => {
  const s = escalationSlots(3);
  assert.equal(takeSlot(s, false), true);
  assert.equal(takeSlot(s, false), true);
  assert.equal(takeSlot(s, false), false, "a newer trigger cannot take the reserved slot");
  assert.equal(takeSlot(s, true), true);
  assert.equal(takeSlot(s, true), false);
  assert.deepEqual(escalationSlots(1), { left: 1, reserved: 0 });
  assert.deepEqual(escalationSlots(0), { left: 0, reserved: 0 });
});

const caps = { maxRunCostUsd: 2, maxDayCostUsd: 6 };
const crashGather: GatherFn = async (assetId, date) => (assetId === "mcbBTC" ? withPx(makeInput(assetId, date), 90) : makeInput(assetId, date));

test("each trigger escalates in a real run", async () => {
  // Crisis: every asset wants the stronger model, two take it, the reserved slot stays free.
  const a = memoryStore();
  const crisis = fakeModel(() => goodDaily());
  const out = await runDaily({ gather: crashGather, model: crisis.fn, store: a.store, ...caps, now: THURSDAY });
  assert.equal(out.status, "ok");
  assert.equal(out.counts.escalated, 2);
  assert.equal(crisis.calls.filter((c) => c.model === RESEARCH_MODELS.dailyEscalation).length, 2);
  assert.ok(out.problems.some((p) => /escalated to the stronger model \(market crisis: Bitcoin down 10\.0%/.test(p)), out.problems.join("\n"));
  // Once the free slots are used, the other assets do not even wait for the crisis check.

  // Stale feed: only the asset whose chain read failed.
  const b = memoryStore();
  const staleGather: GatherFn = async (assetId, date) => (assetId === "mNVDA" ? { ...makeInput(assetId, date), problems: [`mNVDA: current on-chain price not read after a retry (x); bars from the backfill and the tail, ${NO_CURRENT_PRICE}`] } : makeInput(assetId, date));
  const stale = fakeModel(() => goodDaily());
  const out2 = await runDaily({ gather: staleGather, model: stale.fn, store: b.store, ...caps, now: THURSDAY });
  const esc = stale.calls.filter((c) => c.model === RESEARCH_MODELS.dailyEscalation);
  assert.equal(esc.length, 1);
  assert.match(esc[0].user, /mNVDA/);
  assert.equal(out2.counts.escalated, 1);

  // Low conviction near invalidation: a Hold at low conviction with support just under the close.
  const c = memoryStore();
  const nearGather: GatherFn = async (assetId, date) => (assetId === "mPAXG" ? makeInput(assetId, date, { chart: { "1d": chartRead("1d", 100, { support: [99.5, 94] }) } }) : makeInput(assetId, date));
  const near = fakeModel((req) => (req.user.includes("mPAXG") ? goodDaily({ view: "hold", conviction: "low" }) : goodDaily()));
  const out3 = await runDaily({ gather: nearGather, model: near.fn, store: c.store, ...caps, now: THURSDAY });
  const esc3 = near.calls.filter((x) => x.model === RESEARCH_MODELS.dailyEscalation);
  assert.equal(esc3.length, 1);
  assert.match(esc3[0].user, /mPAXG/);
  assert.equal(out3.counts.escalated, 1);
});

test("a failed answer still gets the reserved slot during a crisis", async () => {
  const { store } = memoryStore();
  const model = fakeModel((req) => (req.model === RESEARCH_MODELS.dailyTriage && req.user.includes("mPAXG") ? "garbage" : goodDaily()));
  const out = await runDaily({ gather: crashGather, model: model.fn, store, ...caps, now: THURSDAY });
  assert.equal(out.status, "ok");
  assert.equal(out.counts.ok, 6);
  assert.equal(out.counts.escalated, 3);
  assert.ok(model.calls.some((c) => c.model === RESEARCH_MODELS.dailyEscalation && c.user.includes("mPAXG")));
});

/** Every trigger at once for every asset: crisis, stale feed, big mover and low conviction near invalidation. */
const everything: GatherFn = async (assetId, date) => {
  const base = makeInput(assetId, date, { bar1: 0.06, chart: { "1d": chartRead("1d", 100, { support: [99.5, 94] }), "1w": chartRead("1w", 100), "1mo": chartRead("1mo", 100) } });
  const facts = assetId === "mcbBTC" ? [...base.facts, pxLast(90)] : base.facts;
  return { ...base, facts, problems: [`${assetId}: bars from the backfill and the tail, ${NO_CURRENT_PRICE}`] };
};
const lowHold = () => goodDaily({ view: "hold", conviction: "low" });

test("with every trigger firing for every asset, the escalation cap and the run budget still hold", async () => {
  for (const max of [3, 1, 0]) {
    const { store } = memoryStore();
    const model = fakeModel(lowHold);
    const out = await runDaily({ gather: everything, model: model.fn, store, ...caps, maxEscalations: max, now: THURSDAY });
    assert.equal(out.status, "ok", out.problems.join("\n"));
    assert.equal(out.written, true);
    // Every asset is also a big mover, which may use every slot (as before): exactly the cap.
    const esc = model.calls.filter((c) => c.model === RESEARCH_MODELS.dailyEscalation).length;
    assert.equal(esc, max, `max ${max}`);
    assert.equal(out.counts.escalated, max);
    assert.ok(out.costUsd <= caps.maxRunCostUsd);
  }
  // Without big movers the newer triggers stop one short of the cap.
  const { store } = memoryStore();
  const noBig: GatherFn = async (assetId, date) => ({ ...(await everything(assetId, date)), indicators: makeInput(assetId, date).indicators });
  const model = fakeModel(lowHold);
  const out = await runDaily({ gather: noBig, model: model.fn, store, ...caps, now: THURSDAY });
  assert.equal(out.status, "ok");
  assert.equal(model.calls.filter((c) => c.model === RESEARCH_MODELS.dailyEscalation).length, 2);
});

test("an escalation that fits but would leave too little for the other assets' first pass is skipped, never a stopped run", async () => {
  // Measure the real worst-case cost of each call from a dry run.
  const dry = fakeModel(lowHold, 0);
  await runDaily({ gather: everything, model: dry.fn, store: memoryStore().store, ...caps, now: THURSDAY });
  const worstOf = (model: string) => Math.max(...dry.calls.filter((c) => c.model === model).map((c) => worstCaseCost(c)));
  const triW = worstOf(RESEARCH_MODELS.dailyTriage);
  const escW = worstOf(RESEARCH_MODELS.dailyEscalation);
  // Room for one escalation and a little more, not for an escalation plus the other first passes.
  const cap = escW + 1.5 * triW;
  // The stronger model is slow, so other assets start their first pass while it runs (as live).
  const slow = fakeModel(lowHold, 0);
  const model: typeof slow.fn = async (req) => {
    if (req.model === RESEARCH_MODELS.dailyEscalation) await new Promise((r) => setTimeout(r, 15));
    return slow.fn(req);
  };
  const { store, writes } = memoryStore();
  const out = await runDaily({ gather: everything, model, store, maxRunCostUsd: cap, maxDayCostUsd: 6, now: THURSDAY });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  assert.equal(out.written, true);
  assert.equal(writes.daily, 1);
  assert.equal(out.counts.ok, 6);
  assert.ok(out.problems.some((p) => /the run budget left does not cover the call/.test(p)));
});

test("an escalation the run budget cannot cover is skipped with a note, never a stopped run", async () => {
  const { store, writes } = memoryStore();
  const model = fakeModel(lowHold);
  // Room for the six cheap triage calls (three at a time) but not for one stronger-model call.
  const triageWorst = worstCaseCost({ model: RESEARCH_MODELS.dailyTriage, system: "x".repeat(20_000), user: "x".repeat(20_000), maxTokens: TRIAGE_MAX_TOKENS });
  const escWorst = worstCaseCost({ model: RESEARCH_MODELS.dailyEscalation, system: "", user: "", maxTokens: ESCALATE_MAX_TOKENS });
  const cap = 4 * triageWorst;
  assert.ok(cap < escWorst, "the test budget must not cover an escalation");
  const out = await runDaily({ gather: everything, model: model.fn, store, maxRunCostUsd: cap, maxDayCostUsd: 6, now: THURSDAY });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  assert.equal(out.written, true);
  assert.equal(writes.daily, 1);
  assert.equal(out.counts.escalated, 0);
  assert.equal(model.calls.filter((c) => c.model === RESEARCH_MODELS.dailyEscalation).length, 0);
  assert.ok(out.problems.some((p) => /not escalated .*the run budget left does not cover the call/.test(p)), out.problems.join("\n"));
  assert.ok(out.costUsd <= cap);
});

test("each run asks every source once, even with the crisis check reading Bitcoin and the S&P 500", async () => {
  const { store } = memoryStore();
  const seen: string[] = [];
  const counting: GatherFn = async (assetId, date) => {
    seen.push(assetId);
    return crashGather(assetId, date);
  };
  await runDaily({ gather: counting, model: fakeModel(() => goodDaily()).fn, store, ...caps, now: THURSDAY });
  assert.deepEqual([...seen].sort(), ["mAAPL", "mNVDA", "mPAXG", "mSPX", "mWETH", "mcbBTC"]);
});
