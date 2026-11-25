import { ASSETS } from "../contracts.ts";
import type { Intent } from "./intent.ts";

/**
 * The sentence shown above a card. Written here in code from the validated intent; the model's own
 * text for a card turn is never shown, so the model never carries numbers next to a card. It stays
 * true whatever the card turns out to be (ready, refused, blocked by the pre-check, or a hand-off),
 * and holds no amounts and no addresses because it is kept in the history sent back to the model.
 */

const nameOf = (symbol: string) => ASSETS.find((a) => a.symbol === symbol)?.name ?? "that asset";
const RISK = { low: "Low", mid: "Mid", high: "High" } as const;
const CHECK = "Check the numbers on the card. Nothing happens until you confirm in your wallet.";

export function leadIn(intent: Intent): string {
  switch (intent.action) {
    case "buy":
      return `Here is a card to buy ${nameOf(intent.params.asset)}. ${CHECK}`;
    case "recurring_buy":
      return `Here is a card to set up a recurring buy of ${nameOf(intent.params.asset)}. ${CHECK}`;
    case "cancel_plan":
      return `Here is a card to stop your ${nameOf(intent.params.asset)} plan. ${CHECK}`;
    case "sell":
      return `Here is a card to sell ${nameOf(intent.params.asset)}. ${CHECK}`;
    case "withdraw":
      return `Here is a card to take ${nameOf(intent.params.asset)} out of your vault to your wallet. ${CHECK}`;
    case "borrow":
      return `Here is a card to borrow against your ${nameOf(intent.params.asset)} at ${RISK[intent.params.risk]} risk. ${CHECK}`;
    case "repay":
      return `Here is a card to repay ${intent.params.asset === "every_loan" ? "your loans" : `your ${nameOf(intent.params.asset)} loan`}. ${CHECK}`;
    case "lock":
      return `Here is a card to lock ${nameOf(intent.params.asset)} in your vault as collateral for borrowing. ${CHECK}`;
    case "unlock":
      return `Here is a card to unlock ${nameOf(intent.params.asset)} in your vault, so it is free again. ${CHECK}`;
    case "gift":
      return "Here is the gift box. Gifts are sent from the Gifts page, and the card links there.";
  }
}
