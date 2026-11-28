import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "./buildCalls.ts";
import { confirmSuffixOf, hasTypedAddress, pickRecipient, recipientInText, recipientName, typedAddress } from "./recipient.ts";
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

test("the gift card carries the recipient it was asked for", () => {
  const maria = "0x7777777777777777777777777777777777777777" as const;
  const r = buildPlan(
    { action: "gift", params: { recipient_id: "SD-ABCDEFGH", usdc: "5", box: "one_stock", asset: "mAAPL" } },
    ctx({ recipient: { ok: true, typed: false, wallet: maria, uid: "SD-ABCDEFGH", username: "maria" } }),
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.giftRecipient, "SD-ABCDEFGH");
  assert.deepEqual(r.destination, { kind: "recipient", address: maria, name: "@maria", id: "SD-ABCDEFGH" });
});

test("recipientInText: the ID or username must be in the person's own message as a whole word", () => {
  assert.equal(recipientInText("SD-7KQ2M9XA", "send 5 USDC to SD-7KQ2M9XA please"), true);
  assert.equal(recipientInText("SD-7KQ2M9XA", "send 5 to sd-7kq2m9xa"), true);
  assert.equal(recipientInText("maria", "gift @maria 10 USDC"), true);
  assert.equal(recipientInText("maria", "gift maria."), true);
  assert.equal(recipientInText("maria", "gift mariana 10"), false);
  assert.equal(recipientInText("maria", "gift my friend 10"), false);
  assert.equal(recipientInText("SD-7KQ2M9XA", "SD-7KQ2M9XAB"), false);
  assert.equal(recipientInText("", "anything"), false);
});

test("pickRecipient: exactly one exact match, never the person themselves", () => {
  const me = "0x1111111111111111111111111111111111111111";
  const maria = { wallet: "0x7777777777777777777777777777777777777777", uid: "SD-7KQ2M9XA", username: "maria" };
  const mariana = { wallet: "0x8888888888888888888888888888888888888888", uid: "SD-8KQ2M9XA", username: "mariana" };
  const r = pickRecipient("maria", [maria, mariana], me);
  assert.ok(r.ok && r.person.wallet.toLowerCase() === maria.wallet);
  assert.ok(pickRecipient("SD-7KQ2M9XA", [maria], me).ok);
  assert.match((pickRecipient("maria", [mariana], me) as { reason: string }).reason, /Nobody/);
  assert.match((pickRecipient("maria", [], me) as { reason: string }).reason, /Nobody/);
  assert.match((pickRecipient("maria", [maria, { ...maria, wallet: "0x6666666666666666666666666666666666666666" }], me) as { reason: string }).reason, /More than one/);
  assert.match((pickRecipient("maria", [{ ...maria, wallet: me }], me) as { reason: string }).reason, /That is you/);
});

test("typedAddress: exactly one address from the person's own text; none, several, own, zero or bad checksum refused", () => {
  const me = "0x1111111111111111111111111111111111111111";
  const vault = "0x2222222222222222222222222222222222222222";
  const good = "0x52908400098527886E0F7030069857D2E4169EE7"; // a valid EIP-55 checksum
  const r = typedAddress(`send 5 USDC to ${good}`, [me, vault]);
  assert.ok(r.ok && r.address === good);
  assert.equal(confirmSuffixOf(good), "169EE7");
  // All lower case is accepted (no checksum to check) and returned checksummed.
  const lower = typedAddress(`to ${good.toLowerCase()} now`, [me]);
  assert.ok(lower.ok && lower.address === good);
  // The same address twice is one address.
  assert.ok(typedAddress(`${good} ${good.toLowerCase()}`, [me]).ok);
  const why = (t: string | undefined) => (typedAddress(t, [me, vault]) as { reason: string }).reason;
  assert.match(why("send 5 USDC to my friend"), /could not find/);
  assert.match(why(undefined), /type yourself/);
  assert.match(why(`${good} or 0x9999999999999999999999999999999999999999`), /more than one/);
  assert.match(why(`to ${me}`), /your own/);
  assert.match(why(`to ${vault}`), /your own/);
  assert.match(why("to 0x0000000000000000000000000000000000000000"), /zero address/);
  assert.match(why("to 0x52908400098527886E0F7030069857D2E4169Ee7"), /checksum/);
  // Part of a longer hex run is not an address.
  assert.match(why(`to ${good}00`), /could not find/);
});

test("server checks: hasTypedAddress sees an address only in the text itself", () => {
  assert.equal(hasTypedAddress("send to 0x52908400098527886E0F7030069857D2E4169EE7"), true);
  assert.equal(hasTypedAddress("send to [an address]"), false);
  assert.equal(hasTypedAddress("send to 0x5290"), false);
});
