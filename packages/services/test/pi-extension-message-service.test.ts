import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

test("native Pi session exposes custom image by scoped ref while retaining message details",
  { timeout: 30_000 }, async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "pi-extension-image-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "pi-extension-other-"));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(workspacePath, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("../../../examples/pi-gui-compat/extension.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    const service = new PiNativeV4Service(supervisor, join(workspacePath, "catalog"));
    try {
      const created = await service.sendConversationCommandV4({ workspacePath, envelope: {
        commandId: randomUUID(), clientId: "extension-image-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: workspacePath },
      } });
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("No Pi session");
      const sessionId = created.result.sessionId;
      await supervisor.sendText(sessionId, "/gui-compat-image");
      const rows = await service.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
      const message = rows.rows.find(row => row.kind === "extensionMessage");
      assert(message && message.kind === "extensionMessage");
      assert.deepEqual(message.details, { image: "sample", source: "Pi" });
      const image = message.parts.find(part => part.type === "image");
      assert(image && image.type === "image");
      assert.equal(message.attachments?.[image.attachmentIndex]?.ref, image.ref);
      const read = await service.attachmentReadV4({ workspacePath, sessionId, ref: image.ref,
        offset: 0, limit: 1024 });
      assert.equal(read.mediaType, "image/png");
      assert.equal(read.dataBase64, imageData);
      await assert.rejects(service.attachmentReadV4({ workspacePath: otherWorkspace, sessionId, ref: image.ref,
        offset: 0, limit: 1024 }), /workspace|owned|session/iu);
    } finally {
      await service.dispose();
      await rm(workspacePath, { recursive: true, force: true });
      await rm(otherWorkspace, { recursive: true, force: true });
    }
  });

const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRhsAAAAASUVORK5CYII=";
