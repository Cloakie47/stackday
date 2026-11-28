import { ASSETS, type Asset } from "../contracts.ts";
import { fmtAsset } from "../format.ts";
import { assetBySymbol, type PositionLike } from "./buildCalls.ts";
import { commandChip, type Chip } from "./chips.ts";
import { borrowMaxView, helpView, symbolOfTicker as symbolOf, TICKER_ALIASES, tickerOf as tickerOfSymbol, tickerView, balanceView, positionsView, type InfoContext } from "./info.ts";
import { CARD_CAP_USDC, parseAction, SEND_CAP_USDC, UID_RE, type Intent } from "./intent.ts";
import { addressesIn } from "./recipient.ts";

/**
 * Slash commands and $ tickers in the chat (founder approved grammar, November 28, 2026).
 *
 * A message that starts with "/" is a command: it never goes to the model. Its grammar is strict (an
 * extra word is an error that shows the usage), and every action it describes becomes an intent that
 * goes through the same parseAction() as a model's tool call, so caps, the asset allowlist and
 * normalization are identical. The intent then becomes a card the person checks and signs, as usual.
 * A missing asset, amount or recipient is asked for (a Draft the next message can complete).
 *
 * A message that is exactly a ticker ("$NVDA") shows that asset. A message starting with the word
 * "send" that fully matches the send grammar is a send command too; anything else goes to the model.
 *
 * No intent carries an address: a typed 0x address becomes to {kind:"typed_address"}, and the browser
 * reads the address from the person's own text (the result's `text`), as for the model's sends.
 */

export type { PositionLike };
export type Need = "amount" | "asset" | "recipient";
export type Draft = { command: string; asset?: string /* app symbol e.g. mNVDA */; partial: string /* the typed command so far */ };
export type CommandMeta = { name: string; aliases: string[]; usage: string; description: string; example: string };
export type AssetSuggestion = { symbol: string /* mNVDA */; ticker: string /* NVDA */; name: string; held: string | null /* "0.12 held" */; borrowable: boolean; icon: string };
export type InfoView =
  | { kind: "balance"; walletUsdc: string; vaultUsdc: string; earning: string; total: string }
  | {
      kind: "positions";
      holdings: { ticker: string; name: string; free: string; locked: string; value: string }[];
      loans: { ticker: string; owed: string; health: number | null; liquidationPrice: string | null }[];
      earning: string;
      total: string;
    }
  | { kind: "ticker"; ticker: string; symbol: string; name: string; price: string | null; wallet: string; vault: string; locked: string; value: string; borrowable: boolean; chips: Chip[] }
  | { kind: "borrow_max"; ticker: string; symbol: string; name: string; levels: { risk: "low" | "mid" | "high"; max: string; chip: Chip | null; note?: string }[]; reason?: string }
  | { kind: "help"; commands: CommandMeta[] };
export type CommandResult =
  /**
   * `text` is the whole command (as typed, or completed from a draft). Use it as the person's own
   * typed text for the card (usePlan userText): a typed_address send reads its address from it.
   */
  | { kind: "intent"; intent: Intent; text?: string }
  | { kind: "info"; view: InfoView }
  | { kind: "ask"; draft: Draft; need: Need; question: string; chips: Chip[] }
  | { kind: "error"; message: string }
  | null; // not a command: send to the model as usual
export type CommandContext = { held: string[] /* app symbols the person holds */; info?: InfoContext };

// ---- Grammar --------------------------------------------------------------------------------------

type Cmd = "buy" | "sell" | "send" | "earn" | "stop_earning" | "borrow" | "repay" | "lock" | "unlock" | "withdraw" | "gift" | "balance" | "positions" | "help";
type Risk = "low" | "mid" | "high";
type AmountForm = "usdc" | "percent" | "all";
type Amount = { kind: "usdc"; value: string } | { kind: "percent"; value: string } | { kind: "all" };
type Recipient = { kind: "id"; id: string } | { kind: "address"; address: string };
type Pieces = { cmd: Cmd; asset?: string; amount?: Amount; recipient?: Recipient; from?: "wallet" | "vault"; risk?: Risk };
type Slot =
  | { s: "asset"; required: boolean; usdc?: boolean }
  | { s: "amount"; required: boolean; forms: AmountForm[] }
  /** "to <recipient>" (send). */
  | { s: "to" }
  /** A bare recipient (gift). */
  | { s: "recipient" }
  | { s: "from" }
  | { s: "risk" };
