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
  /**
   * Wall-clock limit for this call including the one retry, in ms. Set by `guardedCall` from the
   * run's time limit so a slow model can never push a route past its Vercel limit.
   */
  timeoutMs?: number;
};

export type ModelUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelResult = {
  /** The model's text answer (expected to be JSON). Empty when it gave none or stopped early. */
  text: string;
  /** Everything the model wrote, even when it stopped early. Logged with the run for reproducibility. */
  raw?: string;
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

/**
 * Conservative token count of a prompt: 2 characters per token. English is usually 3.5 to 4, but
 * numbers, ids and JSON tokenize much worse, and the reservation must never undershoot.
 */
export const approxTokens = (s: string) => Math.ceil(s.length / 2);

/**
 * Highest possible cost of one call, reserved before the call: every input token billed as a cache
 * write (1.25 x input, because system and context carry cache breakpoints) and every output token
 * used (thinking counts as output).
 */
export function worstCaseCost(req: Pick<ModelRequest, "model" | "system" | "context" | "user" | "maxTokens">): number {
  const input = approxTokens(req.system) + approxTokens(req.context ?? "") + approxTokens(req.user) + 500;
  return costOf(req.model, { input: 0, output: req.maxTokens, cacheRead: 0, cacheWrite: input });
}

/** Default wall-clock limit of one call when the caller sets none. */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/**
 * Smallest max_tokens any step may use. Thinking is adaptive and always on for these models (effort
 * only sets how much), and thinking tokens count toward max_tokens. A step that runs out returns no
 * answer but is still billed, so every step leaves room for thinking plus its JSON answer.
 */
export const MIN_MAX_TOKENS = 8000;

let client: Anthropic | undefined;

/** Real implementation on the Anthropic API. Never called by tests. */
export const callModel: ModelFn = async (req) => {
  client ??= new Anthropic();
  // One retry at most, each attempt half the limit, so the call never runs past `timeoutMs`
  // (plus the SDK's short retry back-off).
  const limit = req.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const maxRetries = limit >= 60_000 ? 1 : 0;
  const content: Anthropic.TextBlockParam[] = [];
  if (req.context) content.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
  content.push({ type: "text", text: req.user });
  const res = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
  }, { timeout: Math.floor(limit / (maxRetries + 1)), maxRetries });
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
  return { text: res.stop_reason === "end_turn" ? text : "", raw: text, model: req.model, stopReason: res.stop_reason, usage, costUsd: costOf(req.model, usage) };
};
