import { test } from "node:test";
import assert from "node:assert/strict";
import { completeDraft, COMMANDS, parseCommand, suggestAssets, symbolOfTicker, tickerOf, type CommandContext, type CommandResult } from "./commands.ts";
import { recipientProblem } from "./recipient.ts";
import { parseIntent, type Intent } from "./intent.ts";
import type { InfoContext } from "./info.ts";
import { ME, positions, tokens, usd, VAULT } from "./test-fixtures.ts";

const ADDR_A = "0x582fcE4Eb22Eb3DFA908cA397d16A4C6f511D34C";
const ADDR_B = "0x1234567890abcdef1234567890abcdef12345678";

const info = (over: Partial<InfoContext> = {}): InfoContext => ({
  me: ME,
  vault: VAULT,
  predictedVault: VAULT,
  positions: positions({ mNVDA: { idle: tokens(1, 8) }, mAAPL: { idle: tokens(0.1, 8) }, mTSLA: { idle: tokens(2, 8) } }),
  borrowCapBps: 5000n,
  walletUsdc: usd(100),
  vaultUsdc: usd(5),
  earning: usd(20),
  nowSec: 1_800_000_000,
  ...over,
});
const CTX: CommandContext = { held: ["mNVDA", "mAAPL"] };
const parse = (t: string, ctx = CTX) => parseCommand(t, ctx);

/** The result is an intent that also passes the network-side check, and matches. */
function intentOf(r: CommandResult): Intent {
  assert.ok(r, "expected a result");
  assert.equal(r.kind, "intent", r.kind === "error" ? r.message : r.kind === "ask" ? r.question : JSON.stringify(r));
  const i = (r as { intent: Intent }).intent;
  const again = parseIntent(JSON.parse(JSON.stringify(i)));
  assert.ok(again.ok, again.ok ? "" : again.error);
  assert.deepEqual(again.intent, i);
  return i;
}
const errorOf = (r: CommandResult, match?: RegExp) => {
  assert.ok(r && r.kind === "error", `expected an error, got ${JSON.stringify(r)}`);
  if (match) assert.match(r.message, match);
  return r.message;
};

test("amounts: 1$, $1, 1, 1.5$ and 1,000$ are USDC; 0, -1 and 7 decimals are refused", () => {
  for (const [t, want] of [["1$", "1"], ["$1", "1"], ["1", "1"], ["1.5$", "1.5"], ["5.50", "5.50"], ["1,000$", "1000"], ["$1,000", "1000"], ["0.000001", "0.000001"]] as const)
    assert.deepEqual(intentOf(parse(`/stop-earning ${t}`)).params, { usdc: want }, t);
  errorOf(parse("/earn 0"), /above zero/);
  errorOf(parse("/earn 0.00"), /above zero/);
  errorOf(parse("/earn -1"), /positive/);
  errorOf(parse("/earn 1.1234567"), /6 decimals/);
  errorOf(parse("/earn $1$"), /positive/);
  errorOf(parse("/earn 1,00$"), /positive/);
});

test("amounts: percents 1 to 100 and all only where the command takes them", () => {
  assert.deepEqual(intentOf(parse("/sell $NVDA 10%")).params, { asset: "mNVDA", amount: "10", unit: "percent" });
  assert.deepEqual(intentOf(parse("/sell $NVDA 12.5%")).params, { asset: "mNVDA", amount: "12.5", unit: "percent" });
  assert.deepEqual(intentOf(parse("/sell $NVDA all")).params, { asset: "mNVDA", amount: "100", unit: "percent" });
  assert.deepEqual(intentOf(parse("/sell $NVDA ALL")).params, { asset: "mNVDA", amount: "100", unit: "percent" });
  errorOf(parse("/sell $NVDA 150%"), /between 1% and 100%/);
  errorOf(parse("/sell $NVDA 0%"), /between 1% and 100%/);
  errorOf(parse("/buy $NVDA 10%"), /USDC amount/);
  errorOf(parse("/buy $NVDA all"), /"all" does not work/);
  errorOf(parse("/lock $NVDA all"), /"all" does not work/);
});

