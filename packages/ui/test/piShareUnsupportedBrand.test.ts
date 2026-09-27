import assert from "node:assert/strict";
import { test } from "node:test";
import { unsupportedShareRowsNotice } from "../src/v4/conversationShareUnsupportedNotice.js";

test("unsupported shared history names the installed Pi product in both locales", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const notice = unsupportedShareRowsNotice(locale);
    assert.match(notice, /Pi Agent IDE/u);
    assert.doesNotMatch(notice, /ZCode/u);
  }
});
