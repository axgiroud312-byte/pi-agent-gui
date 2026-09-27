import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPiDiagnosticPreview } from "../src/feedback/piDiagnosticPreview.js";

test("diagnostic preview reports verified versions but never copies runtime payloads", () => {
  const preview = buildPiDiagnosticPreview({
    guiVersion: "3.14.0",
    buildCommit: "abcdef1234567890",
    piBridge: {
      piVersion: "0.87.0",
      bridgeVersion: "1.2.0",
      mode: "rpc",
      sessionId: "secret-session-id",
      diagnostics: ["apiKey=secret-key"],
      workspacePath: "C:\\Users\\private\\project",
      directoryName: "PRIVATE_DIRECTORY_SENTINEL",
      stack: "Error: PRIVATE_STACK_SENTINEL at C:\\Users\\private\\project",
      futureField: { bearer: "Bearer PRIVATE_BEARER_SENTINEL", key: "sk-PRIVATE_KEY_SENTINEL" },
    },
  });
  assert.match(preview, /GUI: 3\.14\.0/u);
  assert.match(preview, /Build commit: abcdef1234567890/u);
  assert.match(preview, /Pi runtime: 0\.87\.0/u);
  assert.match(preview, /Pi bridge: 1\.2\.0/u);
  assert.doesNotMatch(preview,
    /secret|private|workspacePath|sessionId|apiKey|stack|directoryName|futureField|Bearer|sk-/iu);
});

test("unverified Pi or malformed version fields are explicit and never become report text", () => {
  const preview = buildPiDiagnosticPreview({
    guiVersion: "3.14.0\nAuthorization: Bearer secret",
    buildCommit: "unknown",
    piBridge: { piVersion: "0.87.0\npassword=secret", bridgeVersion: "1.2.0", mode: "other" },
  });
  assert.match(preview, /GUI: unavailable/u);
  assert.match(preview, /Pi runtime: not checked/u);
  assert.match(preview, /Pi bridge: not checked/u);
  assert.doesNotMatch(preview, /secret|Authorization|password/u);
});

test("credential-looking values in version slots cannot enter the diagnostic preview", () => {
  const preview = buildPiDiagnosticPreview({
    guiVersion: "1.0.0-sk-PRIVATE_GUI_KEY",
    buildCommit: "sk-PRIVATE_BUILD_KEY",
    piBridge: { mode: "rpc", piVersion: "0.87.0-bearerPRIVATE_PI_TOKEN",
      bridgeVersion: "1.2.0-secretPRIVATE_BRIDGE_KEY" },
  });
  assert.match(preview, /GUI: unavailable/u);
  assert.match(preview, /Build commit: unavailable/u);
  assert.match(preview, /Pi runtime: not checked/u);
  assert.match(preview, /Pi bridge: not checked/u);
  assert.doesNotMatch(preview, /PRIVATE_|bearer|secret|sk-/iu);
});