test("caps go through parseAction: buy 501 and send 101 refused, repay 10000 accepted", () => {
  assert.equal(intentOf(parse("/buy $NVDA 500")).action, "buy");
  errorOf(parse("/buy $NVDA 501"), /at most 500/);
  errorOf(parse("/borrow $NVDA 501"), /at most 500/);
  errorOf(parse("/gift @maria 501"), /at most 500/);
  errorOf(parse("/earn 500.01"), /at most 500/);
  assert.equal(intentOf(parse("/send USDC 100 to @maria")).action, "send");
  errorOf(parse("/send USDC 101 to @maria"), /at most 100/);
  errorOf(parse("/send $NVDA 100.5 to @maria"), /at most 100/);
  assert.deepEqual(intentOf(parse("/repay 10000")).params, { asset: "every_loan", usdc: "10000", all: false });
  assert.deepEqual(intentOf(parse("/stop-earning 10000")).params, { usdc: "10000" });
  errorOf(parse("/earn 1234567890"), /too large/);
});

test("tickers: $nvda, NVDA, $BTC, ETH, gold and mNVDA resolve; $XYZ and look-alikes are refused", () => {
  for (const t of ["$nvda", "NVDA", "$NVDA", "nvda", "mNVDA", "$mnvda"]) assert.equal((intentOf(parse(`/buy ${t} 5`)).params as { asset: string }).asset, "mNVDA", t);
  assert.equal((intentOf(parse("/buy $BTC 5")).params as { asset: string }).asset, "mcbBTC");
  assert.equal((intentOf(parse("/buy $cbbtc 5")).params as { asset: string }).asset, "mcbBTC");
  assert.equal((intentOf(parse("/buy eth 5")).params as { asset: string }).asset, "mWETH");
  assert.equal((intentOf(parse("/buy $WETH 5")).params as { asset: string }).asset, "mWETH");
  assert.equal((intentOf(parse("/buy GOLD 5")).params as { asset: string }).asset, "mPAXG");
  errorOf(parse("/buy $XYZ 5"), /no \$XYZ/);
  // Cyrillic A at the end of NVDA.
  errorOf(parse("/buy $NVDА 5"), /plain letters/);
  errorOf(parse("$NVDА", { held: [], info: info() }), /plain letters/);
  errorOf(parse("/buy USDC 5"), /USDC is cash/);
  assert.equal(tickerOf("mcbBTC"), "cbBTC");
  assert.equal(tickerOf("mWETH"), "WETH");
  assert.equal(tickerOf("USDC"), "USDC");
  assert.equal(symbolOfTicker("$aapl"), "mAAPL");
  assert.equal(symbolOfTicker("USDC"), null);
  assert.equal(symbolOfTicker("NВDA"), null);
});

test("every command's happy path is an intent that passes parseAction", () => {
  const cases: [string, Intent][] = [
    ["/buy $NVDA 20$", { action: "buy", params: { asset: "mNVDA", usdc: "20" } }],
    ["/sell $AAPL 5$", { action: "sell", params: { asset: "mAAPL", amount: "5", unit: "usdc" } }],
    ["/send $NVDA 5 to @Maria", { action: "send", params: { to: { kind: "id", id: "maria" }, asset: "mNVDA", amount: "5", unit: "usdc", from: "vault" } }],
    ["/send USDC 5 to sd-7kq2m9xa", { action: "send", params: { to: { kind: "id", id: "SD-7KQ2M9XA" }, asset: "USDC", amount: "5", unit: "usdc", from: "wallet" } }],
    ["/send usdc 5 to maria from vault", { action: "send", params: { to: { kind: "id", id: "maria" }, asset: "USDC", amount: "5", unit: "usdc", from: "vault" } }],
    ["/earn 50", { action: "earn", params: { usdc: "50" } }],
    ["/lend 50", { action: "earn", params: { usdc: "50" } }],
    ["/stop-earning all", { action: "stop_earning", params: { usdc: "all" } }],
    ["/unlend 2.5", { action: "stop_earning", params: { usdc: "2.5" } }],
    ["/borrow $NVDA 20", { action: "borrow", params: { asset: "mNVDA", usdc: "20", risk: "mid" } }],
    ["/borrow $NVDA 20$ HIGH", { action: "borrow", params: { asset: "mNVDA", usdc: "20", risk: "high" } }],
    ["/repay all", { action: "repay", params: { asset: "every_loan", usdc: "0", all: true } }],
    ["/repay $NVDA 3", { action: "repay", params: { asset: "mNVDA", usdc: "3", all: false } }],
    ["/lock $NVDA 50%", { action: "lock", params: { asset: "mNVDA", amount: "50", unit: "percent" } }],
    ["/unlock $NVDA 10$", { action: "unlock", params: { asset: "mNVDA", amount: "10", unit: "usdc" } }],
    ["/withdraw USDC all", { action: "withdraw", params: { asset: "USDC", amount: "100", unit: "percent" } }],
    ["/withdraw $NVDA 25%", { action: "withdraw", params: { asset: "mNVDA", amount: "25", unit: "percent" } }],
    ["/gift @maria 10$ $AAPL", { action: "gift", params: { recipient_id: "maria", usdc: "10", box: "one_stock", asset: "mAAPL" } }],
    ["/gift SD-7KQ2M9XA 10", { action: "gift", params: { recipient_id: "SD-7KQ2M9XA", usdc: "10", box: "my_mix" } }],
  ];
  for (const [t, want] of cases) {
    const r = parse(t);
    assert.deepEqual(intentOf(r), want, t);
    // The completed text names the recipient, so the agent's own recipient check passes too.
    assert.equal(recipientProblem(want, (r as { text: string }).text), null, t);
  }
  // Command names are case-insensitive.
  assert.equal(intentOf(parse("/BUY $NVDA 1")).action, "buy");
});

