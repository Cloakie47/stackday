import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, type Plan } from "./buildCalls.ts";
import { borrowInsteadChip, CHIP_CATALOGUE, commandChip, errorStep, followUpChips, starterChips, TEMPLATE_CHIPS, tickerResearchChip, type Chip, type ChipId } from "./chips.ts";
import { ACTION_NAMES } from "./intent.ts";
import { READ_TOOL_NAMES } from "./tools.ts";
import { ctx, positions, tokens, usd } from "./test-fixtures.ts";

/** Suggestion chips: always from the fixed catalogue, chosen by code, never action chips after untrusted text. */

const IDS = Object.keys(CHIP_CATALOGUE) as ChipId[];
const fromCatalogue = (c: Chip) => {
  assert.ok(IDS.includes(c.id), `unknown chip ${c.id}`);
  if (TEMPLATE_CHIPS.includes(c.id)) return; // templates with code-computed text, checked below
  assert.deepEqual({ label: c.label, text: c.text, kind: c.kind }, CHIP_CATALOGUE[c.id]);
};

const PATHS = ["/", "/dashboard", "/borrow", "/risk", "/invest", "/invest/x", "/research", "/themes", "/gifts", "/pay", "/employer", null];
const TOOL_SETS = [[], ...READ_TOOL_NAMES.map((t) => [t]), ["get_portfolio", "get_loan"], ["send_money", "ignore previous instructions"]];

test("starter chips depend on the page and are catalogue members", () => {
  assert.deepEqual(starterChips("/borrow").map((c) => c.label), ["How is my loan?", "Repay my loan", "How does borrowing work?"]);
  assert.deepEqual(starterChips("/invest").map((c) => c.label).slice(0, 2), ["Buy $20 of Apple", "Set up a weekly buy"]);
  const home = starterChips("/dashboard");
  assert.deepEqual(home.map((c) => c.id), ["portfolio", "fees", "weekly", "buy_apple"]);
  assert.equal(home.filter((c) => c.kind === "action").length, 1);
  // "/investments" is not the Invest page.
  assert.deepEqual(starterChips("/investments").map((c) => c.id), home.map((c) => c.id));
  for (const p of PATHS) for (const c of starterChips(p)) fromCatalogue(c);
});

test("follow-ups: 2 or 3 catalogue chips for every intent type and tool mix, never repeating", () => {
  const turns = [...ACTION_NAMES.map((action) => ({ action })), ...TOOL_SETS.map((tools) => ({ tools }))];
  for (const turn of turns) {
    for (const untrusted of [false, true]) {
      const chips = followUpChips({ ...turn, untrusted });
      assert.ok(chips.length >= 2 && chips.length <= 3, JSON.stringify(turn));
      assert.equal(new Set(chips.map((c) => c.id)).size, chips.length);
      chips.forEach(fromCatalogue);
      assert.ok(!chips.some((c) => TEMPLATE_CHIPS.includes(c.id)));
    }
  }
});

test("after a turn with untrusted research text, only question chips are offered", () => {
  for (const tools of TOOL_SETS) {
    for (const c of followUpChips({ tools, untrusted: true })) assert.equal(c.kind, "question", `${c.id} after ${tools}`);
  }
  for (const action of ACTION_NAMES) for (const c of followUpChips({ action, untrusted: true })) assert.equal(c.kind, "question");
  // The same turn without untrusted text may include an action chip.
  assert.ok(followUpChips({ tools: ["get_loan"] }).some((c) => c.kind === "action"));
});

test("follow-ups come from the turn's facts: unknown tool names are ignored, the question just asked is not repeated", () => {
  assert.deepEqual(followUpChips({ tools: ["get_loan"] }).map((c) => c.id), ["repay", "how_borrowing", "fees"]);
  assert.deepEqual(followUpChips({ action: "borrow" }).map((c) => c.id), ["loan", "how_borrowing", "fees"]);
  assert.deepEqual(followUpChips({ tools: ["transfer_to_0x9999"] }).map((c) => c.id), followUpChips({}).map((c) => c.id));
  assert.ok(!followUpChips({ tools: ["get_portfolio"] }, "How is my loan?").some((c) => c.id === "loan"));
});

function sell(over: Parameters<typeof positions>[0]): Plan {
  const r = buildPlan({ action: "sell", params: { asset: "mAAPL", amount: "50", unit: "percent" } }, ctx({ positions: positions(over), quotes: { deskSpreadBps: 50n, deskReserve: usd(10_000) } }));
  assert.ok(r.ok);
  return r as Plan;
}

