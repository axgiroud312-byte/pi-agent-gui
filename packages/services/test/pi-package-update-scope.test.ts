import assert from "node:assert/strict";
import { test } from "node:test";
import { piPackageUpdateAdmission } from "../src/pi-agent/pi-package-update-scope.js";

test("a row update cannot silently target the same npm identity in both scopes", () => {
  const packages = [
    { source: "npm:@example/shared@^1.0.0", scope: "user" as const },
    { source: "npm:@example/shared@^2.0.0", scope: "project" as const },
  ];
  assert.deepEqual(piPackageUpdateAdmission(packages, packages[0]!), {
    state: "multiple", scopes: ["user", "project"],
  });
  assert.deepEqual(piPackageUpdateAdmission(packages, packages[1]!), {
    state: "multiple", scopes: ["user", "project"],
  });
});

test("different Git URLs and refs for one repository cannot be updated as one row", () => {
  const packages = [
    { source: "git:github.com/example/shared.git#v1", scope: "user" as const },
    { source: "git:git@github.com:example/shared.git@v2", scope: "project" as const },
  ];
  assert.deepEqual(piPackageUpdateAdmission(packages, packages[0]!), {
    state: "multiple", scopes: ["user", "project"],
  });
});

test("single configured identity is safe and uncertain Git identity fails closed", () => {
  assert.deepEqual(piPackageUpdateAdmission([
    { source: "npm:only-one@^1", scope: "user" },
    { source: "npm:another-one", scope: "project" },
  ], { source: "npm:only-one@^1", scope: "user" }), {
    state: "single", scopes: ["user"],
  });
  assert.deepEqual(piPackageUpdateAdmission([
    { source: "git:mystery-alias:example/repository@v1", scope: "user" },
    { source: "git:https://example.invalid/other/repository", scope: "project" },
  ], { source: "git:mystery-alias:example/repository@v1", scope: "user" }), {
    state: "unknown", scopes: [],
  });
});
