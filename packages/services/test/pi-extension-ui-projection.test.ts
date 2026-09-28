import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

test("fixed Pi 0.87 startup and command UI state reaches the same native v4 session and clears on reload",
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-ui-state-"));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url)), "-e",
        fileURLToPath(new URL("./fixtures/pi-ui-state.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
    try {
      const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: "ui-state-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: root },
      } });
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("session not created");
      const sessionId = created.result.sessionId;
      const session = () => (service as unknown as { sessions: Map<string, { snapshot: unknown }> }).sessions.get(sessionId);
      const snapshot = () => conversationSnapshotSchema.parse(session()?.snapshot);
      assert.deepEqual(snapshot().piExtensionUi.statuses, [{ key: "startup", text: "ready" }],
        "Pi session_start status must survive service bootstrap");
      assert.deepEqual(snapshot().piExtensionUi.widgets, [{ key: "startup", lines: ["Pi startup widget"],
        placement: "belowEditor" }]);
      assert.equal(snapshot().piExtensionUi.title?.text, "Pi extension terminal title");
      assert.equal(snapshot().piExtensionUi.editorText?.text, "Pi suggested draft");
      assert.notEqual(snapshot().meta.title, "Pi extension terminal title",
        "terminal title must not overwrite the Pi session history name");
      const pid = supervisor.getSession(sessionId)?.pid;
      const target = { workspacePath: root, sessionId };
      const toolView = await service.readPiControlTree(target);
      assert(toolView.tools.some(tool => tool.name === "pi_ide_probe"));
      const disabled = await service.runPiControlTree({ ...target, action: { operation: "set_tools",
        names: toolView.activeTools.filter(name => name !== "pi_ide_probe"),
        generation: toolView.info.generation, sessionId } });
      assert.equal(disabled.activeTools.includes("pi_ide_probe"), false);
      const enabled = await service.runPiControlTree({ ...target, action: { operation: "set_tools",
        names: [...disabled.activeTools, "pi_ide_probe"], generation: disabled.info.generation, sessionId } });
      assert.equal(enabled.activeTools.includes("pi_ide_probe"), true);
      const before = await supervisor.readControlBridge(sessionId);
      const after = await supervisor.runControlBridge(sessionId, { operation: "reload",
        generation: before.info.generation, sessionId });
      assert.notEqual(after.info.generation, before.info.generation);
      assert.equal(supervisor.getSession(sessionId)?.pid, pid);
      assert.equal(snapshot().piExtensionUi.statuses.some(value => value.key === "startup"), false,
        "extension reload must retire old keyed state");
      assert.equal(snapshot().piExtensionUi.widgets.some(value => value.key === "startup"), false);
      assert.equal(snapshot().piExtensionUi.title, undefined);
      assert.equal(snapshot().piExtensionUi.editorText, undefined);
      await supervisor.sendText(sessionId, "/pi-ui-state");
      assert.deepEqual(snapshot().piExtensionUi.statuses.find(value => value.key === "progress"),
        { key: "progress", text: "second" });
      assert.deepEqual(snapshot().piExtensionUi.widgets.find(value => value.key === "panel"),
        { key: "panel", lines: ["line one", "line two"], placement: "aboveEditor" });
      assert.equal(snapshot().piExtensionUi.notices.at(-1)?.message, "Pi extension notice");
    } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
  });