test("info commands: /balance, /positions, /portfolio, /help, $NVDA and /borrow $NVDA", () => {
  const c = { held: [], info: info() };
  assert.equal((parse("/balance", c) as { view: { kind: string } }).view.kind, "balance");
  assert.equal((parse("/positions", c) as { view: { kind: string } }).view.kind, "positions");
  assert.equal((parse("/portfolio", c) as { view: { kind: string } }).view.kind, "positions");
  const help = parse("/help") as { kind: string; view: { kind: string; commands: unknown[] } };
  assert.equal(help.view.kind, "help");
  assert.equal(help.view.commands, COMMANDS);
  for (const m of COMMANDS) {
    assert.ok(m.name.startsWith("/"));
    assert.doesNotMatch(`${m.usage} ${m.description} ${m.example}`, /—/);
  }
  const t = parse("$nvda", c) as { kind: string; view: { kind: string; symbol: string } };
  assert.equal(t.kind, "info");
  assert.equal(t.view.kind, "ticker");
  assert.equal(t.view.symbol, "mNVDA");
  const b = parse("/borrow $NVDA", c) as { view: { kind: string } };
  assert.equal(b.view.kind, "borrow_max");
  // Without balances loaded, info views say so instead of showing zeros.
  errorOf(parse("/balance"), /loading/);
  errorOf(parse("$NVDA"), /loading/);
  errorOf(parse("$XYZ", c), /no \$XYZ/);
  errorOf(parse("$USDC", c), /cash/);
  // Not a ticker: goes to the model.
  assert.equal(parse("$5", c), null);
  assert.equal(parse("$NVDA?", c), null);
  assert.equal(parse("$NVDA is up today", c), null);
});

test("invest-only assets: /borrow $TSLA and /lock $TSLA are refused", () => {
  const c = { held: [], info: info() };
  errorOf(parse("/borrow $TSLA", c), /invest only/);
  errorOf(parse("/borrow $TSLA 5", c), /invest only/);
  errorOf(parse("/lock $TSLA 5"), /invest only/);
  errorOf(parse("/unlock $TSLA 5"), /invest only/);
  errorOf(parse("/repay $TSLA 5"), /invest only/);
  // Buying, selling and withdrawing an invest-only asset is fine.
  assert.equal(intentOf(parse("/buy $TSLA 5")).action, "buy");
  assert.equal(intentOf(parse("/sell $TSLA all")).action, "sell");
});

