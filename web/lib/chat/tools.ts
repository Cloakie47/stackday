import { ASSETS, BORROW_FEE_BPS, EARN_FEE_BPS, SIP_FEE_BPS } from "../contracts.ts";
import { fmtPct } from "../format.ts";
import { ASSET_SYMBOLS, CARD_CAP_USDC, type ActionName } from "./intent.ts";

/**
 * Tool definitions sent to the model (JSON Schema, strict). They mirror the zod schemas in
 * intent.ts, which are what actually decide: the API's strict mode is a first filter, never the check.
 */

type JsonSchema = Record<string, unknown>;
export type ToolDef = { name: string; description: string; strict: true; input_schema: JsonSchema };

const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const asset = { type: "string", enum: ASSET_SYMBOLS, description: "Asset symbol from the list in the instructions." };
const usdc = { type: "string", description: `USDC amount as a plain decimal, for example "20" or "12.5". At most ${CARD_CAP_USDC}.` };
const assetAmount = obj({
  asset,
  amount: { type: "string", description: 'A plain decimal: "50" with unit percent means half of what is free in the vault.' },
  unit: { type: "string", enum: ["percent", "tokens", "usdc"] },
});

export const READ_TOOL_NAMES = ["get_portfolio", "get_loan", "get_prices", "get_weekly_view", "explain"] as const;
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export const EXPLAIN_TOPICS = ["fees", "borrowing", "selling", "recurring_buys", "vault", "testnet", "gifts"] as const;
export type ExplainTopic = (typeof EXPLAIN_TOPICS)[number];

export const READ_TOOLS: ToolDef[] = [
  { name: "get_portfolio", description: "The person's own balances: wallet USDC, each asset in their vault (free and locked) with its value, loans, health and recurring plans. Read only.", strict: true, input_schema: obj({}) },
  { name: "get_loan", description: "One loan: amount owed, Stackday fee owed, health, borrow limit use, the price fall it survives and the liquidation price. Read only.", strict: true, input_schema: obj({ asset }) },
  { name: "get_prices", description: "Current test prices of up to 6 assets (mock price feeds on Base Sepolia). Read only.", strict: true, input_schema: obj({ assets: { type: "array", items: asset } }) },
  {
    name: "get_weekly_view",
    description: 'The general view from the latest APPROVED Stackday weekly research report, with its date. asset "all" gives the view on every researched asset. General research, not personal advice.',
    strict: true,
    input_schema: obj({ asset: { type: "string", enum: [...ASSET_SYMBOLS, "all"] } }),
  },
  { name: "explain", description: "Stackday's own explanation of a topic (fees, how borrowing works, and so on).", strict: true, input_schema: obj({ topic: { type: "string", enum: EXPLAIN_TOPICS } }) },
];

export const ACTION_TOOLS: (ToolDef & { name: ActionName })[] = [
  { name: "buy", description: "Prepare a one-time buy of an asset with USDC from the person's wallet into their own vault. No fee.", strict: true, input_schema: obj({ asset, usdc }) },
  {
    name: "recurring_buy",
    description: `Prepare a recurring buy plan from the person's wallet. ${fmtPct(SIP_FEE_BPS)} fee on each buy. The whole plan (amount x buys) must be at most ${CARD_CAP_USDC} USDC.`,
    strict: true,
    input_schema: obj({ asset, usdc: { ...usdc, description: "USDC per buy." }, every: { type: "string", enum: ["weekly", "every_2_weeks", "every_4_weeks"] }, weeks: { type: "integer", enum: [4, 12, 26, 52] } }),
  },
  { name: "cancel_plan", description: "Prepare cancelling the person's recurring plan for one asset.", strict: true, input_schema: obj({ asset }) },
  { name: "sell", description: "Prepare selling an asset from the person's vault for USDC to their own wallet (testnet mock sell desk).", strict: true, input_schema: assetAmount },
  { name: "withdraw", description: "Prepare taking an asset out of the person's vault to their own connected wallet.", strict: true, input_schema: assetAmount },
  {
    name: "borrow",
    description: "Prepare borrowing USDC against one asset in the person's vault (locking more of it if needed). risk is the person's chosen level: low, mid or high. Use mid only if they did not say.",
    strict: true,
    input_schema: obj({ asset, usdc, risk: { type: "string", enum: ["low", "mid", "high"] } }),
  },
  {
    name: "repay",
    description: 'Prepare repaying a loan from the person\'s wallet. asset "every_loan" repays across all loans. all=true repays everything owed (then usdc is "0").',
    strict: true,
    input_schema: obj({ asset: { type: "string", enum: [...ASSET_SYMBOLS, "every_loan"] }, usdc: { type: "string", description: 'USDC to repay, or "0" when all is true.' }, all: { type: "boolean" } }),
  },
  {
    name: "gift",
    description: "Prepare a stock gift box for another Stackday user, named by their Stackday ID (SD-XXXXXXXX) or username. Never an address.",
    strict: true,
    input_schema: obj({ recipient_id: { type: "string" }, usdc, box: { type: "string", enum: ["one_stock", "my_mix", "surprise", "research_pick"] } }),
  },
];

