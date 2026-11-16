import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildSignInMessage, SIGN_IN_CHAIN_ID } from "../signin.ts";
import { checkSignIn, memoryNonceStore, newNonce, NONCE_RULE, NONCE_TTL_MS, type NonceStore } from "./signin-check.ts";

// Throwaway keys made fresh for each run. They never hold anything.
const alice = privateKeyToAccount(generatePrivateKey());
const mallory = privateKeyToAccount(generatePrivateKey());
const DOMAIN = "stackday-rho.vercel.app";
const verify = (p: { address: `0x${string}`; message: string; signature: `0x${string}` }) => verifyMessage(p);

async function setup(opts: { domain?: string; chainId?: number; issuedAt?: Date; signer?: typeof alice } = {}) {
  const store = memoryNonceStore();
  const now = new Date("2026-11-15T12:00:00Z");
  const nonce = newNonce();
  await store.put(nonce, new Date(now.getTime() + NONCE_TTL_MS));
  const message = buildSignInMessage({
    address: alice.address,
    domain: opts.domain ?? DOMAIN,
    uri: `https://${opts.domain ?? DOMAIN}`,
    nonce,
    issuedAt: opts.issuedAt ?? now,
    chainId: opts.chainId,
  });
  const signature = await (opts.signer ?? alice).signMessage({ message });
  const run = (o: Partial<{ message: unknown; signature: unknown; now: Date; store: NonceStore }> = {}) =>
    checkSignIn({ message, signature, domains: [DOMAIN], chainId: SIGN_IN_CHAIN_ID, now, store, verify, ...o });
  return { store, now, nonce, message, signature, run };
}

test("nonces are 32 random hex characters", () => {
  const a = newNonce();
  assert.match(a, NONCE_RULE);
  assert.notEqual(a, newNonce());
});

test("the message names the site, the chain and the nonce", async () => {
  const { message, nonce } = await setup();
  assert.match(message, new RegExp(`^${DOMAIN.replace(/\./g, "\.")} wants you to sign in`));
  assert.match(message, /Chain ID: 84532/);
  assert.match(message, new RegExp(`Nonce: ${nonce}`));
  assert.match(message, /Expiration Time: /);
});

test("a correct sign-in passes and returns the wallet in lowercase", async () => {
  const { run } = await setup();
  assert.deepEqual(await run(), { ok: true, address: alice.address.toLowerCase() });
});

test("REPLAY: sending the same signed request twice fails the second time", async () => {
  const { run } = await setup();
  assert.equal((await run()).ok, true);
  const second = await run();
  assert.equal(second.ok, false);
  assert.equal(second.ok === false && second.status, 400);
});

test("a message signed for another site is refused", async () => {
  const { run } = await setup({ domain: "stackday-phish.example" });
  const r = await run();
  assert.equal(r.ok === false && r.status, 401);
  assert.match(r.ok === false ? r.error : "", /another site/);
});

test("a message for another chain is refused", async () => {
  const { run } = await setup({ chainId: 1 });
  assert.equal((await run()).ok, false);
});

test("an expired request is refused even with an unused nonce", async () => {
  const { run, now } = await setup();
  const r = await run({ now: new Date(now.getTime() + NONCE_TTL_MS + 1) });
  assert.match(r.ok === false ? r.error : "", /expired/);
});

test("a request dated in the future is refused", async () => {
  const { run, now } = await setup({ issuedAt: new Date("2026-11-15T12:05:00Z") });
  assert.equal((await run({ now })).ok, false);
});

test("a nonce the server never issued is refused", async () => {
  const { run } = await setup();
  const r = await run({ store: memoryNonceStore() });
  assert.match(r.ok === false ? r.error : "", /already used or has expired/);
});

test("someone else's signature is refused, and it burns the nonce", async () => {
  const { run } = await setup({ signer: mallory });
  const r = await run();
  assert.equal(r.ok === false && r.status, 401);
  assert.equal((await run()).ok, false);
});

test("changing the text after signing is refused", async () => {
  const { run, message } = await setup();
  const r = await run({ message: message.replace("Sign in to Stackday", "Sign in to Stackday now") });
  assert.equal(r.ok === false && r.status, 401);
});

test("junk input is refused without touching the store", async () => {
  let touched = false;
  const store: NonceStore = {
    async put() {},
    async take() {
      touched = true;
      return true;
    },
  };
  const { run } = await setup();
  for (const bad of [{ message: 42 }, { message: "hello" }, { signature: "nope" }, { message: "x".repeat(3000) }]) {
    assert.equal((await run({ ...bad, store })).ok, false);
  }
  assert.equal(touched, false);
});
