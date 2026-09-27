import assert from "node:assert/strict";
import { test } from "node:test";
import { createAboutSnapshot, formatAboutDetail } from "../src/main/about.js";

test("exported About diagnostics omit the machine hostname", () => {
  const osInfo = { type: "Windows_NT", platform: "win32", release: "10", version: "10.0",
    arch: "x64", hostname: "private-machine-name" };
  const details = formatAboutDetail(createAboutSnapshot({
    appVersion: "3.14.0",
    osInfo,
  }));
  assert.match(details, /Version: 3\.14\.0/u);
  assert.match(details, /OS Platform: win32/u);
  assert.doesNotMatch(details, /private-machine-name|Hostname:/u);
});
