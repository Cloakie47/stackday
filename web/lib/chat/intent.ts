import { z } from "zod";
import deployment from "../deployment.json" with { type: "json" };

/**
 * The only things the chat model can ask for (docs/features/CHAT-AND-GIFTS.md, section 1.3).
 *
 * Read tools are answered on the server. Action intents become a confirmation card in the browser;
 * they are never a transaction by themselves. Every schema is strict: an unknown field such as
 * "to", "receiver" or "address" makes the whole intent invalid instead of being dropped silently.
 * No intent has a receiver: the receiver is always the connected wallet, set in code.
 *
 * Assets are only the symbols in web/lib/deployment.json, matched exactly (no case folding or
 * Unicode tricks), so a look-alike name or an address is refused.
 */

/** Most test USDC one chat card may move (guardrail 5). */
export const CARD_CAP_USDC = 500;
export const CARD_CAP_UNITS = BigInt(CARD_CAP_USDC) * 1_000_000n;

const SYMBOLS = (deployment as { assetSymbols: string[] }).assetSymbols;
export const ASSET_SYMBOLS = SYMBOLS as [string, ...string[]];
export const assetSchema = z.enum(ASSET_SYMBOLS);

/** A plain decimal number as text, up to 6 decimals. Text, not a float, so 0.1 stays 0.1. */
const decimal = z.string().regex(/^\d{1,9}(\.\d{1,18})?$/, "a plain decimal number");
/** A USDC amount: up to 6 decimals, above zero, at most the card cap. */
export const usdcSchema = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,6})?$/, "a USDC amount with at most 6 decimals")
  .refine((s) => Number(s) > 0, "above zero")
  .refine((s) => Number(s) <= CARD_CAP_USDC, `at most ${CARD_CAP_USDC} test USDC per card`);

export const buySchema = z.strictObject({ asset: assetSchema, usdc: usdcSchema });
export const recurringBuySchema = z.strictObject({
  asset: assetSchema,
  usdc: usdcSchema,
  every: z.enum(["weekly", "every_2_weeks", "every_4_weeks"]),
  weeks: z.union([z.literal(4), z.literal(12), z.literal(26), z.literal(52)]),
});
export const cancelPlanSchema = z.strictObject({ asset: assetSchema });
/** Amount of an asset: a percent of what is free in the vault, a number of tokens, or a USDC value. */
const assetAmount = { asset: assetSchema, amount: decimal, unit: z.enum(["percent", "tokens", "usdc"]) };
export const sellSchema = z.strictObject(assetAmount);
export const withdrawSchema = z.strictObject(assetAmount);
export const borrowSchema = z.strictObject({ asset: assetSchema, usdc: usdcSchema, risk: z.enum(["low", "mid", "high"]) });
/** Lock free assets in the vault as collateral, or unlock locked ones (same amount forms as sell). */
export const lockSchema = z.strictObject(assetAmount);
export const unlockSchema = z.strictObject(assetAmount);
export const repaySchema = z.strictObject({
  /** One loan, or every loan split the way the Borrow page splits it. */
  asset: z.union([assetSchema, z.literal("every_loan")]),
  /** USDC to repay; ignored when `all` is true. */
  usdc: z.union([usdcSchema, z.literal("0")]),
  all: z.boolean(),
});
/** A Stackday profile ID (SD-XXXXXXXX) or a username. Never a wallet address. */
export const recipientSchema = z
  .string()
  .regex(/^(SD-[A-Z0-9]{8}|[a-z0-9_]{3,20})$/, "a Stackday ID or username")
  .refine((s) => !/^0x/i.test(s), "not an address");
export const giftSchema = z.strictObject({
  recipient_id: recipientSchema,
  usdc: usdcSchema,
  box: z.enum(["one_stock", "my_mix", "surprise", "research_pick"]),
});

export const ACTION_SCHEMAS = {
  buy: buySchema,
  recurring_buy: recurringBuySchema,
  cancel_plan: cancelPlanSchema,
  sell: sellSchema,
  withdraw: withdrawSchema,
  borrow: borrowSchema,
  repay: repaySchema,
  lock: lockSchema,
  unlock: unlockSchema,
  gift: giftSchema,
} as const;
export type ActionName = keyof typeof ACTION_SCHEMAS;
export const ACTION_NAMES = Object.keys(ACTION_SCHEMAS) as ActionName[];

export type Intent = { [K in ActionName]: { action: K; params: z.infer<(typeof ACTION_SCHEMAS)[K]> } }[ActionName];

export type ParseResult = { ok: true; intent: Intent } | { ok: false; error: string };

/** Validates one action the model asked for. Anything outside the schema is refused, never repaired. */
export function parseAction(name: string, input: unknown): ParseResult {
  if (!(ACTION_NAMES as string[]).includes(name)) return { ok: false, error: `unknown action ${JSON.stringify(name).slice(0, 40)}` };
  const schema = ACTION_SCHEMAS[name as ActionName];
  const r = schema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ").slice(0, 300) };
  return { ok: true, intent: { action: name, params: r.data } as Intent };
}

/** Checks an intent received from the network (the browser side of the same rule). */
export function parseIntent(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "no intent" };
  const o = raw as { action?: unknown; params?: unknown };
  if (Object.keys(o).some((k) => k !== "action" && k !== "params")) return { ok: false, error: "unexpected field" };
  return typeof o.action === "string" ? parseAction(o.action, o.params) : { ok: false, error: "no action" };
}
