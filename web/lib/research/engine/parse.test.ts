import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReading, numbersBacked } from "./parse.ts";
import { makeFacts, goodReading } from "./fixtures.test-helpers.ts";

const facts = makeFacts("mAAPL");
const parse = (r: unknown) => parseReading(JSON.stringify(r), facts);

test("a clean answer parses into a reading with a 2 to 3 line summary", () => {
  const r = parse(goodReading());
  assert.ok(r);
  assert.equal(r.action, "hold");
  assert.equal(r.summary.split("\n").length, 3);
  assert.ok(r.summary.length <= 420);
  assert.equal(r.reasons.length, 2);
  assert.equal(r.outlook["1h"].stance, "no-view");
});

test("reasons citing unknown fact ids are dropped; no reason left means no reading", () => {
  const r = parse(goodReading({ reasons: [{ text: "Made up.", factIds: ["px.fake"] }, { text: "RSI is neutral.", factIds: ["ind.rsi14"] }] }));
  assert.ok(r);
  assert.deepEqual(r.reasons.map((x) => x.text), ["RSI is neutral."]);
  assert.equal(parse(goodReading({ reasons: [{ text: "Made up.", factIds: ["nope"] }] })), null);
  assert.equal(parse(goodReading({ risks: [] })), null);
});

test("unknown ids are removed from a reason that also cites a real fact", () => {
  const r = parse(goodReading({ reasons: [{ text: "RSI is neutral.", factIds: ["ind.rsi14", "made.up"] }] }));
  assert.deepEqual(r?.reasons[0].factIds, ["ind.rsi14"]);
});

test("a fact the model flags as injection can not be cited", () => {
  const r = parse(goodReading({ injectionFactIds: ["news.1"] }));
  assert.ok(r);
  assert.equal(r.opportunities.length, 0);
});

test("text with an invented number or a link is dropped", () => {
  const r = parse(
    goodReading({
      reasons: [
        { text: "Price could reach 150 soon.", factIds: ["px.last"] },
        { text: "See https://example.com for more.", factIds: ["px.last"] },
        { text: "RSI is neutral at 58.", factIds: ["ind.rsi14"] },
      ],
    }),
  );
  assert.deepEqual(r?.reasons.map((x) => x.text), ["RSI is neutral at 58."]);
  // An invented number in the summary rejects the whole answer.
  assert.equal(parse(goodReading({ summaryLines: ["Target is 175.", "Risk is high."] })), null);
});

test("numbers must match a fact after rounding; small counts and years pass", () => {
  assert.ok(numbersBacked("Up 1.5% to 100.4", [1.5, 100.37]));
  assert.ok(numbersBacked("Over 2 quarters in 2026", []));
  assert.ok(!numbersBacked("Up to 120", [100]));
  assert.ok(numbersBacked("Volatility near 25%", [0.25, 25]));
});

test("off-schema answers become no reading", () => {
  assert.equal(parseReading("not json", facts), null);
  assert.equal(parse({ ...goodReading(), extra: 1 }), null);
  assert.equal(parse(goodReading({ action: "strong buy" })), null);
  assert.equal(parse(goodReading({ confidence: "certain" })), null);
  assert.equal(parse(goodReading({ summaryLines: ["Only one line."] })), null);
  assert.equal(parse(goodReading({ summaryLines: ["a", "b", "c", "d"] })), null);
  assert.equal(parse(goodReading({ summaryLines: ["x".repeat(200), "y"] })), null);
  const noOutlook = goodReading() as Record<string, unknown>;
  delete noOutlook.outlook;
  assert.equal(parse(noOutlook), null);
});

test("an outlook or scenario without valid citations falls back to fixed code text", () => {
  const base = goodReading();
  const r = parse(
    goodReading({
      outlook: { ...base.outlook, "1w": { text: "Up.", factIds: ["nope"], stance: "positive" } },
      scenarios: { ...base.scenarios, bull: { text: "Moon.", factIds: [], likelihood: "high" } },
    }),
  );
  assert.equal(r?.outlook["1w"].stance, "no-view");
  assert.equal(r?.scenarios.bull.likelihood, "low");
  assert.deepEqual(r?.scenarios.bull.factIds, []);
});

test("numbers from trusted context (asset name) are allowed", () => {
  const r = parseReading(JSON.stringify(goodReading({ reasons: [{ text: "The S&P 500 fund is broad.", factIds: ["px.last"] }] })), facts, "S&P 500");
  assert.equal(r?.reasons.length, 1);
});