type Def = { names: string[]; slots: Slot[]; usage: string; description: string; example: string };

const DEFS: Record<Cmd, Def> = {
  buy: {
    names: ["/buy"],
    slots: [{ s: "asset", required: true }, { s: "amount", required: true, forms: ["usdc"] }],
    usage: "/buy $TICKER amount",
    description: "Buy an asset with USDC from your wallet, into your vault.",
    example: "/buy $NVDA 20$",
  },
  sell: {
    names: ["/sell"],
    slots: [{ s: "asset", required: true }, { s: "amount", required: true, forms: ["usdc", "percent", "all"] }],
    usage: "/sell $TICKER amount|percent|all",
    description: "Sell an asset in your vault for USDC (test sell desk).",
    example: "/sell $NVDA 25%",
  },
  send: {
    names: ["/send"],
    slots: [{ s: "asset", required: true, usdc: true }, { s: "amount", required: true, forms: ["usdc"] }, { s: "to" }, { s: "from" }],
    usage: "/send $TICKER|USDC amount to SD-ID|@username|0x address [from wallet|vault]",
    description: `Send USDC or an asset to someone else (up to ${SEND_CAP_USDC} test USDC a card).`,
    example: "/send USDC 5$ to @maria",
  },
  earn: {
    names: ["/earn", "/lend"],
    slots: [{ s: "amount", required: true, forms: ["usdc"] }],
    usage: "/earn amount",
    description: "Put idle USDC to work earning interest.",
    example: "/earn 50$",
  },
  stop_earning: {
    names: ["/stop-earning", "/unlend"],
    slots: [{ s: "amount", required: true, forms: ["usdc", "all"] }],
    usage: "/stop-earning amount|all",
    description: "Take earning USDC back to your wallet.",
    example: "/stop-earning all",
  },
  borrow: {
    names: ["/borrow"],
    slots: [{ s: "asset", required: true }, { s: "amount", required: false, forms: ["usdc"] }, { s: "risk" }],
    usage: "/borrow $TICKER [amount] [low|mid|high]",
    description: "See how much you can borrow against an asset, or borrow USDC against it (mid risk if you do not say).",
    example: "/borrow $NVDA 20$ low",
  },
  repay: {
    names: ["/repay"],
    slots: [{ s: "asset", required: false }, { s: "amount", required: true, forms: ["usdc", "all"] }],
    usage: "/repay [$TICKER] amount|all",
    description: "Repay a loan, or every loan when you do not name an asset.",
    example: "/repay $NVDA all",
  },
  lock: {
    names: ["/lock"],
    slots: [{ s: "asset", required: true }, { s: "amount", required: true, forms: ["usdc", "percent"] }],
    usage: "/lock $TICKER amount|percent",
    description: "Lock free assets in your vault as collateral.",
    example: "/lock $NVDA 50%",
  },
  unlock: {
    names: ["/unlock"],
    slots: [{ s: "asset", required: true }, { s: "amount", required: true, forms: ["usdc", "percent"] }],
    usage: "/unlock $TICKER amount|percent",
    description: "Unlock collateral so it is free again.",
    example: "/unlock $NVDA 10$",
  },
  withdraw: {
    names: ["/withdraw"],
    slots: [{ s: "asset", required: true, usdc: true }, { s: "amount", required: true, forms: ["usdc", "percent", "all"] }],
    usage: "/withdraw $TICKER|USDC amount|percent|all",
    description: "Move an asset or idle USDC from your vault to your wallet.",
    example: "/withdraw USDC all",
  },
  gift: {
    names: ["/gift"],
    slots: [{ s: "recipient" }, { s: "amount", required: true, forms: ["usdc"] }, { s: "asset", required: false }],
    usage: "/gift SD-ID|@username amount [$TICKER]",
    description: "Send a gift box: one stock if you name it, otherwise your own mix.",
    example: "/gift @maria 10$ $AAPL",
  },
  balance: { names: ["/balance"], slots: [], usage: "/balance", description: "Your USDC: wallet, vault and earning.", example: "/balance" },
  positions: { names: ["/positions", "/portfolio"], slots: [], usage: "/positions", description: "Your holdings, loans and earning USDC.", example: "/positions" },
  help: { names: ["/help"], slots: [], usage: "/help", description: "Show the commands.", example: "/help" },
};
const CMDS = Object.keys(DEFS) as Cmd[];

