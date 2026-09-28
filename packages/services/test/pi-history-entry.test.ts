import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { editablePiHistoryText, retryablePiHistoryContent } from "../src/pi-agent/pi-history-entry.js";
import { piControlIntent } from "../src/pi-agent/pi-control-protocol.js";

test("historical retry accepts only lossless Pi text and image content", () => {
  const image = { type: "image" as const, data: Buffer.from("historical image").toString("base64"),
    mimeType: "image/png" };
  assert.deepEqual(retryablePiHistoryContent([{ type: "text", text: "repeat" }, image]),
    { text: "repeat", images: [image] });
  assert.deepEqual(retryablePiHistoryContent("text only"), { text: "text only", images: [] });
  assert.throws(() => retryablePiHistoryContent([{ type: "text", text: "part one" },
    { type: "text", text: "part two" }]), /content|lossless/i);
  assert.throws(() => retryablePiHistoryContent([{ type: "text", text: "text" },
    { type: "future", value: 1 }]), /content|lossless/i);
  assert.throws(() => retryablePiHistoryContent([{ type: "text", text: "inspect" },
    { type: "image", data: "not base64", mimeType: "image/png" }]),
    /image|base64/i);
  assert.throws(() => retryablePiHistoryContent("/reload-runtime"), /command|slash/i);
});

test("historical edit restores only text without hidden file snapshots or images", () => {
  assert.equal(editablePiHistoryText([{ type: "text", text: "edit me" }]), "edit me");
  assert.throws(() => editablePiHistoryText([{ type: "text", text: "text" },
    { type: "image", data: "YQ==", mimeType: "image/png" }]), /image|lossless/i);
  assert.throws(() => editablePiHistoryText(`text\n\n---\nPi file snapshots captured at send time (image data is in this Pi message):\n${JSON.stringify([{
    kind: "text", path: "a.txt", sha256: "0".repeat(64), content: "original",
  }])}`), /snapshot|context/i);
  assert.throws(() => editablePiHistoryText([{ type: "future", value: 1 }]), /content|lossless/i);
});

test("historical retry command requires current Pi projection CAS and entry identity", () => {
  const envelope = { commandId: "history-retry-1", clientId: "test", sessionId: "pi-session",
    issuedAt: Date.now(), type: "retryPiEntry", payload: { entryId: "pi-entry" },
    baseRevision: 3, baseLogEpoch: "epoch" };
  assert.equal(parseCommandEnvelope(envelope).ok, true);
  assert.equal(parseCommandEnvelope({ ...envelope, baseRevision: undefined }).ok, false);
  assert.equal(parseCommandEnvelope({ ...envelope, baseLogEpoch: undefined }).ok, false);
  assert.equal(parseCommandEnvelope({ ...envelope, payload: { entryId: "" } }).ok, false);
});

test("Pi tree retry mode is explicit and cannot be combined with summarization", () => {
  assert.deepEqual(piControlIntent({ operation: "navigate", targetId: "user-1", summarize: false,
    mode: "retry" }), { operation: "navigate", targetId: "user-1", summarize: false,
    mode: "retry" });
  assert.throws(() => piControlIntent({ operation: "navigate", targetId: "user-1", summarize: true,
    mode: "retry" }), /invalid/i);
  assert.throws(() => piControlIntent({ operation: "navigate", targetId: "user-1", summarize: false,
    mode: "unknown" }), /invalid/i);
});
