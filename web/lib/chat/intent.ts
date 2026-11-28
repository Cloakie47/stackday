import { z } from "zod";
import deployment from "../deployment.json" with { type: "json" };

/**
 * The only things the chat model can ask for (docs/features/CHAT-AND-GIFTS.md, section 1.3).
 *
 * Read tools are answered on the server. Action intents become a confirmation card in the browser;
 * they are never a transaction by themselves. Every schema is strict: an unknown field such as
 * "to", "receiver" or "address" makes the whole intent invalid instead of being dropped silently.
 *
 * No intent carries an address. Most actions pay the connected wallet or its own vault, set in code.
 * The two that go to someone else (gift, send) name a Stackday ID or username the person typed, or
 * (send only) say "the 0x address the person typed in this message" (kind typed_address): the browser
 * reads that address from the person's own text, never from the model.
 *
 * Assets are only the symbols in web/lib/deployment.json, matched exactly (no case folding or
 * Unicode tricks), so a look-alike name or an address is refused. Before the check, amounts written
 * like "$1,000 USDC" and bare tickers like "NVDA" are normalized (normalizeAmount, normalizeAsset).
 */

/** Most test USDC one chat card may move (guardrail 5). Repay, unlock, withdraw and stop earning are exempt. */
export const CARD_CAP_USDC = 500;
export const CARD_CAP_UNITS = BigInt(CARD_CAP_USDC) * 1_000_000n;
/** Most test USDC value one send card may move to someone else. */
export const SEND_CAP_USDC = 100;
export const SEND_CAP_UNITS = BigInt(SEND_CAP_USDC) * 1_000_000n;

const SYMBOLS = (deployment as { assetSymbols: string[] }).assetSymbols;
export const ASSET_SYMBOLS = SYMBOLS as [string, ...string[]];
export const assetSchema = z.enum(ASSET_SYMBOLS);
/** USDC itself, where an action can move it as well as the assets (withdraw, send). */
export const assetOrUsdcSchema = z.union([z.literal("USDC"), assetSchema]);

/** A plain decimal number as text, up to 18 decimals. Text, not a float, so 0.1 stays 0.1. */
const decimal = z.string().regex(/^\d{1,9}(\.\d{1,18})?$/, "a plain decimal number");
/** A USDC amount: up to 6 decimals, above zero, no cap (repay and stop earning only lower risk). */
export const anyUsdcSchema = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, "a USDC amount with at most 6 decimals")
  .refine((s) => Number(s) > 0, "above zero");
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
/** Withdraw an asset, or idle USDC in the vault ("USDC"), to the connected wallet. */
export const withdrawSchema = z.strictObject({ ...assetAmount, asset: assetOrUsdcSchema });
export const borrowSchema = z.strictObject({ asset: assetSchema, usdc: usdcSchema, risk: z.enum(["low", "mid", "high"]) });
/** Lock free assets in the vault as collateral, or unlock locked ones (same amount forms as sell). */
export const lockSchema = z.strictObject(assetAmount);
export const unlockSchema = z.strictObject(assetAmount);
export const repaySchema = z.strictObject({
  /** One loan, or every loan split the way the Borrow page splits it. */
  asset: z.union([assetSchema, z.literal("every_loan")]),
  /** USDC to repay; ignored when `all` is true. Not capped: repaying only lowers risk. */
  usdc: z.union([anyUsdcSchema, z.literal("0")]),
  all: z.boolean(),
});
/** Characters of a Stackday ID after "SD-" (lib/server/backend.ts newUid: no 0, 1, I or O). */
export const UID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const UID_RE = new RegExp(`^SD-[${UID_ALPHABET}]{8}$`);
/** A Stackday profile ID (SD-XXXXXXXX) or a username (lib/signin.ts USERNAME_RULE). Never a wallet address. */
export const recipientSchema = z
  .string()
  .regex(new RegExp(`^(SD-[${UID_ALPHABET}]{8}|[a-z0-9_]{3,20})$`), "a Stackday ID or username")
  .refine((s) => !/^0x/i.test(s), "not an address");