test("missing pieces are asked for, with chips that are the full command", () => {
  const amount = parse("/buy $NVDA");
  assert.ok(amount && amount.kind === "ask");
  assert.equal(amount.need, "amount");
  assert.equal(amount.question, "How much NVIDIA, in USDC?");
  assert.deepEqual(amount.draft, { command: "buy", asset: "mNVDA", partial: "/buy $NVDA" });
  assert.deepEqual(amount.chips.map((c) => [c.label, c.text]), [["$5", "/buy $NVDA 5$"], ["$10", "/buy $NVDA 10$"], ["$20", "/buy $NVDA 20$"], ["$50", "/buy $NVDA 50$"]]);
  for (const c of amount.chips) assert.equal(intentOf(parse(c.text)).action, "buy");

  const asset = parse("/buy 20");
  assert.ok(asset && asset.kind === "ask");
  assert.equal(asset.need, "asset");
  assert.equal(asset.question, "Which asset?");
  assert.ok(asset.chips.length <= 4);
  // Held assets first.
  assert.deepEqual(asset.chips.slice(0, 2).map((c) => c.text), ["/buy $NVDA 20$", "/buy $AAPL 20$"]);

  const both = parse("/buy");
  assert.ok(both && both.kind === "ask" && both.need === "asset");

  const who = parse("/send $NVDA 5");
  assert.ok(who && who.kind === "ask");
  assert.equal(who.need, "recipient");
  assert.equal(who.question, "Who is it for? Type a Stackday ID, @username or an address.");
  assert.deepEqual(who.chips, []);

  const borrow = parse("/borrow");
  assert.ok(borrow && borrow.kind === "ask" && borrow.need === "asset");
  for (const c of borrow.chips) {
    assert.match(c.text, /^\/borrow \$\w+$/);
    assert.equal(c.kind, "question");
  }
  const sellAsk = parse("/sell");
  assert.ok(sellAsk && sellAsk.kind === "ask");
  assert.deepEqual(sellAsk.chips.map((c) => c.text), ["/sell $NVDA", "/sell $AAPL"]);
  const repay = parse("/repay");
  assert.ok(repay && repay.kind === "ask" && repay.need === "amount");
  assert.ok(repay.chips.some((c) => c.text === "/repay all"));
  const gift = parse("/gift");
  assert.ok(gift && gift.kind === "ask" && gift.need === "recipient");
});

test("drafts: the next message completes the missing piece, anything else drops it", () => {
  const a = parse("/buy $NVDA");
  assert.ok(a && a.kind === "ask");
  for (const t of ["30", "30$", "$30", " 30 "]) assert.deepEqual(intentOf(completeDraft(a.draft, t, CTX)).params, { asset: "mNVDA", usdc: "30" }, t);
  assert.equal(completeDraft(a.draft, "what is NVIDIA?", CTX), null);
  assert.equal(completeDraft(a.draft, "/help", CTX), null);
  assert.equal(completeDraft(a.draft, "$NVDA", CTX), null);
  errorOf(completeDraft(a.draft, "0", CTX), /above zero/);

  const b = parse("/buy 20");
  assert.ok(b && b.kind === "ask");
  assert.deepEqual(intentOf(completeDraft(b.draft, "$NVDA", CTX)).params, { asset: "mNVDA", usdc: "20" });
  assert.deepEqual(intentOf(completeDraft(b.draft, "aapl", CTX)).params, { asset: "mAAPL", usdc: "20" });
  assert.equal(completeDraft(b.draft, "$XYZ", CTX), null);
  assert.equal(completeDraft(b.draft, "30", CTX), null);

  // Asset then amount: two questions in a row.
  const c = parse("/buy");
  assert.ok(c && c.kind === "ask");
  const c2 = completeDraft(c.draft, "$NVDA", CTX);
  assert.ok(c2 && c2.kind === "ask" && c2.need === "amount");
  assert.equal(intentOf(completeDraft(c2.draft, "5", CTX)).action, "buy");

  const d = parse("/send $NVDA 5");
  assert.ok(d && d.kind === "ask");
  assert.deepEqual((intentOf(completeDraft(d.draft, "@maria", CTX)).params as { to: unknown }).to, { kind: "id", id: "maria" });
  assert.deepEqual((intentOf(completeDraft(d.draft, "to SD-7KQ2M9XA", CTX)).params as { to: unknown }).to, { kind: "id", id: "SD-7KQ2M9XA" });
  const viaAddress = completeDraft(d.draft, ADDR_A, CTX);
  assert.deepEqual((intentOf(viaAddress).params as { to: unknown }).to, { kind: "typed_address" });
  assert.ok((viaAddress as { text: string }).text.includes(ADDR_A));
  assert.equal(completeDraft(d.draft, "cancel", CTX), null);
  assert.equal(completeDraft(d.draft, "who should I send it to?", CTX), null);
  assert.equal(completeDraft(d.draft, "30", CTX), null);

  const g = parse("/gift @maria");
  assert.ok(g && g.kind === "ask" && g.need === "amount");
  assert.deepEqual(intentOf(completeDraft(g.draft, "$10", CTX)).params, { recipient_id: "maria", usdc: "10", box: "my_mix" });
  // A gift never goes to an address.
  const g2 = parse("/gift");
  assert.ok(g2 && g2.kind === "ask");
  errorOf(completeDraft(g2.draft, ADDR_A, CTX), /not an address/);
  // A broken draft is dropped.
  assert.equal(completeDraft({ command: "nope", partial: "/nope" }, "5", CTX), null);
});

