import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueueItem, QueueState } from "@zcode/shared/zcode-protocol-v4";
import { projectPendingGuideQueue } from "../src/v4/pendingGuideProjection.js";

const item = (queueItemId: string, admitted: "guide" | "queue") => ({
  queueItemId,
  delivery: { admitted },
}) as QueueItem;

test("pending steering remains in the Pi-backed control queue while timeline shows its guide state", () => {
  const steering = item("steering-1", "guide");
  const secondSteering = item("steering-2", "guide");
  const followUp = item("follow-up-1", "queue");
  const queue = { items: [steering, secondSteering, followUp], autoDrain: false,
    pauseReason: "stopped" } as QueueState;

  const projected = projectPendingGuideQueue(queue);
  assert.deepEqual(projected.pendingGuides, [steering, secondSteering]);
  assert.equal(projected.controlQueue, queue,
    "the native control panel must receive the same authoritative queue, without cloning it");
  assert.deepEqual(projected.controlQueue.items.map(entry => entry.queueItemId),
    ["steering-1", "steering-2", "follow-up-1"]);
});