/** Every command, for /help and the command menu. `name` and `aliases` include the leading slash. */
export const COMMANDS: CommandMeta[] = CMDS.map((c) => ({ name: DEFS[c].names[0], aliases: DEFS[c].names.slice(1), usage: DEFS[c].usage, description: DEFS[c].description, example: DEFS[c].example }));

const cmdByName = (name: string): Cmd | undefined => CMDS.find((c) => DEFS[c].names.includes(name.toLowerCase()));
const usageLine = (cmd: Cmd) => `Use: ${DEFS[cmd].usage} (for example ${DEFS[cmd].example}).`;

/** A refusal with a message for the person. Thrown inside the parser, caught at the top. */
class CmdError extends Error {}
const fail = (message: string): never => {
  throw new CmdError(message);
};

// ---- Tokens ---------------------------------------------------------------------------------------

export const tickerOf = tickerOfSymbol;
export const symbolOfTicker = symbolOf;

const KEYWORDS = new Set(["to", "from", "low", "mid", "high", "all", "of"]);
const isKeyword = (t: string) => KEYWORDS.has(t.toLowerCase());
/** Looks like an amount: a number (with $ before or after), a percent, or "all". */
const isAmountish = (t: string) => (/^[-+$\d.,]/.test(t) && !/^\$[^\d.,]/.test(t) && !/^0x/i.test(t)) || /%$/.test(t) || t.toLowerCase() === "all";
const nonAscii = (t: string) => /[^\x20-\x7e]/.test(t);

function parseAmountToken(t: string, forms: AmountForm[], cmd: Cmd): Amount {
  if (t.toLowerCase() === "all") return forms.includes("all") ? { kind: "all" } : fail(`"all" does not work here. ${usageLine(cmd)}`);
  if (t.endsWith("%")) {
    if (!forms.includes("percent")) return fail(`Use a USDC amount here, like 20$. ${usageLine(cmd)}`);
    const m = /^(\d{1,3})(\.\d{1,2})?%$/.exec(t);
    const n = m ? Number(m[1] + (m[2] ?? "")) : NaN;
    if (!m || !(n >= 1 && n <= 100)) return fail("A percent is between 1% and 100%.");
    return { kind: "percent", value: String(Number(m[1])) + (m[2] ?? "") };
  }
  const m = /^(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\$)?$/.exec(t);
  if (!m || (m[1] && m[4])) return fail(`Amounts are positive numbers in USDC, like 5, 5$, $5 or 5.50. ${usageLine(cmd)}`);
  const frac = m[3] ?? "";
  if (frac.length > 6) return fail("USDC has at most 6 decimals.");
  const whole = m[2].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (whole.length > 9) return fail("That amount is too large.");
  if (/^0*$/.test(whole + frac)) return fail("The amount must be above zero.");
  return { kind: "usdc", value: frac ? `${whole}.${frac}` : whole };
}

function parseAssetToken(t: string, allowUsdc: boolean, cmd: Cmd): string {
  const bare = t.startsWith("$") ? t.slice(1) : t;
  if (nonAscii(bare)) return fail("Tickers use plain letters A to Z, like $NVDA.");
  if (bare.toUpperCase() === "USDC") return allowUsdc ? "USDC" : fail(`USDC is cash, not an asset. ${usageLine(cmd)}`);
  const symbol = symbolOf(bare);
  if (!symbol) return fail(`There is no ${/^[A-Za-z]{1,12}$/.test(bare) ? `$${bare.toUpperCase()}` : "such asset"} on Stackday. ${usageLine(cmd)}`);
  return symbol;
}

const STOP_WORDS = new Set(["cancel", "stop", "nevermind", "never", "no", "nope", "yes", "ok", "okay"]);

