import Anthropic from "@anthropic-ai/sdk";

/**
 * The one swappable server function that talks to a model (founder rule, PR #3: "Haiku triage +
 * Sonnet escalation behind one swappable server function"). Everything else in the engine only
 * sees the `ModelFn` type, so a different provider or a test fake plugs in here and nowhere else.
 *
 * Server only: reads ANTHROPIC_API_KEY from the environment through the SDK and never logs it.
 * The SDK is pinned to an exact version in web/package.json.
 */

export const MODELS = {
  /** Reads every asset every run. */
  triage: "claude-haiku-5-5",
  /** Re-reads only material cases (see `needsEscalation` in run.ts). */
  escalate: "claude-sonnet-5-5",
} as const;

export type ModelTier = keyof typeof MODELS;

export type ModelRequest = {
  tier: ModelTier;
  /** Stable instructions. Sent with a cache breakpoint so repeated calls in a run read it from cache. */
  system: string;
  /** Per-asset content (facts, untrusted news inside a marked block). */
  user: string;
  /** JSON schema the answer must follow (structured outputs). The answer is still validated in code. */
  schema: Record<string, unknown>;
  maxTokens: number;
};

export type ModelUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelResult = {
  /** The model's text answer (expected to be JSON). Empty when it gave none. */
  text: string;
  model: string;
  stopReason: string | null;
  usage: ModelUsage;
  costUsd: number;
};

export type ModelFn = (req: ModelRequest) => Promise<ModelResult>;

/** USD per million tokens. Cache writes cost 1.25 x input (5 minute cache). */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
};

export function costOf(model: string, u: ModelUsage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
}

/** Highest possible cost of one call, used by the cost guard before the call is made. */
export function worstCaseCost(tier: ModelTier, inputTokens: number, maxTokens: number): number {
  return costOf(MODELS[tier], { input: inputTokens, output: maxTokens, cacheRead: 0, cacheWrite: 0 });
}

let client: Anthropic | undefined;

/** Real implementation on the Anthropic API. */
export const callModel: ModelFn = async (req) => {
  client ??= new Anthropic({ timeout: 90_000, maxRetries: 2 });
  const model = MODELS[req.tier];
  const res = await client.messages.create({
    model,
    max_tokens: req.maxTokens,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: req.user }],
    output_config: {
      // Triage stays cheap; the escalation pass gets more room to think.
      effort: req.tier === "triage" ? "low" : "medium",
      format: { type: "json_schema", schema: req.schema },
    },
  });
  const usage: ModelUsage = {
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
  };
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text: res.stop_reason === "end_turn" ? text : "", model, stopReason: res.stop_reason, usage, costUsd: costOf(model, usage) };
};
