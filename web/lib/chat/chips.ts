import { ASSETS } from "../contracts.ts";
import { usdcText, type Plan } from "./buildCalls.ts";
import { CARD_CAP_UNITS, type ActionName } from "./intent.ts";
import { READ_TOOL_NAMES, type ReadToolName } from "./tools.ts";

/**
 * Suggestion chips in the chat dock. Every chip comes from the fixed catalogue below, chosen by code
 * from the page, the intent type or the read tools a turn used. Never from model output or research
 * text. A chip only sends a message, the same as typing it; an action still becomes a card the person
 * checks and signs. After a turn that included untrusted research text, only question chips are offered.
 */

export type ChipKind = "question" | "action";
export type Chip = { id: ChipId; label: string; text: string; kind: ChipKind };

const q = (label: string, text = label) => ({ label, text, kind: "question" as const });
const a = (label: string, text = label) => ({ label, text, kind: "action" as const });

export const CHIP_CATALOGUE = {
  portfolio: q("What do I have?"),
  loan: q("How is my loan?"),
  fees: q("What are the fees?"),
  plans: q("Which recurring buys do I have?"),
  prices: q("Test prices", "What are the test prices of Apple, NVIDIA and gold?"),
  weekly: q("This week's research", "What is Stackday's general research view this week?"),
  gold_view: q("Gold this week", "What does Stackday think about gold this week?"),
  how_borrowing: q("How does borrowing work?"),
  how_recurring: q("How do recurring buys work?"),
  how_selling: q("How does selling work here?"),
  how_gifts: q("How do gift boxes work?"),
  how_testnet: q("What is real here?", "What is real and what is a test here?"),
  buy_apple: a("Buy $20 of Apple"),
  weekly_buy: a("Set up a weekly buy"),
  repay: a("Repay my loan"),
  borrow: a("Borrow against my holdings"),
  /** Its label and text carry an amount computed in code (borrowInsteadChip); this entry is the template. */
  borrow_instead: a("Borrow instead"),
} as const;
export type ChipId = keyof typeof CHIP_CATALOGUE;

export const chip = (id: ChipId): Chip => ({ id, ...CHIP_CATALOGUE[id] });
const pick = (ids: ChipId[]) => ids.map(chip);

/** Starter chips for the empty dock, by the page it was opened on. */
export function starterChips(pathname: string | null | undefined): Chip[] {
  const path = (pathname ?? "").toLowerCase();
  const on = (segment: string) => path === `/${segment}` || path.startsWith(`/${segment}/`);
  if (on("borrow") || on("risk")) return pick(["loan", "repay", "how_borrowing"]);
  if (on("invest")) return pick(["buy_apple", "weekly_buy", "fees"]);
  if (on("research") || on("themes")) return pick(["weekly", "gold_view", "portfolio"]);
  if (on("gifts")) return pick(["how_gifts", "portfolio", "fees"]);
  return pick(["portfolio", "fees", "weekly", "buy_apple"]);
}

/** What code knows about the turn that just ended. Nothing in here is model text. */
export type TurnFacts = {
  /** The validated intent's action, when the turn produced a card. */
  action?: ActionName;
  /** Read tools the server ran in the turn (anything else is ignored). */
  tools?: readonly string[];
  /** The turn included untrusted research text. */
  untrusted?: boolean;
};

const BY_ACTION: Record<ActionName, ChipId[]> = {
  buy: ["portfolio", "weekly_buy", "fees"],
  recurring_buy: ["plans", "how_recurring", "fees"],
  cancel_plan: ["plans", "portfolio"],
  sell: ["portfolio", "how_selling", "how_borrowing"],
  withdraw: ["portfolio", "how_testnet"],
  borrow: ["loan", "how_borrowing", "fees"],
  repay: ["loan", "portfolio"],
  gift: ["how_gifts", "portfolio"],
};

const BY_TOOL: Record<ReadToolName, ChipId[]> = {
  get_portfolio: ["loan", "buy_apple", "fees"],
  get_loan: ["repay", "how_borrowing", "fees"],
  get_prices: ["buy_apple", "portfolio"],
  get_weekly_view: ["portfolio", "how_borrowing", "fees"],
  explain: ["portfolio", "fees", "how_testnet"],
};

const DEFAULT_FOLLOW_UPS: ChipId[] = ["portfolio", "fees", "weekly"];
const QUESTION_FALLBACK: ChipId[] = ["portfolio", "fees", "how_borrowing", "how_testnet"];

/** 2 or 3 follow-up chips for the turn that just ended. Never an action chip after untrusted text. */
export function followUpChips(turn: TurnFacts, lastUserText = ""): Chip[] {
  const tools = (turn.tools ?? []).filter((t): t is ReadToolName => (READ_TOOL_NAMES as readonly string[]).includes(t));
  const ids: ChipId[] = turn.action ? [...BY_ACTION[turn.action]] : tools.length ? tools.flatMap((t) => BY_TOOL[t]) : [...DEFAULT_FOLLOW_UPS];
  const asked = lastUserText.trim().toLowerCase();
  const keep = (id: ChipId) => CHIP_CATALOGUE[id].text.toLowerCase() !== asked && id !== "borrow_instead" && (!turn.untrusted || CHIP_CATALOGUE[id].kind === "question");
  const out: ChipId[] = [];
  for (const id of [...ids, ...QUESTION_FALLBACK]) {
    if (out.length === 3) break;
    if (!out.includes(id) && keep(id)) out.push(id);
  }
  return pick(out);
}

/**
 * On a sell card, when its "you could borrow against it instead" amount is above zero: "Or borrow X USDC
 * instead", where X is the largest amount a Mid risk borrow card accepts right now (worked out by the
 * same builder, so the card the chip leads to is not refused for the amount). Worded as an option.
 * Null when there is nothing to offer.
 */
export function borrowInsteadChip(plan: Pick<Plan, "action" | "borrowInstead"> | null | undefined): Chip | null {
  const b = plan?.action === "sell" ? plan.borrowInstead : undefined;
  if (!b || b.usdc <= 0n) return null;
  const asset = ASSETS.find((x) => x.symbol === b.asset);
  if (!asset?.borrowable) return null;
  const units = b.offer < CARD_CAP_UNITS ? b.offer : CARD_CAP_UNITS;
  if (units < 10_000n) return null; // under one cent
  const amount = usdcText(units);
  return {
    id: "borrow_instead",
    kind: "action",
    label: `Or borrow ${amount} USDC instead`,
    text: `Borrow ${amount} USDC against my ${asset.name} at mid risk instead of selling`,
  };
}
/** Error ladder: the first failure says what went wrong; later ones say it again differently and offer choices. */
export function errorStep(failuresInARow: number, message: string): { text: string; chips: Chip[] } {
  if (failuresInARow <= 1) return { text: message, chips: [] };
  return {
    text: `That did not work again (${failuresInARow} times in a row). ${message} You can pick a question below, or try again in a minute.`,
    chips: pick(["portfolio", "fees", "how_testnet"]),
  };
}