function parseRecipientToken(t: string, allowAddress: boolean): Recipient {
  if (nonAscii(t)) return fail("Recipients use plain letters and numbers.");
  if (/^0x/i.test(t)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return fail("That address is not complete. Type the whole 0x address (42 characters).");
    return allowAddress ? { kind: "address", address: t } : fail("Gift boxes go to a Stackday ID or @username, not an address.");
  }
  if (/^sd-/i.test(t)) {
    const id = t.toUpperCase();
    return UID_RE.test(id) ? { kind: "id", id } : fail("That is not a Stackday ID. IDs look like SD-7KQ2M9XA.");
  }
  const name = t.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(name)) return fail("That is not a username. Usernames are 3 to 20 letters, numbers or _.");
  return { kind: "id", id: name };
}

const looksLikeRecipient = (t: string) => /^(@|sd-|0x)/i.test(t);

// ---- Parsing --------------------------------------------------------------------------------------

/** Reads the tokens after the command name into pieces; the missing required slots are listed in order. */
function readPieces(cmd: Cmd, tokens: string[]): { pieces: Pieces; missing: Need[] } {
  const pieces: Pieces = { cmd };
  const missing: Need[] = [];
  let i = 0;
  for (const slot of DEFS[cmd].slots) {
    const t = tokens[i];
    switch (slot.s) {
      case "asset":
        if (t !== undefined && !isAmountish(t) && !isKeyword(t) && !looksLikeRecipient(t)) {
          pieces.asset = parseAssetToken(t, !!slot.usdc, cmd);
          i++;
        } else if (slot.required) missing.push("asset");
        break;
      case "amount":
        if (t !== undefined && isAmountish(t)) {
          pieces.amount = parseAmountToken(t, slot.forms, cmd);
          i++;
        } else if (slot.required) missing.push("amount");
        break;
      case "to":
        if (t !== undefined && t.toLowerCase() === "to") {
          i++;
          const r = tokens[i];
          if (r !== undefined && r.toLowerCase() !== "from") {
            pieces.recipient = parseRecipientToken(r, true);
            i++;
          } else missing.push("recipient");
        } else if (t !== undefined && looksLikeRecipient(t)) {
          pieces.recipient = parseRecipientToken(t, true);
          i++;
        } else missing.push("recipient");
        break;
      case "recipient":
        if (t !== undefined && !isAmountish(t) && !isKeyword(t) && !t.startsWith("$")) {
          pieces.recipient = parseRecipientToken(t, false);
          i++;
        } else missing.push("recipient");
        break;
      case "from":
        if (t !== undefined && t.toLowerCase() === "from") {
          const w = tokens[i + 1]?.toLowerCase();
          if (w !== "wallet" && w !== "vault") fail(`Say "from wallet" or "from vault". ${usageLine(cmd)}`);
          pieces.from = w as "wallet" | "vault";
          i += 2;
        }
        break;
      case "risk":
        if (t !== undefined && ["low", "mid", "high"].includes(t.toLowerCase())) {
          pieces.risk = t.toLowerCase() as Risk;
          i++;
        }
        break;
    }
  }
  if (i < tokens.length) fail(`That command has extra words. ${usageLine(cmd)}`);
  return { pieces, missing };
}

const amountText = (a: Amount) => (a.kind === "all" ? "all" : a.kind === "percent" ? `${a.value}%` : `${a.value}$`);
const assetText = (s: string) => (s === "USDC" ? "USDC" : `$${tickerOf(s)}`);
const recipientText = (r: Recipient) => (r.kind === "address" ? r.address : /^SD-/.test(r.id) ? r.id : `@${r.id}`);

/** The canonical command for some pieces (what a chip sends and what a draft keeps). */
function render(p: Pieces): string {
  const out: string[] = [DEFS[p.cmd].names[0]];
  for (const slot of DEFS[p.cmd].slots) {
    if (slot.s === "asset" && p.asset) out.push(assetText(p.asset));
    if (slot.s === "amount" && p.amount) out.push(amountText(p.amount));
    if (slot.s === "to" && p.recipient) out.push("to", recipientText(p.recipient));
    if (slot.s === "recipient" && p.recipient) out.push(recipientText(p.recipient));
    if (slot.s === "from" && p.from) out.push("from", p.from);
    if (slot.s === "risk" && p.risk) out.push(p.risk);
  }
  return out.join(" ");
}

