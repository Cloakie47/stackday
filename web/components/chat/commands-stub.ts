/**
 * TEMPORARY stand-in for the command engine (web/lib/chat/commands.ts and info.ts), built in parallel.
 * Same types and function signatures as the engine contract. Delete this file once the engine lands
 * and switch every import marked `ENGINE:` to the real module.
 */
import type { Intent } from "@/lib/chat/intent";
import type { Chip } from "@/lib/chat/chips";
import { ASSETS } from "@/lib/contracts";

export type Need = "amount" | "asset" | "recipient";
export type Draft = { command: string; asset?: string; partial: string };
export type CommandMeta = { name: string; aliases: string[]; usage: string; description: string; example: string };
export type AssetSuggestion = { symbol: string; ticker: string; name: string; held: string | null; borrowable: boolean; icon: string };
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
  | { kind: "intent"; intent: Intent }
  | { kind: "info"; view: InfoView }
  | { kind: "ask"; draft: Draft; need: Need; question: string; chips: Chip[] }
  | { kind: "error"; message: string }
  | null;
export type CommandContext = { held: string[]; info?: unknown };

export const COMMANDS: CommandMeta[] = [
  { name: "buy", aliases: ["invest"], usage: "/buy $TICKER amount", description: "Buy a stock or token with USDC", example: "/buy $AAPL 20$" },
  { name: "sell", aliases: [], usage: "/sell $TICKER amount", description: "Sell part of a holding for USDC", example: "/sell $NVDA 10$" },
  { name: "send", aliases: ["pay"], usage: "/send USDC amount to SD-ID", description: "Send USDC to a Stackday ID or address", example: "/send USDC 5$ to SD-" },
  { name: "lend", aliases: ["earn"], usage: "/lend amount", description: "Earn interest on idle USDC", example: "/lend 10$" },
  { name: "unlend", aliases: ["stop"], usage: "/unlend amount", description: "Stop earning and get USDC back", example: "/unlend all" },
  { name: "borrow", aliases: [], usage: "/borrow $TICKER amount", description: "Borrow USDC against a holding", example: "/borrow $NVDA" },
  { name: "repay", aliases: [], usage: "/repay $TICKER amount", description: "Repay a loan", example: "/repay $NVDA all" },
  { name: "lock", aliases: [], usage: "/lock $TICKER amount", description: "Lock a holding as collateral", example: "/lock $AAPL all" },
  { name: "unlock", aliases: [], usage: "/unlock $TICKER amount", description: "Unlock collateral you no longer need", example: "/unlock $AAPL all" },
  { name: "withdraw", aliases: [], usage: "/withdraw $TICKER amount", description: "Move a holding to your wallet", example: "/withdraw USDC 10$" },
  { name: "gift", aliases: [], usage: "/gift amount to SD-ID", description: "Send a stock gift box", example: "/gift 10$ to SD-" },
  { name: "balance", aliases: ["bal"], usage: "/balance", description: "Your USDC in wallet, vault and earning", example: "/balance" },
  { name: "positions", aliases: ["pos"], usage: "/positions", description: "Your holdings and loans", example: "/positions" },
  { name: "help", aliases: ["?"], usage: "/help", description: "List every command", example: "/help" },
];

export function parseCommand(text: string, ctx: CommandContext): CommandResult {
  void ctx;
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const word = t.slice(1).split(/\s+/)[0].toLowerCase();
  const cmd = COMMANDS.find((c) => c.name === word || c.aliases.includes(word));
  if (!cmd) return { kind: "error", message: `There is no /${word} command.` };
  if (cmd.name === "help") return { kind: "info", view: { kind: "help", commands: COMMANDS } };
  return { kind: "error", message: `/${cmd.name} is not ready yet in this preview.` };
}

export function completeDraft(draft: Draft, text: string, ctx: CommandContext): CommandResult {
  void draft;
  void text;
  void ctx;
  return null;
}

export function suggestAssets(query: string, ctx: { positions: unknown[]; filter?: "all" | "borrowable" | "held" | "send" }): AssetSuggestion[] {
  const q = query.toLowerCase();
  return ASSETS.filter((a) => (ctx.filter === "borrowable" ? a.borrowable : true))
    .map((a) => ({ symbol: a.symbol, ticker: a.symbol.replace(/^m/, ""), name: a.name, held: null, borrowable: a.borrowable, icon: a.icon }))
    .filter((s) => s.ticker.toLowerCase().startsWith(q) || s.name.toLowerCase().startsWith(q))
    .slice(0, 4);
}

/** Stand-in for infoContext(p, me) from @/lib/chat/info. */
export function infoContext(p: unknown, me: unknown): unknown {
  void p;
  void me;
  return undefined;
}