test("unknown commands, mid-sentence slashes and extra words", () => {
  errorOf(parse("/foo"), /^Unknown command\. Type \/help to see the commands\.$/);
  errorOf(parse("/buyy $NVDA 5"), /Unknown command/);
  assert.equal(parse("what does 50/50 mean?"), null);
  assert.equal(parse("can I /buy $NVDA 5"), null);
  assert.equal(parse("Buy $20 of Apple"), null);
  errorOf(parse("/buy $NVDA 5 please"), /extra words.*\/buy \$TICKER amount/);
  errorOf(parse("/balance now"), /extra words/);
  errorOf(parse("/buy $NVDA $AAPL 5"), /extra words/);
  errorOf(parse("/send USDC 5 to @maria from bank"), /from wallet/);
  errorOf(parse("/borrow $NVDA mid"), /amount/);
  assert.equal((parse("/") as { view: { kind: string } }).view.kind, "help");
});

test("sends to a typed 0x address: typed_address, and no address anywhere in the intent", () => {
  const r = parse(`/send USDC 5 to ${ADDR_A}`);
  const i = intentOf(r);
  assert.deepEqual(i.params, { to: { kind: "typed_address" }, asset: "USDC", amount: "5", unit: "usdc", from: "wallet" });
  assert.doesNotMatch(JSON.stringify(i), /0x/i);
  assert.equal(recipientProblem(i, (r as { text: string }).text), null);
  errorOf(parse(`/send USDC 5 to ${ADDR_A} ${ADDR_B}`), /more than one address/);
  errorOf(parse(`/send USDC 5 to ${ADDR_A} from ${ADDR_B}`), /more than one address/);
  errorOf(parse(`/send USDC 5 to ${ADDR_A} @maria`), /not both/);
  errorOf(parse(`/send USDC 5 to SD-7KQ2M9XA ${ADDR_A}`), /not both/);
  errorOf(parse("/send USDC 5 to 0x1234"), /not complete/);
  errorOf(parse(`/gift ${ADDR_A} 5`), /not an address/);
  errorOf(parse("/send USDC 5 to SD-0000IIII"), /not a Stackday ID/);
  errorOf(parse("/send USDC 5 to @a"), /not a username/);
});

test("send without the slash: the founder's phrasings, and anything else goes to the model", () => {
  const founder = parse(`send 1$ mSPCX to ${ADDR_A}`);
  const f = intentOf(founder);
  assert.deepEqual(f.params, { to: { kind: "typed_address" }, asset: "mSPCX", amount: "1", unit: "usdc", from: "vault" });
  assert.doesNotMatch(JSON.stringify(f), /0x/i);
  assert.ok((founder as { text: string }).text.includes(ADDR_A));
  assert.deepEqual(intentOf(parse("send $1 of NVDA to SD-F87SDUQV")).params, { to: { kind: "id", id: "SD-F87SDUQV" }, asset: "mNVDA", amount: "1", unit: "usdc", from: "vault" });
  assert.deepEqual(intentOf(parse("send 5 USDC to @maria")).params, { to: { kind: "id", id: "maria" }, asset: "USDC", amount: "5", unit: "usdc", from: "wallet" });
  assert.deepEqual(intentOf(parse("Send $NVDA 5 to @maria")).params, { to: { kind: "id", id: "maria" }, asset: "mNVDA", amount: "5", unit: "usdc", from: "vault" });
  assert.deepEqual(intentOf(parse("send 5 usdc to maria from vault")).params, { to: { kind: "id", id: "maria" }, asset: "USDC", amount: "5", unit: "usdc", from: "vault" });
  assert.deepEqual(intentOf(parse("SEND 2.5$ of gold to @maria.")).params, { to: { kind: "id", id: "maria" }, asset: "mPAXG", amount: "2.5", unit: "usdc", from: "vault" });
  // Caps still apply once the whole send parsed.
  errorOf(parse("send 101 USDC to @maria"), /at most 100/);
  // Not a full send: the model answers.
  for (const t of [
    "send money to my mom",
    "send 5 USDC",
    "send 5 USDC to",
    "send 5 XYZ to @maria",
    "send 5 USDC to @maria please",
    "send 5 USDC to @maria from bank",
    `send 5 USDC to ${ADDR_A} and ${ADDR_B}`,
    "send me the weekly research",
    "sending 5 USDC to @maria",
    "send 0 USDC to @maria",
  ])
    assert.equal(parse(t), null, t);
});