/** Assets a command can take, for the asset question's chips and the suggestion menu. */
const FILTER: Partial<Record<Cmd, "all" | "borrowable" | "held" | "send">> = {
  buy: "all",
  sell: "held",
  send: "send",
  borrow: "borrowable",
  lock: "borrowable",
  unlock: "held",
  withdraw: "held",
};

/** Kind of a chip for these pieces: /borrow without an amount only shows information. */
const chipKind = (p: Pieces): Chip["kind"] => (p.cmd === "borrow" && !p.amount ? "question" : "action");

function ask(p: Pieces, need: Need, ctx: CommandContext): CommandResult {
  const draft: Draft = { command: p.cmd, ...(p.asset ? { asset: p.asset } : {}), partial: render(p) };
  if (need === "recipient") {
    const question = p.cmd === "gift" ? "Who is it for? Type a Stackday ID or @username." : "Who is it for? Type a Stackday ID, @username or an address.";
    return { kind: "ask", draft, need, question, chips: [] };
  }
  if (need === "asset") {
    const list = suggestionsFor(ctx, FILTER[p.cmd] ?? "all");
    // Withdraw also takes idle USDC.
    const withUsdc = p.cmd === "withdraw" ? [usdcSuggestion(), ...list].slice(0, 4) : list;
    const chips = withUsdc.map((s) => commandChip(assetText(s.symbol), render({ ...p, asset: s.symbol }), chipKind({ ...p, asset: s.symbol })));
    return { kind: "ask", draft, need, question: chips.length ? "Which asset?" : "Which asset? Type $ and its ticker, like $NVDA.", chips };
  }
  const forms = (DEFS[p.cmd].slots.find((s) => s.s === "amount") as Extract<Slot, { s: "amount" }>).forms;
  const a = p.asset && p.asset !== "USDC" ? assetBySymbol(p.asset) : undefined;
  const what = a ? `How much ${a.name}` : p.cmd === "repay" ? "How much do you want to repay" : "How much USDC";
  const question =
    forms.includes("percent") ? `${what}? Type a USDC amount like 20$, a percent like 25%${forms.includes("all") ? ", or all" : ""}.` : `${what}${a || p.cmd === "repay" ? ", in USDC" : ""}?${forms.includes("all") ? " Or type all." : ""}`;
  const chips = [5, 10, 20, 50].map((n) => commandChip(`$${n}`, render({ ...p, amount: { kind: "usdc", value: String(n) } }), chipKind(p)));
  if (forms.includes("all")) chips.push(commandChip("All", render({ ...p, amount: { kind: "all" } }), chipKind(p)));
  return { kind: "ask", draft, need, question, chips };
}

const needInfo = (): CommandResult => ({ kind: "error", message: "Your balances are still loading. Try again in a moment." });

const CAPPED: ReadonlySet<Cmd> = new Set(["buy", "borrow", "gift", "earn"]);

