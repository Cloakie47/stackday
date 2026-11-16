import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketKey, clientIp, limit, memoryRateLimitStore, ruleFor, type RateLimitStore } from "./rate-limit.ts";

const NOW = new Date("2026-11-15T12:00:00Z"); // on a minute boundary
const vercel = { VERCEL: "1" };
const headers = (h: Record<string, string>) => new Headers(h);

function caller(store: RateLimitStore, method: string, pathname: string, h: Record<string, string>, now = NOW) {
  return limit({ method, pathname, headers: headers(h), env: vercel, secret: "test-secret", store, now });
}

test("sign-in and name claims have the strictest limits", () => {
  assert.equal(ruleFor("POST", "/api/session")?.limit, 10);
  assert.equal(ruleFor("POST", "/api/session/nonce")?.limit, 20);
  assert.equal(ruleFor("POST", "/api/profile")?.limit, 5);
  assert.equal(ruleFor("DELETE", "/api/employees")?.name, "team-write");
  assert.equal(ruleFor("GET", "/api/profile")?.name, "read");
  assert.equal(ruleFor("POST", "/api/something-new")?.name, "write");
  assert.equal(ruleFor("POST", "/api/session/")?.name, "sign-in", "trailing slash does not dodge the rule");
  assert.equal(ruleFor("OPTIONS", "/api/session"), null);
  assert.equal(ruleFor("GET", "/dashboard"), null);
});

test("the 11th sign-in in a minute from one address is refused, with Retry-After", async () => {
  const store = memoryRateLimitStore();
  for (let i = 0; i < 10; i++) {
    assert.equal((await caller(store, "POST", "/api/session", { "x-real-ip": "203.0.113.7" })).limited, false);
  }
  const d = await caller(store, "POST", "/api/session", { "x-real-ip": "203.0.113.7" });
  assert.equal(d.limited, true);
  assert.equal(d.limited && d.retryAfter, 60);
});

test("SPOOFING: 100 quick requests with a fake X-Forwarded-For are still blocked", async () => {
  const store = memoryRateLimitStore();
  let allowed = 0;
  for (let i = 0; i < 100; i++) {
    const d = await caller(store, "POST", "/api/session", {
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": `10.0.${i}.${i}`,
      forwarded: `for=10.1.${i}.1`,
      "x-client-ip": `10.2.${i}.1`,
    });
    if (!d.limited) allowed++;
  }
  assert.equal(allowed, 10);
});

test("only the provider's header counts, and only on Vercel", () => {
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "1.2.3.4" }), vercel), "198.51.100.4");
  assert.equal(clientIp(headers({ "x-forwarded-for": "1.2.3.4" }), vercel), "vercel-unknown");
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.4" }), {}), "local", "off Vercel nothing is trusted");
  assert.equal(clientIp(headers({ "x-real-ip": "<script>" }), vercel), "vercel-unknown");
});

test("different addresses and different routes have separate allowances", async () => {
  const store = memoryRateLimitStore();
  for (let i = 0; i < 5; i++) await caller(store, "POST", "/api/profile", { "x-real-ip": "203.0.113.7" });
  assert.equal((await caller(store, "POST", "/api/profile", { "x-real-ip": "203.0.113.7" })).limited, true);
  assert.equal((await caller(store, "POST", "/api/profile", { "x-real-ip": "203.0.113.8" })).limited, false);
  assert.equal((await caller(store, "GET", "/api/profile", { "x-real-ip": "203.0.113.7" })).limited, false);
});

test("the allowance comes back in the next window", async () => {
  const store = memoryRateLimitStore();
  for (let i = 0; i < 6; i++) await caller(store, "POST", "/api/profile", { "x-real-ip": "203.0.113.7" });
  const later = new Date(NOW.getTime() + 60_000);
  assert.equal((await caller(store, "POST", "/api/profile", { "x-real-ip": "203.0.113.7" }, later)).limited, false);
});

test("addresses are stored as keyed hashes, never in the clear", () => {
  const rule = ruleFor("POST", "/api/session")!;
  const k = bucketKey(rule, "203.0.113.7", "secret-a");
  assert.match(k, /^sign-in:[0-9a-f]{32}$/);
  assert.doesNotMatch(k, /203/);
  assert.notEqual(k, bucketKey(rule, "203.0.113.7", "secret-b"));
});

test("if the counter is down, requests go through and the error is reported", async () => {
  const broken: RateLimitStore = {
    async hit() {
      throw new Error("db down");
    },
  };
  let reported = "";
  const d = await limit({
    method: "POST",
    pathname: "/api/session",
    headers: headers({ "x-real-ip": "203.0.113.7" }),
    env: vercel,
    secret: "s",
    store: broken,
    now: NOW,
    onError: (e) => (reported = String(e)),
  });
  assert.equal(d.limited, false);
  assert.match(reported, /db down/);
});