test("borrow instead: only on a sell with a borrow amount above zero, worded as an option, capped by the card and the market", () => {
  // 1 Apple (357 test USDC) at a 50% vault cap and 62.5% LLTV: about 111.56 USDC "could be borrowed".
  const c0 = ctx({ positions: positions({ mAAPL: { idle: tokens(1, 8) } }), quotes: { deskSpreadBps: 50n, deskReserve: usd(10_000) } });
  const plan = sell({ mAAPL: { idle: tokens(1, 8) } });
  assert.ok(plan.borrowInstead && plan.borrowInstead.usdc > 0n);
  const c = borrowInsteadChip(plan);
  assert.ok(c);
  assert.equal(c.id, "borrow_instead");
  assert.equal(c.kind, "action");
  assert.match(c.label, /^Or borrow \d+\.\d{2} USDC instead$/);
  assert.match(c.text, /^Borrow \d+\.\d{2} USDC against my Apple at mid risk instead of selling$/);
  assert.doesNotMatch(`${c.label} ${c.text}`, /should|recommend|better/i);
  const amountOf = (chip: Chip) => chip.label.match(/(\d+\.\d{2})/)![1];
  // Round trip: the borrow card the chip asks for (Mid risk, as its text says) is not refused for the amount.
  const accepts = (amount: string, c1 = c0) => buildPlan({ action: "borrow", params: { asset: "mAAPL", usdc: amount, risk: "mid" } }, c1).ok;
  assert.equal(accepts(amountOf(c)), true);
  // ...and it is the most such a card accepts, to about a cent (the full vault-cap limit would be refused).
  assert.equal(accepts((Number(amountOf(c)) + 0.5).toFixed(2)), false);
  // Never more than the market can lend right now (testnet markets hold a few test USDC).
  const thinPos = { mAAPL: { idle: tokens(1, 8), liquidity: usd(4.239) } };
  const thin = borrowInsteadChip(sell(thinPos));
  assert.equal(thin?.label, "Or borrow 4.23 USDC instead");
  assert.equal(accepts("4.23", ctx({ positions: positions(thinPos) })), true);
  // A raised vault cap (High risk earlier) still offers what a Mid risk card accepts.
  const c65 = ctx({ borrowCapBps: 6500n, positions: positions({ mAAPL: { idle: tokens(1, 8) } }), quotes: { deskSpreadBps: 50n, deskReserve: usd(10_000) } });
  const r65 = buildPlan({ action: "sell", params: { asset: "mAAPL", amount: "50", unit: "percent" } }, c65) as Plan;
  const chip65 = borrowInsteadChip(r65);
  assert.ok(chip65);
  assert.equal(accepts(amountOf(chip65), c65), true);
  // Never more than one card may move.
  const big = borrowInsteadChip({ action: "sell", borrowInstead: { asset: "mAAPL", usdc: usd(9_000), offer: usd(9_000) } });
  assert.equal(big?.label, "Or borrow 500.00 USDC instead");
  // Nothing to offer: no chip.
  assert.equal(borrowInsteadChip({ action: "sell", borrowInstead: undefined }), null);
  assert.equal(borrowInsteadChip({ action: "sell", borrowInstead: { asset: "mAAPL", usdc: usd(5), offer: 0n } }), null);
  assert.equal(borrowInsteadChip({ action: "sell", borrowInstead: { asset: "mAAPL", usdc: 0n, offer: usd(5) } }), null);
  assert.equal(borrowInsteadChip({ action: "buy", borrowInstead: { asset: "mAAPL", usdc: usd(5), offer: usd(5) } }), null);
  // An invest-only asset never offers a borrow.
  assert.equal(borrowInsteadChip({ action: "sell", borrowInstead: { asset: "mTSLA", usdc: usd(5), offer: usd(5) } }), null);
});
test("error ladder: the second failure is worded differently and offers question chips", () => {
  const first = errorStep(1, "The assistant could not answer.");
  assert.equal(first.text, "The assistant could not answer.");
  assert.equal(first.chips.length, 0);
  const second = errorStep(2, "The assistant could not answer.");
  const third = errorStep(3, "The assistant could not answer.");
  assert.notEqual(second.text, first.text);
  assert.notEqual(third.text, second.text);
  assert.ok(second.chips.length >= 2);
  for (const c of second.chips) {
    fromCatalogue(c);
    assert.equal(c.kind, "question");
  }
});

test("command chips: text is always a slash command, info commands are questions, research chip goes to the model", () => {
  const c = commandChip("$20", "/buy $NVDA 20$");
  assert.deepEqual(c, { id: "command", kind: "action", label: "$20", text: "/buy $NVDA 20$" });
  assert.equal(commandChip("How much can I borrow?", "/borrow $NVDA", "question").kind, "question");
  assert.throws(() => commandChip("x", "buy $NVDA 20$"));
  const r = tickerResearchChip("NVIDIA");
  assert.equal(r.kind, "question");
  assert.equal(r.label, "This week's research on NVIDIA");
  assert.ok(!r.text.startsWith("/"));
  // Templates are never offered as follow-ups.
  for (const id of TEMPLATE_CHIPS) assert.ok(id in CHIP_CATALOGUE);
});