/** Pieces to an intent, through parseAction (the same checks as the model's tool calls). */
function toIntent(p: Pieces): CommandResult {
  const a = p.asset && p.asset !== "USDC" ? assetBySymbol(p.asset) : undefined;
  if (a && !a.borrowable && (p.cmd === "borrow" || p.cmd === "lock" || p.cmd === "unlock" || p.cmd === "repay")) {
    const what = p.cmd === "borrow" ? "borrow against it" : p.cmd === "lock" ? "lock it as collateral" : p.cmd === "unlock" ? "unlock it" : "repay a loan on it";
    return { kind: "error", message: `${a.name} is invest only: it has no lending market, so you cannot ${what}.` };
  }
  const amt = p.amount!;
  const usdc = amt.kind === "usdc" ? amt.value : undefined;
  if (usdc && CAPPED.has(p.cmd) && Number(usdc) > CARD_CAP_USDC) return { kind: "error", message: `One card can move at most ${CARD_CAP_USDC} test USDC. Try a smaller amount.` };
  if (usdc && p.cmd === "send" && Number(usdc) > SEND_CAP_USDC) return { kind: "error", message: `A send can move at most ${SEND_CAP_USDC} test USDC a card. Try a smaller amount.` };
  const assetAmount = () => (amt.kind === "all" ? { amount: "100", unit: "percent" } : { amount: amt.value, unit: amt.kind });
  let name: string;
  let params: Record<string, unknown>;
  switch (p.cmd) {
    case "buy":
      [name, params] = ["buy", { asset: p.asset, usdc }];
      break;
    case "sell":
    case "withdraw":
    case "lock":
    case "unlock":
      [name, params] = [p.cmd, { asset: p.asset, ...assetAmount() }];
      break;
    case "send": {
      const r = p.recipient!;
      const to = r.kind === "address" ? { kind: "typed_address" } : { kind: "id", id: r.id };
      [name, params] = ["send", { to, asset: p.asset, amount: usdc, unit: "usdc", from: p.from ?? (p.asset === "USDC" ? "wallet" : "vault") }];
      break;
    }
    case "earn":
      [name, params] = ["earn", { usdc }];
      break;
    case "stop_earning":
      [name, params] = ["stop_earning", { usdc: amt.kind === "all" ? "all" : usdc }];
      break;
    case "borrow":
      [name, params] = ["borrow", { asset: p.asset, usdc, risk: p.risk ?? "mid" }];
      break;
    case "repay":
      [name, params] = ["repay", { asset: p.asset ?? "every_loan", usdc: amt.kind === "all" ? "0" : usdc, all: amt.kind === "all" }];
      break;
    case "gift":
      [name, params] = ["gift", { recipient_id: (p.recipient as Extract<Recipient, { kind: "id" }>).id, usdc, box: p.asset ? "one_stock" : "my_mix", ...(p.asset ? { asset: p.asset } : {}) }];
      break;
    default:
      return { kind: "error", message: "Unknown command. Type /help to see the commands." };
  }
  const r = parseAction(name, params);
  if (!r.ok) return { kind: "error", message: `I could not prepare that card (${r.error}). ${usageLine(p.cmd)}` };
  return { kind: "intent", intent: r.intent, text: render(p) };
}

/** Pieces that parsed: ask for what is missing, show info, or build the intent. */
function finish(p: Pieces, missing: Need[], ctx: CommandContext): CommandResult {
  if (missing.length) return ask(p, missing[0], ctx);
  if (p.cmd === "help") return { kind: "info", view: helpView(COMMANDS) };
  if (p.cmd === "balance") return ctx.info ? { kind: "info", view: balanceView(ctx.info) } : needInfo();
  if (p.cmd === "positions") return ctx.info ? { kind: "info", view: positionsView(ctx.info) } : needInfo();
  if (p.cmd === "borrow" && !p.amount) {
    const a = assetBySymbol(p.asset!)!;
    if (!a.borrowable) return { kind: "error", message: `${a.name} is invest only: it has no lending market, so you cannot borrow against it.` };
    if (p.risk) return { kind: "error", message: `Add the amount too, like /borrow ${assetText(a.symbol)} 20$ ${p.risk}.` };
    if (!ctx.info) return needInfo();
    return { kind: "info", view: borrowMaxView(a.symbol, ctx.info)! };
  }
  return toIntent(p);
}

/** Refuses a command with more than one address, or an address together with a Stackday ID or @username. */
function addressProblem(text: string): string | null {
  const found = [...new Set(addressesIn(text).map((a) => a.toLowerCase()))];
  if (found.length > 1) return "Your message has more than one address. Use just the one you mean.";
  if (found.length === 1 && (/(^|\s)@\w/.test(text) || /(^|\s)sd-/i.test(text))) return "Use either an address or a Stackday ID or @username, not both.";
  return null;
}

function run(text: string, ctx: CommandContext): CommandResult {
  const tokens = text.trim().split(/\s+/);
  const head = tokens.shift()!;
  if (head === "/") return { kind: "info", view: helpView(COMMANDS) };
  const cmd = cmdByName(head);
  if (!cmd) return { kind: "error", message: "Unknown command. Type /help to see the commands." };
  const problem = addressProblem(text);
  if (problem) return { kind: "error", message: problem };
  try {
    const { pieces, missing } = readPieces(cmd, tokens);
    return finish(pieces, missing, ctx);
  } catch (e) {
    if (e instanceof CmdError) return { kind: "error", message: e.message };
    throw e;
  }
}

