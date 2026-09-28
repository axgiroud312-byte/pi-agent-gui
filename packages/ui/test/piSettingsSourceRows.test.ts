import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPiSettingsSourceRows } from "../src/settings/piSettingsSourceRows.js";

test("native Pi settings render each effective nested leaf with its own scope", () => {
  const rows = buildPiSettingsSourceRows({
    effective: { retry: { enabled: true, maxRetries: 5 }, unknown: { "a/b~c": [1, 2] } },
    sources: { retry: "project", unknown: "user" },
    sourcePaths: { "/retry/enabled": "user", "/retry/maxRetries": "project",
      "/unknown/a~1b~0c": "user" },
  });
  assert.deepEqual(rows.find(row => row.path === "/retry/enabled"),
    { path: "/retry/enabled", value: "true", source: "user" });
  assert.deepEqual(rows.find(row => row.path === "/retry/maxRetries"),
    { path: "/retry/maxRetries", value: "5", source: "project" });
  assert.deepEqual(rows.find(row => row.path === "/unknown/a~1b~0c"),
    { path: "/unknown/a~1b~0c", value: "[1,2]", source: "user" });
  assert.equal(rows.some(row => row.path === "/retry"), false,
    "an aggregate object must not claim one source for mixed user and project leaves");
});
