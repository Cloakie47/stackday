import { test } from "node:test";
import assert from "node:assert/strict";
import { fromDocsHref, guideHref, GUIDE } from "./guide.ts";

test("old /docs links go to the matching guide page", () => {
  assert.equal(fromDocsHref("/docs"), GUIDE);
  assert.equal(fromDocsHref("/docs#borrowing"), `${GUIDE}#borrow`);
  assert.equal(fromDocsHref("/docs#notices"), `${GUIDE}#security`);
  assert.equal(fromDocsHref("/docs#themes"), `${GUIDE}#invest-themes`);
  assert.equal(fromDocsHref("/docs#demo"), `${GUIDE}#getting-started-testnet-tools`);
});

test("other links are left alone", () => {
  assert.equal(fromDocsHref("/borrow"), "/borrow");
  assert.equal(fromDocsHref("/docsy"), "/docsy");
});

test("unknown section names pass through as guide page ids", () => {
  assert.equal(guideHref("gifts"), `${GUIDE}#gifts`);
  assert.equal(guideHref(), GUIDE);
});