/**
 * "send 1$ mSPCX to 0x...", "send $1 of NVDA to SD-...", "send 5 USDC to @maria" or "send $NVDA 5 to
 * @maria" (optionally "from wallet|vault"), rewritten as the /send command. Null unless every piece
 * parses, so a question that starts with "send" still goes to the model.
 */
function naturalSend(text: string): string | null {
  const t = text.trim().replace(/[.!]+$/, "").split(/\s+/);
  if (t.shift()?.toLowerCase() !== "send" || t.length < 4) return null;
  let i = 0;
  let amount: string | undefined;
  let asset: string | undefined;
  if (isAmountish(t[0])) {
    amount = t[i++];
    if (t[i]?.toLowerCase() === "of") i++;
    asset = t[i++];
  } else {
    asset = t[i++];
    amount = t[i++];
  }
  if (!asset || !amount || t[i]?.toLowerCase() !== "to" || !t[i + 1]) return null;
  const to = t[i + 1];
  i += 2;
  let from: string | undefined;
  if (t[i]?.toLowerCase() === "from") {
    from = t[i + 1]?.toLowerCase();
    if (from !== "wallet" && from !== "vault") return null;
    i += 2;
  }
  if (i !== t.length) return null;
  try {
    const a = parseAmountToken(amount, ["usdc"], "send");
    const s = parseAssetToken(asset, true, "send");
    const r = parseRecipientToken(to, true);
    return render({ cmd: "send", asset: s, amount: a, recipient: r, ...(from ? { from: from as "wallet" | "vault" } : {}) });
  } catch {
    return null;
  }
}

/**
 * The one entry point for a typed message. Null when it is not a command (send it to the model).
 * Pass `ctx.info` (infoContext) so /balance, /positions, /borrow $X and $X can be shown.
 */
export function parseCommand(text: string, ctx: CommandContext): CommandResult {
  const s = text.trim();
  if (s.startsWith("/")) return run(s, ctx);
  if (/^send\s/i.test(s)) {
    const cmd = naturalSend(s);
    if (!cmd || addressProblem(s)) return null;
    const r = run(cmd, ctx);
    return r && r.kind !== "ask" ? r : null;
  }
  // A message that is exactly a ticker: "$NVDA" or "$nvda".
  if (/^\$[^\s\d.,$]\S*$/.test(s)) {
    const bare = s.slice(1);
    if (nonAscii(bare)) return { kind: "error", message: "Tickers use plain letters A to Z, like $NVDA." };
    if (bare.toUpperCase() === "USDC") return { kind: "error", message: "USDC is cash, not an asset. Type /balance to see your USDC." };
    const symbol = symbolOf(bare);
    if (!/^[A-Za-z]{1,12}$/.test(bare)) return null;
    if (!symbol) return { kind: "error", message: `There is no $${bare.toUpperCase()} on Stackday. Type /help to see the commands.` };
    if (!ctx.info) return needInfo();
    return { kind: "info", view: tickerView(symbol, ctx.info)! };
  }
  return null;
}

/**
 * The next message after an "ask": it completes the draft when it is exactly the missing piece (an
 * amount like 30, 30$ or $30; an asset like $NVDA; the recipient). Null otherwise: the draft is then
 * dropped, and the message goes through parseCommand as usual.
 */
export function completeDraft(draft: Draft, text: string, ctx: CommandContext): CommandResult {
  const s = text.trim();
  if (!s || s.startsWith("/") || /\s/.test(s.replace(/^to\s+/i, ""))) return null;
  const cmd = CMDS.find((c) => c === draft.command);
  if (!cmd || !draft.partial.startsWith("/")) return null;
  let parsed: { pieces: Pieces; missing: Need[] };
  try {
    parsed = readPieces(cmd, draft.partial.trim().split(/\s+/).slice(1));
  } catch {
    return null;
  }
  const need = parsed.missing[0];
  if (!need) return null;
  const p = { ...parsed.pieces };
  try {
    if (need === "amount") {
      if (!isAmountish(s)) return null;
      const slot = DEFS[cmd].slots.find((x) => x.s === "amount") as Extract<Slot, { s: "amount" }>;
      p.amount = parseAmountToken(s, slot.forms, cmd);
    } else if (need === "asset") {
      const allowUsdc = !!(DEFS[cmd].slots.find((x) => x.s === "asset") as Extract<Slot, { s: "asset" }>).usdc;
      if (nonAscii(s)) return null;
      if (s.replace(/^\$/, "").toUpperCase() === "USDC" ? !allowUsdc : !symbolOf(s)) return null;
      p.asset = parseAssetToken(s, allowUsdc, cmd);
    } else {
      const r = s.replace(/^to\s+/i, "");
      if (isAmountish(r) || r.startsWith("$") || STOP_WORDS.has(r.toLowerCase())) return null;
      p.recipient = parseRecipientToken(r, cmd === "send");
    }
  } catch (e) {
    if (e instanceof CmdError) return { kind: "error", message: e.message };
    throw e;
  }
  return run(render(p), ctx);
}

