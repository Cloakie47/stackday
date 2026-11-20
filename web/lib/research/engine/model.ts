import Anthropic from "@anthropic-ai/sdk";

/**
 * The one swappable server function that talks to a model. Everything else in the engine only sees
 * the `ModelFn` type, so a different provider or a test fake plugs in here and nowhere else.
 * Which model each step uses is chosen in one place: `RESEARCH_MODELS` in ../flags.ts.
 *
 * Server only: the SDK reads ANTHROPIC_API_KEY from the environment and it is never logged.
 * The SDK is pinned to an exact version in web/package.json.
 */

export type Effort = "low" | "medium" | "high";

export type ModelRequest = {
  /** Exact model id, for example "claude-haiku-5-5". */
  model: string;
  /** Short name of the step for logs and tests, for example "daily.triage" or "weekly.bull". */
  step: string;
  /** Frozen instructions, identical across calls of a run, sent with a cache breakpoint. */
  system: string;
  /**
   * Optional shared context (for example one asset's fact list) sent first in the user turn with a
   * second cache breakpoint, so several steps on the same asset read it from the cache.
   */
  context?: string;
  /** The step's own instructions and inputs. */
  user: string;
  /** JSON schema the answer must follow (structured outputs). The answer is still validated in code. */
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: Effort;
};

export type ModelUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelResult = {
  /** The model's text answer (expected to be JSON). Empty when it gave none or stopped early. */
  text: string;
  model: string;
  stopReason: string | null;
  usage: ModelUsage;
  costUsd: number;
};

export type ModelFn = (req: ModelRequest) => Promise<ModelResult>;

/** USD per million tokens (Anthropic list prices). Cache writes cost 1.25 x input (5 minute cache). */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export function costOf(model: string, u: ModelUsage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
}

/** Rough token count of a prompt (about 3.5 characters per token, rounded up for safety). */
export const approxTokens = (s: string) => Math.ceil(s.length / 3);

/** Highest possible cost of one call (no cache, every output token used). Reserved before the call. */
export function worstCaseCost(req: Pick<ModelRequest, "model" | "system" | "context" | "user" | "maxTokens">): number {
  const input = approxTokens(req.system) + approxTokens(req.context ?? "") + approxTokens(req.user) + 500;
  return costOf(req.model, { input, output: req.maxTokens, cacheRead: 0, cacheWrite: 0 });
}

let client: Anthropic | undefined;

/** Real implementation on the Anthropic API. Never called by tests. */
export const callModel: ModelFn = async (req) => {
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 });
  const content: Anthropic.TextBlockParam[] = [];
  if (req.context) content.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
  content.push({ type: "text", text: req.user });
  const res = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
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
  return { text: res.stop_reason === "end_turn" ? text : "", model: req.model, stopReason: res.stop_reason, usage, costUsd: costOf(req.model, usage) };
};
