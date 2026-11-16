import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, originOf, securityHeaders } from "./security-headers.ts";
import nextConfig from "../next.config.ts";

const prod = { isDev: false, rpcUrl: "https://sepolia.base.org" };
const get = (headers: { key: string; value: string }[], key: string) => headers.find((h) => h.key === key)?.value;

test("production headers block framing, sniffing and outside scripts", () => {
  const h = securityHeaders(prod);
  const csp = get(h, "Content-Security-Policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'(;|$)/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.equal(get(h, "X-Frame-Options"), "DENY");
  assert.equal(get(h, "X-Content-Type-Options"), "nosniff");
  assert.equal(get(h, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.ok(get(h, "Strict-Transport-Security"));
});

test("the browser may reach the chain RPC, including a custom one", () => {
  assert.match(contentSecurityPolicy(prod), /connect-src 'self' https:\/\/sepolia\.base\.org https:\/\/stabletrust-backend-api\.fairblock\.network(;|$)/);
  const custom = contentSecurityPolicy({ isDev: false, rpcUrl: "https://rpc.example.org/v1/abc?key=1" });
  assert.match(custom, /connect-src 'self' https:\/\/sepolia\.base\.org https:\/\/stabletrust-backend-api\.fairblock\.network https:\/\/rpc\.example\.org;/);
  // A key in the RPC path or query never ends up in the header.
  assert.doesNotMatch(custom, /abc|key=1/);
});

test("a bad RPC value is ignored instead of breaking the header", () => {
  const csp = contentSecurityPolicy({ isDev: false, rpcUrl: "javascript:alert(1)" });
  assert.doesNotMatch(csp, /javascript/);
  assert.equal(originOf("not a url"), null);
});

test("development allows hot reload, production does not", () => {
  const dev = securityHeaders({ isDev: true, rpcUrl: "http://127.0.0.1:8545" });
  const csp = get(dev, "Content-Security-Policy") ?? "";
  assert.match(csp, /'unsafe-eval'/);
  assert.match(csp, /http:\/\/127\.0\.0\.1:8545/);
  assert.match(csp, /ws:\/\/localhost:\*/);
  assert.equal(get(dev, "Strict-Transport-Security"), undefined);
});

test("next.config.ts sends the headers on every route", async () => {
  assert.ok(nextConfig.headers, "next.config.ts has a headers() block");
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*");
  assert.ok(all, "one rule covers every path");
  const keys = all.headers.map((h) => h.key);
  for (const k of ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]) {
    assert.ok(keys.includes(k), `${k} is set`);
  }
});