// ---- Suggestions ----------------------------------------------------------------------------------

type Entry = { asset: Asset; units: bigint; value: bigint };

function usdcSuggestion(): AssetSuggestion {
  return { symbol: "USDC", ticker: "USDC", name: "USDC", held: null, borrowable: false, icon: "$" };
}

function rank(query: string, entries: Entry[], filter: "all" | "borrowable" | "held" | "send"): AssetSuggestion[] {
  const q = query.trim().replace(/^\$/, "").toLowerCase();
  if (nonAscii(q)) return [];
  const aliasHits = Object.entries(TICKER_ALIASES)
    .filter(([k]) => q && k.toLowerCase().startsWith(q))
    .map(([, v]) => v);
  const matches = (a: Asset) =>
    !q || tickerOf(a.symbol).toLowerCase().startsWith(q) || (q.length > 1 && a.symbol.toLowerCase().startsWith(q)) || (q.length > 1 ? a.name.toLowerCase().includes(q) : a.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) || aliasHits.includes(a.symbol);
  const group = (e: Entry) => (e.units > 0n ? 0 : e.asset.borrowable ? 1 : 2);
  const list = entries
    .filter((e) => matches(e.asset))
    .filter((e) => (filter === "borrowable" ? e.asset.borrowable : filter === "held" ? e.units > 0n : true))
    .sort((x, y) => group(x) - group(y) || (group(x) === 0 && x.value !== y.value ? (y.value > x.value ? 1 : -1) : 0) || tickerOf(x.asset.symbol).toLowerCase().localeCompare(tickerOf(y.asset.symbol).toLowerCase()))
    .map((e) => ({
      symbol: e.asset.symbol,
      ticker: tickerOf(e.asset.symbol),
      name: e.asset.name,
      held: e.units > 0n ? `${fmtAsset(e.units, e.asset.decimals)} held` : null,
      borrowable: e.asset.borrowable,
      icon: e.asset.icon,
    }));
  const out = filter === "send" && (!q || "usdc".startsWith(q)) ? [usdcSuggestion(), ...list] : list;
  return out.slice(0, 4);
}

const entryOf = (p: PositionLike): Entry => {
  const units = p.idle + p.collateral + p.wallet;
  return { asset: p.asset, units, value: p.price ? (units * p.price) / 10n ** BigInt(p.asset.decimals + 2) : 0n };
};

/**
 * Up to 4 assets for the menu after "$" or a command: ticker prefix or name match ("btc", "gold" and
 * "eth" match by alias or name), held first (largest value first), then borrowable, then invest only,
 * alphabetical within. Filters: borrowable (/borrow, /lock), held (/sell, /unlock), send (adds USDC).
 */
export function suggestAssets(query: string, ctx: { positions: PositionLike[]; filter?: "all" | "borrowable" | "held" | "send" }): AssetSuggestion[] {
  return rank(query, ctx.positions.map(entryOf), ctx.filter ?? "all");
}

/** Suggestions from the command context: real balances when `info` is there, else the held list. */
function suggestionsFor(ctx: CommandContext, filter: "all" | "borrowable" | "held" | "send"): AssetSuggestion[] {
  if (ctx.info) return suggestAssets("", { positions: ctx.info.positions, filter });
  const order = ctx.held.filter((s) => assetBySymbol(s));
  const entries = ASSETS.map((asset) => ({ asset, units: order.includes(asset.symbol) ? 1n : 0n, value: BigInt(order.length - order.indexOf(asset.symbol)) }));
  return rank("", entries, filter).map((s) => ({ ...s, held: null }));
}