export const GIFT_BOXES = ["one_stock", "my_mix", "surprise", "research_pick"] as const;
export const giftSchema = z.strictObject({
  recipient_id: recipientSchema,
  usdc: usdcSchema,
  box: z.enum(GIFT_BOXES),
  /** The stock in a one_stock box. */
  asset: assetSchema.optional(),
});
/** Put idle USDC to work earning interest (USDC already in the vault first, the rest from the wallet). */
export const earnSchema = z.strictObject({ usdc: usdcSchema });
/** Take earning USDC back to the connected wallet: an amount, or "all" (everything with its interest). */
export const stopEarningSchema = z.strictObject({ usdc: z.union([z.literal("all"), anyUsdcSchema]) });
/**
 * Send USDC or an asset to someone else. `to` is a Stackday ID or username the person typed, or
 * "the one 0x address the person typed in this message" (typed_address). The model never writes an
 * address: the browser reads it from the person's own text (lib/chat/recipient.ts typedAddress).
 */
export const sendToSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("id"), id: recipientSchema }),
  z.strictObject({ kind: z.literal("typed_address") }),
]);
export const sendSchema = z.strictObject({
  to: sendToSchema,
  asset: assetOrUsdcSchema,
  amount: decimal,
  unit: z.enum(["tokens", "usdc"]),
  from: z.enum(["wallet", "vault"]),
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
  earn: earnSchema,
  stop_earning: stopEarningSchema,
  send: sendSchema,
} as const;
export type ActionName = keyof typeof ACTION_SCHEMAS;
export const ACTION_NAMES = Object.keys(ACTION_SCHEMAS) as ActionName[];

export type Intent = { [K in ActionName]: { action: K; params: z.infer<(typeof ACTION_SCHEMAS)[K]> } }[ActionName];

/**
 * What went wrong, safe to send back to the model: the field path (schema names only) and zod's issue
 * code. Never the input itself, so an injected address or instruction is not echoed.
 */
export type SafeIssue = { path: string; code: string };
export type ParseResult = { ok: true; intent: Intent } | { ok: false; error: string; issues: SafeIssue[] };

/** An amount the way people and models write it: "$1,000.50 USDC" -> "1000.50". Anything else is left alone. */
export function normalizeAmount(v: unknown): unknown {
  if (typeof v !== "string") return v;
  return v
    .trim()
    .replace(/\s*usdc$/i, "")
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/,/g, "");
}

/**
 * A bare ticker to the app symbol: "NVDA" or "aapl" -> "mNVDA" / "mAAPL", only when exactly one such
 * symbol exists. ASCII letters only, so look-alike characters are never mapped.
 */
export function normalizeAsset(v: unknown): unknown {
  if (typeof v !== "string" || v === "USDC" || (ASSET_SYMBOLS as readonly string[]).includes(v) || !/^[A-Za-z]{2,8}$/.test(v)) return v;
  const hits = ASSET_SYMBOLS.filter((s) => s.startsWith("m") && s.slice(1).toLowerCase() === v.toLowerCase());
  return hits.length === 1 ? hits[0] : v;
}

function normalize(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const k of ["usdc", "amount"]) if (k in out) out[k] = normalizeAmount(out[k]);
  if ("asset" in out) out.asset = normalizeAsset(out.asset);
  return out;
}

const SAFE_SEGMENT = /^([a-z_]{1,24}|\d{1,3})$/;

/** Validates one action the model asked for. Formatting is normalized first; anything outside the schema is refused. */
export function parseAction(name: string, input: unknown): ParseResult {
  if (!(ACTION_NAMES as string[]).includes(name))
    return { ok: false, error: `unknown action ${JSON.stringify(name).slice(0, 40)}`, issues: [{ path: "action", code: "unknown_action" }] };
  const schema = ACTION_SCHEMAS[name as ActionName];
  const r = schema.safeParse(normalize(input));
  if (!r.success) {
    const issues = r.error.issues.slice(0, 6).map((i) => ({
      path: i.path.map(String).filter((p) => SAFE_SEGMENT.test(p)).join(".") || "input",
      code: SAFE_SEGMENT.test(i.code) ? i.code : "invalid",
    }));
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ").slice(0, 300), issues };
  }
  return { ok: true, intent: { action: name, params: r.data } as Intent };
}

/** Checks an intent received from the network (the browser side of the same rule). */
export function parseIntent(raw: unknown): ParseResult {
  const bad = (error: string): ParseResult => ({ ok: false, error, issues: [{ path: "input", code: "invalid" }] });
  if (!raw || typeof raw !== "object") return bad("no intent");
  const o = raw as { action?: unknown; params?: unknown };
  if (Object.keys(o).some((k) => k !== "action" && k !== "params")) return bad("unexpected field");
  return typeof o.action === "string" ? parseAction(o.action, o.params) : bad("no action");
}
