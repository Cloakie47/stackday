import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "./buildCalls.ts";
import { recipientName } from "./recipient.ts";
import { ctx } from "./test-fixtures.ts";

test("gift card name: only an exact, single match with a username; otherwise the ID stands alone", () => {
  const maya = { uid: "SD-ABCDEFGH", username: "maya" };
  assert.equal(recipientName("SD-ABCDEFGH", [maya]), "@maya");
  assert.equal(recipientName("maya", [maya]), "@maya");
  assert.equal(recipientName("SD-ABCDEFGH", [{ uid: "SD-ABCDEFGH", username: null }]), null);
  assert.equal(recipientName("SD-ABCDEFGH", [{ uid: "SD-ZZZZZZZZ", username: "maya" }]), null);
  assert.equal(recipientName("maya", [{ uid: "SD-1", username: "maya_2" }]), null);
  assert.equal(recipientName("maya", [maya, { uid: "SD-2", username: "maya" }]), null);
  assert.equal(recipientName("maya", []), null);
});

test("the gift card carries the recipient it was asked for, and still has no calls", () => {
  const r = buildPlan({ action: "gift", params: { recipient_id: "SD-ABCDEFGH", usdc: "5", box: "surprise" } }, ctx());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.giftRecipient, "SD-ABCDEFGH");
  assert.equal(r.calls.length, 0);
});
