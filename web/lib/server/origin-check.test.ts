import { test } from "node:test";
import assert from "node:assert/strict";
import { originAllowed } from "./origin-check.ts";

const host = "stackday-rho.vercel.app";

test("reads are always allowed", () => {
  assert.equal(originAllowed({ method: "GET", origin: "https://evil.example", host }), true);
  assert.equal(originAllowed({ method: "head", origin: "https://evil.example", host }), true);
});

test("changes from our own site are allowed", () => {
  assert.equal(originAllowed({ method: "POST", origin: `https://${host}`, host }), true);
  assert.equal(originAllowed({ method: "DELETE", origin: "http://localhost:3000", host: "localhost:3000" }), true);
  assert.equal(originAllowed({ method: "POST", origin: `https://STACKDAY-RHO.vercel.app`, host }), true);
});

test("changes from another site are refused", () => {
  assert.equal(originAllowed({ method: "POST", origin: "https://evil.example", host }), false);
  assert.equal(originAllowed({ method: "DELETE", origin: `https://${host}.evil.example`, host }), false);
  assert.equal(originAllowed({ method: "POST", origin: "http://localhost:3001", host: "localhost:3000" }), false);
});

test("a null or broken origin is refused, a missing one is allowed", () => {
  assert.equal(originAllowed({ method: "POST", origin: "null", host }), false);
  assert.equal(originAllowed({ method: "POST", origin: "not a url", host }), false);
  assert.equal(originAllowed({ method: "POST", origin: null, host }), true);
});
