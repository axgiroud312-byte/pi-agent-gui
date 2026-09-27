import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";
import type { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

test("Pi session rename cannot report success or change the task title after Pi rejects it", async () => {
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const calls: string[] = [];
  const meta = { taskId: "f845da82-d4c3-4393-8aa0-e44de597bd14", workspacePath: "C:/pi-project",
    title: "Original Pi title", mode: "build", provider: "glm", createdAt: 1, updatedAt: 2 };
  const service = createZCodeTaskServiceAdapter({
    piHistoryAuthoritative: true,
    zcodeAgentService: {
      async sendConversationCommandV4() {
        calls.push("pi-rename");
        return { commandId: "rejected", status: "failed", reasonCode: "pi.commandFailed",
          revisionAtDecision: 0 };
      },
      disposeAll() {},
    } as unknown as Options["zcodeAgentService"],
    taskIndexRepo: {
      async updateTaskState() { calls.push("task-title-write"); return meta; },
      close() {},
    } as unknown as TaskIndexRepo,
    taskIndexSyncer: {
      onSessionTerminalEvent: () => ({ dispose() {} }),
      onSessionReadyEvent: () => ({ dispose() {} }),
      emitWorkspaceTaskListChanged() { calls.push("title-event"); },
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
  } as Options);
  try {
    await assert.rejects(service.renameTask({ taskId: meta.taskId,
      workspacePath: meta.workspacePath, title: "A different title" }), /renameSession/u);
    assert.deepEqual(calls, ["pi-rename"], "the task list may only change after Pi commits session_info");
  } finally {
    service.disposeAll();
  }
});

test("a cold Pi CLI session renamed through the native command has the same JSONL identity and name in CLI",
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-cli-rename-"));
    const workspacePath = join(root, "workspace");
    const sessionDir = join(root, "sessions");
    const profile = join(root, "profile");
    await mkdir(workspacePath);
    await mkdir(profile);
    let service: PiNativeV4Service | undefined;
    try {
      await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
        "rename-test": { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions",
          apiKey: "local-test-only", models: [{ id: "rename-test" }] },
      } }));
      const cli = SessionManager.create(workspacePath, sessionDir);
      cli.appendMessage({ role: "user", content: "Original question", timestamp: Date.now() });
      cli.appendMessage({ role: "assistant", content: [{ type: "text", text: "Original answer" }],
        timestamp: Date.now() } as Parameters<typeof cli.appendMessage>[0]);
      cli.appendSessionInfo("Before rename");
      const sessionId = cli.getSessionId();
      const sessionFile = cli.getSessionFile();
      assert.ok(sessionFile);
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: profile, PI_CODING_AGENT_SESSION_DIR: sessionDir, PI_TELEMETRY: "0" },
        rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
          "--no-context-files", "--provider", "rename-test", "--model", "rename-test"],
      });
      service = new PiNativeV4Service(supervisor, join(root, "catalog"));
      const ack = await service.sendConversationCommandV4({ workspacePath, envelope: {
        type: "renameSession", commandId: randomUUID(), clientId: "pi-rename-test", sessionId,
        issuedAt: Date.now(), payload: { title: "Renamed in the GUI" },
      } });
      assert.equal(ack.status, "accepted", ack.message);
      assert.equal(supervisor.getSession(sessionId)?.sessionFile, sessionFile);
      await service.dispose();
      service = undefined;
      assert.equal(SessionManager.open(sessionFile).getSessionId(), sessionId);
      const renamed = (await SessionManager.list(workspacePath, sessionDir)).find(item => item.id === sessionId);
      assert.equal(renamed?.name, "Renamed in the GUI");
    } finally {
      await service?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
