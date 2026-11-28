import type { PositionLike } from "./buildCalls.ts";
import type { Chip } from "./chips.ts";
import type { InfoContext } from "./info.ts";
import type { Intent } from "./intent.ts";

/** Frozen shared types for slash commands and $ tickers (the chat UI codes against these). */

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
  | { kind: "intent"; intent: Intent; text?: string }
  | { kind: "info"; view: InfoView }
  | { kind: "ask"; draft: Draft; need: Need; question: string; chips: Chip[] }
  | { kind: "error"; message: string }
  | null; // not a command: send to the model as usual
export type CommandContext = { held: string[] /* app symbols the person holds */; info?: InfoContext };

export const COMMANDS: CommandMeta[] = [];
export function parseCommand(text: string, ctx: CommandContext): CommandResult {
  void text;
  void ctx;
  throw new Error("not implemented yet");
}
export function completeDraft(draft: Draft, text: string, ctx: CommandContext): CommandResult {
  void draft;
  void text;
  void ctx;
  throw new Error("not implemented yet");
}
export function suggestAssets(query: string, ctx: { positions: PositionLike[]; filter?: "all" | "borrowable" | "held" | "send" }): AssetSuggestion[] {
  void query;
  void ctx;
  throw new Error("not implemented yet");
}
export function tickerOf(symbol: string): string {
  return symbol.replace(/^m/, "");
}
export function symbolOfTicker(t: string): string | null {
  void t;
  throw new Error("not implemented yet");
}