export const ALL_TOOLS: ToolDef[] = [...READ_TOOLS, ...ACTION_TOOLS];
export const isActionTool = (name: string) => ACTION_TOOLS.some((t) => t.name === name);

/** The asset list for the instructions: symbols and names only, never token addresses. */
export const ASSET_LIST = ASSETS.map((a) => `${a.symbol} = ${a.name} (${a.kind}${a.borrowable ? ", can borrow against it" : ", invest only"}, ${a.decimals} decimals)`).join("\n");

const fee = (bps: bigint) => fmtPct(bps);

/** Stackday's own wording, from the fee rules in CLAUDE.md and README.md. Trusted text. */
export const EXPLANATIONS: Record<ExplainTopic, string> = {
  fees: [
    "Stackday charges three small fees, each fixed when the contracts were deployed and capped in code at 0.2%. Nobody can change them.",
    `1. Recurring buys: ${fee(SIP_FEE_BPS)} of the USDC each recurring buy or payday share puts into an asset. One-time buys are free.`,
    `2. Borrowing: ${fee(BORROW_FEE_BPS)} a year on the amount you owe, built up by the second and paid when you repay, before the loan. You receive the full amount you borrow. If a loan is liquidated, the unpaid fee is dropped.`,
    `3. Earning interest on idle USDC: ${fee(EARN_FEE_BPS)} a year of the amount earning, taken only out of the interest.`,
    "Stackday never charges salary paid out and never takes money from a vault or from collateral. The lending market charges its own variable interest on loans.",
  ].join("\n"),
  borrowing: [
    "You borrow USDC against assets in your own vault through an existing Morpho market; Stackday is not a lender.",
    "You lock some of an asset as collateral, then borrow. Health is the liquidation limit divided by what you owe: 1.00 is the liquidation line, higher is safer.",
    "Risk levels: low borrows up to 30% of the liquidation limit (survives about a 70% price fall), mid up to 50%, high up to 65%. Your vault's own safety cap is 50% unless you raise it.",
    "If prices fall far enough, part of the collateral can be sold to repay the loan. Repaying is manual and there is no forced repayment.",
    "Borrowing instead of selling keeps your position. Every payday share can add more collateral, so a loan can get safer over time.",
  ].join("\n"),
  selling: "On testnet, selling uses a MOCK sell desk: it takes the asset out of your vault to your wallet, then buys it for test USDC at the mock price minus a small spread. On mainnet this would go through a real exchange route. You could borrow against an asset instead of selling it.",
  recurring_buys: `A recurring buy takes the same USDC amount from your wallet on a schedule (weekly, every 2 or 4 weeks, at 11:00 New York time) and buys into your vault. ${fee(SIP_FEE_BPS)} fee on each buy. It stops after the approved number of buys, or when you cancel it.`,
  vault: "Every person has one vault contract that only they control. No admin can move money out of it. Buys land there as free (not locked) assets; you lock them yourself if you want to borrow.",
  testnet: "Stackday runs on Base Sepolia testnet with test USDC and mock tokens that stand in for Coinbase tokenized stocks, gold, Bitcoin and Ether. Prices are mock feeds. Nothing here is real money.",
  gifts: "A gift box holds the sender's test USDC until the recipient opens it, then buys one stock, a chosen mix, a surprise mix or a research pick into the recipient's own vault. Gifts are sent from the Gifts page.",
};
