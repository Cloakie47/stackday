import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshAll } from "./refresh.ts";

test("refreshAll waits for a refresh that finishes", async () => {
  let called = 0;
  const r = await refreshAll({ invalidateQueries: async () => void called++ }, 1000);
  assert.equal(r, "done");
  assert.equal(called, 1);
});

test("refreshAll moves on when a refresh never finishes (the Saving... hang)", async () => {
  const started = Date.now();
  const r = await refreshAll({ invalidateQueries: () => new Promise<void>(() => {}) }, 30);
  assert.equal(r, "timeout");
  assert.ok(Date.now() - started < 1000);
});

test("refreshAll never throws when the refresh fails", async () => {
  const r = await refreshAll({ invalidateQueries: () => Promise.reject(new Error("rpc down")) }, 1000);
  assert.equal(r, "done");
});
