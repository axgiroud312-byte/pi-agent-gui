import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { CommandAck, CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { pendingCommandRegistry } from "../src/v4/pendingCommandRegistry.js";

test("Pi handled queue ACK closes renderer recovery without inventing a queue or JSONL row", () => {
  const sessionId = randomUUID();
  const envelope = (commandId: string): CommandEnvelope => ({
    type: "sendText", commandId, clientId: "pi-handled-queue-ui", sessionId,
    issuedAt: Date.now(), payload: { text: "PI_GUI_INPUT_HANDLED", requestedDelivery: "queue" },
  });
  const ack = (commandId: string): CommandAck => ({
    commandId, status: "accepted", reasonCode: "pi.inputHandledByExtension",
    revisionAtDecision: 1, result: { type: "inputAccepted", delivery: "startNow", inputId: randomUUID() },
  });
  const first = envelope(randomUUID());
  const second = envelope(randomUUID());
  try {
    assert.ok(pendingCommandRegistry.record(first));
    assert.equal(pendingCommandRegistry.list(sessionId).length, 1);
    pendingCommandRegistry.applyAck(first, ack(first.commandId));
    assert.equal(pendingCommandRegistry.list(sessionId).length, 0);

    assert.ok(pendingCommandRegistry.record(second));
    pendingCommandRegistry.applyQuery({ results: [{ key: { sessionId, commandId: second.commandId },
      result: ack(second.commandId) }] });
    assert.equal(pendingCommandRegistry.list(sessionId).length, 0,
      "a restart query must also close the known terminal Pi input handler ACK");
  } finally {
    pendingCommandRegistry.settle(sessionId, first.commandId);
    pendingCommandRegistry.settle(sessionId, second.commandId);
  }
});
