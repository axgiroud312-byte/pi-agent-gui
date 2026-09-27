import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueueItem } from "@zcode/shared/zcode-protocol-v4";
import { resolveQueueReorderAnchor } from "../src/v4/queueReorder.js";

const item = (queueItemId: string, admitted: "guide" | "queue") => ({
  queueItemId,
  delivery: { admitted },
}) as QueueItem;

test("dragging within Pi steering or follow-up only reorders its own lane", () => {
  const items = [item("steer-1", "guide"), item("steer-2", "guide"),
    item("follow-1", "queue"), item("follow-2", "queue")];

  assert.deepEqual(resolveQueueReorderAnchor(items, "steer-1", "steer-2"), {
    queueItemId: "steer-1", beforeQueueItemId: null,
  }, "moving to the end of steering must not target the first follow-up");
  assert.deepEqual(resolveQueueReorderAnchor(items, "steer-2", "steer-1"), {
    queueItemId: "steer-2", beforeQueueItemId: "steer-1",
  });
  assert.deepEqual(resolveQueueReorderAnchor(items, "follow-1", "follow-2"), {
    queueItemId: "follow-1", beforeQueueItemId: null,
  });
  assert.deepEqual(resolveQueueReorderAnchor(items, "follow-2", "follow-1"), {
    queueItemId: "follow-2", beforeQueueItemId: "follow-1",
  });
  assert.equal(resolveQueueReorderAnchor(items, "steer-2", "follow-1"), null,
    "a drag must not silently convert a steering input into a follow-up");
  assert.equal(resolveQueueReorderAnchor(items, "follow-1", "steer-2"), null);
  assert.equal(resolveQueueReorderAnchor(items, "follow-1", "follow-1"), null);
});
