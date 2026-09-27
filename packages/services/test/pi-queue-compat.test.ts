import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";

type QueueItem = { id: string; text: string; images: Array<{ type: "image"; data: string; mimeType: string }> };
type QueueCatalog = { revision: number; steering: Array<{ id: string; text: string; images: Array<{ bytes: number }> }>;
  followUp: Array<{ id: string; text: string; images: Array<{ bytes: number }> }> };

test("fixed Pi queue compatibility preserves duplicate text images and rejects stale edits", { timeout: 30_000 }, async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "pi-queue-compat-"));
  const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const client = new PiRpcClient({ executable: process.execPath,
    args: [piEntry, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
    cwd: sandbox, env: { PI_CODING_AGENT_DIR: join(sandbox, "profile"), PI_TELEMETRY: "0" },
  });
  try {
    await client.start();
    const capabilities = await client.request({ type: "pi_gui_queue_capabilities_v1" });
    assert.equal(capabilities.success, true, capabilities.error);
    assert.equal((capabilities.data as { protocol: string }).protocol, "pi-gui-queue/1");

    const firstImage = { type: "image", data: "aW1hZ2UtMQ==", mimeType: "image/png" };
    const secondImage = { type: "image", data: "aW1hZ2UtMg==", mimeType: "image/png" };
    const firstAdmission = await client.request({ type: "steer", message: "same text", images: [firstImage] });
    assert.equal(firstAdmission.success, true);
    const secondAdmission = await client.request({ type: "steer", message: "same text", images: [secondImage] });
    assert.equal(secondAdmission.success, true);
    assert.equal((await client.request({ type: "follow_up", message: "later" })).success, true);

    const snapshotResponse = await client.request({ type: "pi_gui_queue_catalog_v1" });
    assert.equal(snapshotResponse.success, true, snapshotResponse.error);
    const before = snapshotResponse.data as QueueCatalog;
    assert.equal(before.steering.length, 2);
    assert.equal((firstAdmission.data as { queueItemId: string }).queueItemId, before.steering[0]!.id);
    assert.equal((secondAdmission.data as { queueItemId: string }).queueItemId, before.steering[1]!.id);
    assert.notEqual(before.steering[0]!.id, before.steering[1]!.id);
    assert.deepEqual(before.steering.map(item => item.images[0]?.bytes), [7, 7]);
    assert.deepEqual(before.followUp.map(item => item.text), ["later"]);
    const readFirst = await client.request({ type: "pi_gui_queue_read_item_v1", expectedRevision: before.revision,
      queueItemId: before.steering[0]!.id });
    assert.deepEqual((readFirst.data as QueueItem).images, [firstImage]);

    const move = await client.request({ type: "pi_gui_queue_mutate_v1", expectedRevision: before.revision,
      operation: { kind: "move", id: before.steering[1]!.id, beforeId: before.steering[0]!.id } });
    assert.equal(move.success, true, move.error);
    const moved = (move.data as { catalog: QueueCatalog }).catalog;
    assert.deepEqual(moved.steering.map(item => item.id), [before.steering[1]!.id, before.steering[0]!.id]);

    const stale = await client.request({ type: "pi_gui_queue_mutate_v1", expectedRevision: before.revision,
      operation: { kind: "take", id: before.steering[0]!.id } });
    assert.equal(stale.success, false, "an old UI snapshot must not remove a changed queue item");
    assert.match(stale.error ?? "", /revision|changed|conflict/iu);

    const take = await client.request({ type: "pi_gui_queue_mutate_v1", expectedRevision: moved.revision,
      operation: { kind: "take", id: before.steering[0]!.id } });
    assert.equal(take.success, true, take.error);
    assert.equal((take.data as { takenId: string }).takenId, before.steering[0]!.id);
    const after = (take.data as { catalog: QueueCatalog }).catalog;
    assert.deepEqual(after.steering.map(item => item.id), [before.steering[1]!.id]);
    const staleRead = await client.request({ type: "pi_gui_queue_read_item_v1", expectedRevision: before.revision,
      queueItemId: before.steering[1]!.id });
    assert.equal(staleRead.success, false);
    const saved = await client.request({ type: "pi_gui_queue_read_item_v1", expectedRevision: after.revision,
      queueItemId: after.steering[0]!.id });
    assert.deepEqual((saved.data as QueueItem).images, [secondImage]);
    const staleClear = await client.request({ type: "pi_gui_queue_take_all_v1", expectedRevision: moved.revision });
    assert.equal(staleClear.success, false);
    const clear = await client.request({ type: "pi_gui_queue_take_all_v1", expectedRevision: after.revision });
    assert.equal(clear.success, true, clear.error);
    assert.deepEqual((clear.data as { takenIds: string[] }).takenIds.sort(),
      [after.steering[0]!.id, after.followUp[0]!.id].sort());
  } finally {
    await client.dispose();
    await rm(sandbox, { recursive: true, force: true });
  }
});
