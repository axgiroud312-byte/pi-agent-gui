import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { PiNativeV4Service } from "../../services/src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../../services/src/pi-agent/pi-session-supervisor.js";
import { createZCodeTaskServiceAdapter } from "../../services/src/zcode-agent/zcodeTaskServiceAdapter.js";
import { markPiSessionRecoveryDeletionIntent, preparePiQueueEditRecovery,
  readPiQueueEditRecoveries, retryPendingPiQueueRecoveryDeletions } from "../src/v4/piQueueEditRecovery.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("Pi JSONL deletion intent retains recovered images on rejection and purges after a restart", {
  timeout: 30_000,
}, async t => {
  type AdapterOptions = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const root = await mkdtemp(join(tmpdir(), "pi-queue-recovery-delete-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const workspacePath = join(root, "workspace");
  const sessionDir = join(root, "sessions");
  const catalogDir = join(root, "catalog");
  await mkdir(workspacePath);
  const pi = SessionManager.create(workspacePath, sessionDir);
  pi.appendMessage({ role: "user", content: "A real Pi JSONL", timestamp: Date.now() });
  pi.appendMessage({ role: "assistant", content: [{ type: "text", text: "A real reply" }],
    timestamp: Date.now() } as Parameters<typeof pi.appendMessage>[0]);
  const sessionId = pi.getSessionId();
  const sessionFile = pi.getSessionFile();
  assert.ok(sessionFile);
  const originalJsonl = await readFile(sessionFile);

  const storage = new MemoryStorage();
  const saved = new Map<string, Uint8Array>();
  const workspaceKey = "workspace-a";
  const image = Uint8Array.from([7, 8, 9]);
  await preparePiQueueEditRecovery({ storage, workspaceKey, sessionId,
    target: { queueItemId: "queued-image", inputKind: "sendText", text: "unsent",
      attachments: [{ ref: "pi-queue-ref", fileName: "draft.png", mime: "image/png", bytes: image.length }] },
    readImage: async () => ({ bytes: image, mediaType: "image/png" }),
    saveImage: async (scope, id, file) => { saved.set(`${scope}:${id}`,
      new Uint8Array(await file.arrayBuffer())); },
  });
  const intent = { workspaceKey, workspacePath, sessionId };
  markPiSessionRecoveryDeletionIntent(storage, intent);
  const forgetImages = async (scope: string) => {
    for (const key of saved.keys()) if (key.startsWith(`${scope}:`)) saved.delete(key);
  };

  const openPiService = () => new PiNativeV4Service(new PiSessionSupervisor({
    piEntry: join(root, "unused"), env: { PI_CODING_AGENT_SESSION_DIR: sessionDir },
  }), catalogDir);
  const openAdapter = (service: PiNativeV4Service) => createZCodeTaskServiceAdapter({
    piHistoryAuthoritative: true,
    piSessionDeletionPreview: params => service.inspectSessionDeletion(params),
    piSessionDelete: params => service.deletePersistedSession(params),
    zcodeAgentService: { disposeAll() {} } as unknown as AdapterOptions["zcodeAgentService"],
    taskIndexSyncer: {
      onSessionTerminalEvent: () => ({ dispose() {} }),
      onSessionReadyEvent: () => ({ dispose() {} }),
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as AdapterOptions["taskIndexSyncer"],
  } as AdapterOptions);
  let piService = openPiService();
  let adapter = openAdapter(piService);
  const sessionExists = async () => (await adapter.getTaskSessionFilePath({
    taskId: sessionId, workspacePath,
  })).exists;
  try {
    const preview = await adapter.getTaskSessionFilePath({ taskId: sessionId, workspacePath });
    assert.equal(preview.exists, true);
    await assert.rejects(adapter.deleteTask({ taskId: sessionId, workspacePath,
      expectedSessionFile: preview.path, expectedRevision: "wrong-revision" }), /changed/);
    await retryPendingPiQueueRecoveryDeletions({ storage, sessionExists, forgetImages });
    assert.equal(readPiQueueEditRecoveries(storage, workspaceKey, sessionId).length, 1);
    assert.equal(saved.size, 1, "a rejected Pi deletion retains the only saved image bytes");
    assert.deepEqual(await readFile(sessionFile), originalJsonl);

    await adapter.deleteTask({ taskId: sessionId, workspacePath,
      expectedSessionFile: preview.path, expectedRevision: preview.revision });
    await assert.rejects(readFile(sessionFile), { code: "ENOENT" });
    // Simulate a crash after the Pi unlink ACK and before local recovery cleanup.
    adapter.disposeAll();
    await piService.dispose();
    piService = openPiService();
    adapter = openAdapter(piService);
    await retryPendingPiQueueRecoveryDeletions({ storage, sessionExists, forgetImages });
    assert.deepEqual(readPiQueueEditRecoveries(storage, workspaceKey, sessionId), []);
    assert.equal(saved.size, 0, "only now may the private recovered image bytes be purged");
    assert.equal(storage.length, 0, "the completed two-phase intent is retired");
  } finally {
    adapter.disposeAll();
    await piService.dispose();
  }
});
