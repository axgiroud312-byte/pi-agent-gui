import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

for (const handled of [
  { text: "/gui-compat-image", kind: "command" },
  { text: "PI_GUI_INPUT_HANDLED", kind: "input" },
] as const) {
  test(`sendQueuedNow removes Pi-owned ${handled.kind} after fixed Pi handles it without a model run`,
    { timeout: 90_000 }, async () => {
      const tempBase = tmpdir();
      const root = await mkdtemp(join(tempBase, `pi-queue-handled-${handled.kind}-`));
      const profile = join(root, "profile");
      const modelCalls: string[] = [];
      let firstArrived: (() => void) | undefined;
      let releaseFirst: (() => void) | undefined;
      const first = new Promise<void>(resolve => { firstArrived = resolve; });
      const model = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        modelCalls.push(body);
        if (body.includes("HOLD_RUN")) {
          firstArrived?.();
          await new Promise<void>(resolve => { releaseFirst = resolve; });
        }
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({ id: "queue-handled", object: "chat.completion.chunk", created: 1,
          model: "queue-handled", choices: [{ index: 0, delta: { role: "assistant", content: "DONE" },
            finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      });
      let service: PiNativeV4Service | undefined;
      let reopened: PiNativeV4Service | undefined;
      try {
        await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
        const address = model.address();
        assert.ok(address && typeof address !== "string");
        await mkdir(profile);
        await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "queue-handled": {
          baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "test-only",
          models: [{ id: "queue-handled", reasoning: false, input: ["text"] }],
        } } }));
        await writeFile(join(profile, "settings.json"), JSON.stringify({
          defaultProvider: "queue-handled", defaultModel: "queue-handled", defaultProjectTrust: "always",
        }));
        const supervisor = new PiSessionSupervisor({
          piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
          env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
          rpcArgs: ["--offline", "--no-extensions", "-e",
            fileURLToPath(new URL("../../../examples/pi-gui-compat/extension.ts", import.meta.url)),
            "--no-skills", "--no-prompt-templates", "--no-context-files"],
        });
        service = new PiNativeV4Service(supervisor, join(root, "catalog"));
        let promotedOutcome: string | undefined;
        const originalSend = supervisor.sendText.bind(supervisor);
        supervisor.sendText = async (...args) => {
          const outcome = await originalSend(...args);
          if (args[1] === handled.text) promotedOutcome = outcome;
          return outcome;
        };
        const records: Record<string, unknown>[] = [];
        supervisor.on("record", (_sessionId, record) => records.push(record));
        const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
          commandId: randomUUID(), clientId: "handled-queue", sessionId: null, issuedAt: Date.now(),
          type: "createSession", payload: { workspaceId: root },
        } });
        assert.equal(created.status, "accepted", created.message);
        assert(created.result?.type === "createSession");
        const sessionId = created.result.sessionId;
        const current = (): ConversationSnapshot => {
          const records = service as unknown as { sessions: Map<string, { snapshot: ConversationSnapshot }> };
          return records.sessions.get(sessionId)!.snapshot;
        };
        const command = (type: string, payload: unknown, baseRevision?: number,
          commandId = randomUUID()) => service!.sendConversationCommandV4({
          workspacePath: root, envelope: { commandId, clientId: "handled-queue", sessionId,
            issuedAt: Date.now(), type, payload,
            ...(baseRevision === undefined ? {} : { baseRevision }) },
        });
        assert.equal((await command("sendText", { text: "HOLD_RUN" })).status, "accepted");
        await first;
        const directlyHandledIds: string[] = [];
        if (handled.kind === "input") {
          for (const requestedDelivery of ["queue", "guide"] as const) {
            const previous = records.filter(record => record.method === "notify" &&
              record.message === "PI_GUI_INPUT_HANDLED_BY_EXTENSION").length;
            const directId = randomUUID();
            directlyHandledIds.push(directId);
            const direct = await command("sendText", { text: handled.text, requestedDelivery }, undefined, directId);
            assert.equal(direct.status, "accepted", direct.message);
            assert.equal(direct.reasonCode, "pi.inputHandledByExtension");
            assert.equal(direct.result?.type, "inputAccepted");
            if (direct.result?.type === "inputAccepted") assert.equal(direct.result.delivery, "startNow",
              "Pi handled the input immediately instead of creating a queue item");
            assert.equal(records.filter(record => record.method === "notify" &&
              record.message === "PI_GUI_INPUT_HANDLED_BY_EXTENSION").length, previous + 1);
            assert.deepEqual((await supervisor.getQueueCatalog(sessionId)).followUp, []);
            assert.deepEqual((await supervisor.getQueueCatalog(sessionId)).steering, []);
          }
          const image = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
            "base64");
          const imagePath = join(root, "handled.png");
          await writeFile(imagePath, image);
          const imageId = randomUUID();
          directlyHandledIds.push(imageId);
          const imageAck = await command("sendText", { text: "PI_GUI_INPUT_HANDLED_IMAGE",
            requestedDelivery: "queue", attachments: [{ ref: imagePath, fileName: "handled.png",
              mime: "image/png", bytes: image.length }] }, undefined, imageId);
          assert.equal(imageAck.status, "accepted", imageAck.message);
          assert.equal(imageAck.reasonCode, "pi.inputHandledByExtension");
          assert.equal(imageAck.result?.type, "inputAccepted");
          if (imageAck.result?.type === "inputAccepted") assert.equal(imageAck.result.delivery, "startNow");
          const digest = createHash("sha256").update(image).digest("hex");
          assert(records.some(record => record.method === "notify" &&
            record.message === `PI_GUI_INPUT_HANDLED_IMAGE:image/png:${digest}`),
          "the actual Pi extension observed the exact original image bytes and MIME");
          assert.deepEqual((await supervisor.getQueueCatalog(sessionId)).followUp, []);
        }
        const queuedAck = await command("sendText", { text: "queued for edit", requestedDelivery: "queue" });
        assert.equal(queuedAck.status, "accepted", queuedAck.message);
        const queued = await supervisor.getQueueCatalog(sessionId);
        assert.deepEqual(queued.followUp.map(item => item.text), ["queued for edit"]);
        const stopping = command("stop", {
          expectedForegroundExecutionId: supervisor.getSession(sessionId)?.foregroundExecutionId,
        });
        setTimeout(() => releaseFirst?.(), 100);
        assert.equal((await stopping).status, "accepted");
        const paused = await supervisor.getQueueCatalog(sessionId);
        assert.equal(paused.paused, true);
        let edited = await command("editQueueItem", { queueItemId: queued.followUp[0]!.id,
          newText: handled.text }, current().revision);
        for (let attempt = 0; edited.status === "stale" && attempt < 5; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          edited = await command("editQueueItem", { queueItemId: queued.followUp[0]!.id,
            newText: handled.text }, current().revision);
        }
        assert.equal(edited.status, "accepted", edited.message);
        assert.deepEqual((await supervisor.getQueueCatalog(sessionId)).followUp.map(item => item.text),
          [handled.text]);
        const sideEffectCount = () => handled.kind === "input"
          ? records.filter(record => record.method === "notify" &&
            record.message === "PI_GUI_INPUT_HANDLED_BY_EXTENSION").length
          : records.filter(record => record.type === "message_start" &&
            JSON.stringify(record).includes("pi-gui-compat.image")).length;
        const before = sideEffectCount();
        const promoted = await command("sendQueuedNow", { queueItemId: queued.followUp[0]!.id }, current().revision);
        assert.equal(promoted.status, "accepted", promoted.message);
        assert.equal(promotedOutcome, handled.kind === "command" ? "handledCommand" : "handledInput",
          JSON.stringify(await supervisor.getState(sessionId)));
        assert.equal(sideEffectCount(), before + 1, "the extension handled the promoted input exactly once");
        assert.equal(modelCalls.length, 1, "handled input cannot start a second model run");
        const after = await supervisor.getQueueCatalog(sessionId);
        assert.equal(after.paused, true);
        assert.deepEqual(after.followUp.map(item => item.id), [], "the same Pi item must be taken after handling");
        const native = service as unknown as { sessions: Map<string, { state: Record<string, unknown> }> };
        assert.equal(native.sessions.get(sessionId)?.state.piPendingIntent, undefined,
          "handled input has no Pi user turn to reconcile");
        const bookmark = JSON.parse(await readFile(join(root, "catalog", `${sessionId}.json`), "utf8")) as {
          pendingIntent?: unknown; queueRecovery?: unknown[] };
        assert.equal(bookmark.pendingIntent, undefined);
        assert.deepEqual(bookmark.queueRecovery, []);
        assert.equal((await command("setAutoDrain", { autoDrain: true }, current().revision)).status, "accepted");
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.equal(sideEffectCount(), before + 1, "resuming Pi's queue must not re-run the handled item");
        await service.dispose();
        service = undefined;
        const restartedSupervisor = new PiSessionSupervisor({
          piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
          env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
          rpcArgs: ["--offline", "--no-extensions", "-e",
            fileURLToPath(new URL("../../../examples/pi-gui-compat/extension.ts", import.meta.url)),
            "--no-skills", "--no-prompt-templates", "--no-context-files"],
        });
        reopened = new PiNativeV4Service(restartedSupervisor, join(root, "catalog"));
        if (directlyHandledIds.length > 0) {
          const query = await reopened.queryConversationCommandsV4({ workspacePath: root,
            commands: directlyHandledIds.map(commandId => ({ sessionId, commandId })) });
          assert.equal(query.results.length, directlyHandledIds.length);
          for (const item of query.results) {
            assert.notEqual(item.result, "unknown");
            if (item.result !== "unknown") {
              assert.equal(item.result.status, "accepted");
              assert.equal(item.result.reasonCode, "pi.inputHandledByExtension");
              assert.equal(item.result.result?.type, "inputAccepted");
              if (item.result.result?.type === "inputAccepted") {
                assert.equal(item.result.result.delivery, "startNow");
              }
            }
          }
        }
        assert.equal((await reopened.getPiSessionSummary({ workspacePath: root, sessionId })).phase,
          "completedSuccess", "reopened handled input remains usable");
        assert.equal((await restartedSupervisor.getQueueCatalog(sessionId)).followUp.length, 0);
        const next = await reopened.sendConversationCommandV4({ workspacePath: root, envelope: {
          commandId: randomUUID(), clientId: "handled-queue", sessionId, issuedAt: Date.now(),
          type: "sendText", payload: { text: "AFTER_HANDLED_REOPEN" },
        } });
        assert.equal(next.status, "accepted", next.message);
        for (let attempt = 0; attempt < 100 && modelCalls.length < 2; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(modelCalls.length, 2, "reopened Pi session accepts a new model turn exactly once");
      } finally {
        releaseFirst?.();
        await reopened?.dispose();
        await service?.dispose();
        model.closeAllConnections();
        await new Promise<void>(resolve => model.close(() => resolve()));
        assert.ok(resolve(root).startsWith(`${resolve(tempBase)}${sep}`));
        await rm(root, { recursive: true, force: true });
      }
    });
}