test("suggestAssets: held by value first, then borrowable, then invest only, max 4, filters", () => {
  const pos = positions({ mTSLA: { idle: tokens(1, 8) }, mAAPL: { idle: tokens(0.1, 8) }, mNVDA: { collateral: tokens(1, 8) } });
  const all = suggestAssets("", { positions: pos });
  assert.equal(all.length, 4);
  // Tesla 381, NVIDIA 190, Apple 35.7: held by value, then the first borrowable alphabetically.
  assert.deepEqual(all.map((s) => s.ticker), ["TSLA", "NVDA", "AAPL", "cbBTC"]);
  assert.equal(all[0].held, "1 held");
  assert.equal(all[3].held, null);
  assert.deepEqual(suggestAssets("", { positions: pos, filter: "held" }).map((s) => s.ticker), ["TSLA", "NVDA", "AAPL"]);
  assert.deepEqual(suggestAssets("", { positions: pos, filter: "borrowable" }).map((s) => s.ticker), ["NVDA", "AAPL", "cbBTC", "GOOGL"]);
  assert.ok(suggestAssets("", { positions: pos, filter: "borrowable" }).every((s) => s.borrowable));
  assert.deepEqual(suggestAssets("", { positions: pos, filter: "send" }).map((s) => s.ticker), ["USDC", "TSLA", "NVDA", "AAPL"]);
  assert.deepEqual(suggestAssets("usd", { positions: pos, filter: "send" }).map((s) => s.ticker), ["USDC"]);
  assert.equal(suggestAssets("u", { positions: pos, filter: "send" })[0].ticker, "USDC");
  // Prefix on ticker, name substring, aliases.
  assert.deepEqual(suggestAssets("$nv", { positions: pos }).map((s) => s.ticker), ["NVDA"]);
  assert.deepEqual(suggestAssets("btc", { positions: pos }).map((s) => s.ticker), ["cbBTC"]);
  assert.deepEqual(suggestAssets("gold", { positions: pos }).map((s) => s.ticker), ["PAXG"]);
  assert.ok(suggestAssets("eth", { positions: pos }).some((s) => s.symbol === "mWETH"));
  assert.ok(suggestAssets("soft", { positions: pos }).some((s) => s.symbol === "mMSFT"));
  // Unheld invest-only assets come last.
  // "m" matches META, MSFT and MSTR by ticker and Amazon, AMD and Treasuries by name (not every "m" symbol).
  assert.deepEqual(suggestAssets("m", { positions: positions() }).map((s) => s.ticker), ["META", "AMD", "AMZN", "MSFT"]);
  assert.deepEqual(suggestAssets("zzz", { positions: pos }), []);
  assert.deepEqual(suggestAssets("Н", { positions: pos }), []);
  assert.equal(all[0].icon, "TSLA");
});

test("the ask chips use real balances when info is passed", () => {
  const r = parse("/sell", { held: [], info: info() });
  assert.ok(r && r.kind === "ask");
  // Tesla 762, NVIDIA 190, Apple 35.7.
  assert.deepEqual(r.chips.map((c) => c.text), ["/sell $TSLA", "/sell $NVDA", "/sell $AAPL"]);
  const w = parse("/withdraw", { held: [], info: info() });
  assert.ok(w && w.kind === "ask");
  assert.equal(w.chips[0].text, "/withdraw USDC");
});
