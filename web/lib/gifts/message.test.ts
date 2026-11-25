import { test } from "node:test";
import assert from "node:assert/strict";
import { attachDecision, parseIds } from "./message.ts";

const ME = "0x00000000000000000000000000000000000000aa";
const YOU = "0x00000000000000000000000000000000000000BB";
const pending = { sender: ME.toUpperCase().replace("0X", "0x"), recipient: YOU, status: 1 };

test("the sender of a pending gift can attach a message; sender and recipient come from the chain", () => {
  const d = attachDecision(ME, "7", "  Happy birthday  ", pending);
  assert.deepEqual(d, { ok: true, row: { gift_id: "7", sender: ME, recipient: YOU.toLowerCase(), message: "Happy birthday" } });
});

test("anyone else, a missing gift, a closed gift or a bad message is refused", () => {
  assert.equal((attachDecision(YOU, "7", "hi", pending) as { status: number }).status, 403);
  assert.equal((attachDecision(ME, "7", "hi", null) as { status: number }).status, 404);
  assert.equal((attachDecision(ME, "7", "hi", { ...pending, status: 0 }) as { status: number }).status, 404);
  assert.equal((attachDecision(ME, "7", "hi", { ...pending, status: 2 }) as { status: number }).status, 409);
  assert.equal((attachDecision(ME, "7", "x".repeat(141), pending) as { status: number }).status, 400);
  assert.equal((attachDecision(ME, "7", "   ", pending) as { status: number }).status, 400);
  assert.equal((attachDecision(ME, "0", "hi", pending) as { status: number }).status, 400);
  assert.equal((attachDecision(ME, 7, "hi", pending) as { status: number }).status, 400);
});

test("ids are parsed strictly and capped", () => {
  assert.deepEqual(parseIds("1, 2,2,x,0,-3,10"), ["1", "2", "10"]);
  assert.deepEqual(parseIds(null), []);
  assert.equal(parseIds(Array.from({ length: 300 }, (_, i) => i + 1).join(",")).length, 200);
});
