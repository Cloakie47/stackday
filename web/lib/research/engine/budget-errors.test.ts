import { test } from "node:test";
import assert from "node:assert/strict";
import { callErrors, costBudget, describeError, guardedCall, notBilled } from "./budget.ts";
import type { ModelRequest } from "./model.ts";

const apiError = (status: number, type: string, message: string) => Object.assign(new Error(message), { status, error: { error: { type } } });

test("a failed model call keeps a short, safe reason", () => {
  const e = apiError(429, "rate_limit_error", "This request would exceed the rate limit for your organization (key sk-ant-api03-abc_DEF-123)");
  const d = describeError(e);
  assert.match(d, /^429 rate_limit_error This request would exceed/);
  assert.doesNotMatch(d, /sk-ant/, "a key is never kept");
  assert.ok(d.length <= 230);
});

test("only calls the API refused are counted as not billed", () => {
  assert.equal(notBilled(apiError(429, "rate_limit_error", "x")), true);
  assert.equal(notBilled(apiError(400, "invalid_request_error", "x")), true);
  assert.equal(notBilled(apiError(401, "authentication_error", "x")), true);
  assert.equal(notBilled(apiError(408, "timeout", "x")), false, "a timeout may have run the model");
  assert.equal(notBilled(apiError(529, "overloaded_error", "x")), false);
  assert.equal(notBilled(new Error("socket hang up")), false);
  assert.equal(notBilled(Object.assign(new Error("fetch failed"), { name: "APIConnectionError" })), true);
});

test("a refused call records its reason and spends nothing; the run lists distinct errors", async () => {
  const budget = costBudget({ maxRunUsd: 5, maxDayUsd: 10, spentTodayUsd: 0 });
  const req = { step: "weekly.analyst.technical", model: "claude-opus-5-5", system: "s", user: "u", schema: {}, maxTokens: 8000, effort: "low" } as unknown as ModelRequest;
  const fail = async () => {
    throw apiError(429, "rate_limit_error", "output tokens per minute exceeded");
  };
  assert.equal(await guardedCall(fail, req, budget), null);
  assert.equal(await guardedCall(fail, { ...req, step: "weekly.analyst.macro" }, budget), null);
  assert.equal(budget.spent, 0);
  assert.equal(budget.calls[0].error, "429 rate_limit_error output tokens per minute exceeded");
  assert.deepEqual(callErrors(budget.calls), ["model call failed (2x, weekly.analyst.technical, weekly.analyst.macro): 429 rate_limit_error output tokens per minute exceeded"]);
});
