import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("native queue keeps Pi-owned image through Stop, reorder, edit, send now and resume",
  { timeout: 60_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-queue-"));
    const profile = join(root, "profile");
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
    const imagePath = join(root, "queued.png");
    const bodies: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let firstArrived: (() => void) | undefined;
    const first = new Promise<void>(resolve => { firstArrived = resolve; });
    const model = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      bodies.push(body);
      if (body.includes("HOLD_RUN")) {
        firstArrived?.();
        await new Promise<void>(resolve => { releaseFirst = resolve; });
      }
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ id: "queue-v4", object: "chat.completion.chunk", created: 1,
        model: "queue-v4", choices: [{ index: 0, delta: { role: "assistant", content: "DONE" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
      const address = model.address();
      assert.ok(address && typeof address !== "string");
      await mkdir(profile);
      await writeFile(imagePath, image);
      await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "queue-local": {
        baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "test-only",
        models: [{ id: "queue-v4", reasoning: false, input: ["text", "image"] }],
      } } }));
      await writeFile(join(profile, "settings.json"), JSON.stringify({
        defaultProvider: "queue-local", defaultModel: "queue-v4",
      }));
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
        rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
      });
      service = new PiNativeV4Service(supervisor, join(root, "catalog"));
      const create = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: "queue-v4-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: root },
      } });
      assert.equal(create.status, "accepted", create.message);
      if (create.result?.type !== "createSession") throw new Error("Pi session was not created");
      const sessionId = create.result.sessionId;
      const current = (): ConversationSnapshot => {
        const records = service as unknown as { sessions: Map<string, { snapshot: ConversationSnapshot }> };
        return records.sessions.get(sessionId)!.snapshot;
      };
      const command = (type: string, payload: unknown, baseRevision?: number) => service!.sendConversationCommandV4({
        workspacePath: root, envelope: { commandId: randomUUID(), clientId: "queue-v4-test", sessionId,
          issuedAt: Date.now(), type, payload, ...(baseRevision === undefined ? {} : { baseRevision }) },
      });
      assert.equal((await command("sendText", { text: "HOLD_RUN" })).status, "accepted");
      await first;
      assert.equal((await command("sendText", { text: "queued image", requestedDelivery: "queue",
        attachments: [{ ref: imagePath, fileName: "queued.png", mime: "image/png", bytes: image.length }] })).status, "accepted");
      assert.equal((await command("sendText", { text: "edit me", requestedDelivery: "queue" })).status, "accepted");
      assert.equal((await command("sendText", { text: "delete me", requestedDelivery: "queue" })).status, "accepted");
      const before = await supervisor.getQueueCatalog(sessionId);
      assert.deepEqual(before.followUp.map(item => item.text), ["queued image", "edit me", "delete me"]);
      const stopPromise = command("stop", { expectedForegroundExecutionId: supervisor.getSession(sessionId)?.foregroundExecutionId });
      setTimeout(() => releaseFirst?.(), 150);
      const stopped = await stopPromise;
      assert.equal(stopped.status, "accepted", stopped.message);
      const paused = await supervisor.getQueueCatalog(sessionId);
      assert.equal(paused.paused, true);
      assert.equal((await supervisor.getState(sessionId)).pendingMessageCount, 3);
      const activeImage = await supervisor.readQueueItem(sessionId, paused.revision, before.followUp[0]!.id);
      assert.deepEqual(Buffer.from(activeImage.images[0]!.data, "base64"), image);
      const refreshes = (service as unknown as { queueRefreshes: Map<string, Promise<void>> }).queueRefreshes;
      await refreshes.get(sessionId);
      const snapshot = current();
      assert.equal(snapshot.queue.items[0]?.queueItemId, before.followUp[0]!.id);
      assert.equal(snapshot.queue.items[0]?.attachments.length, 1);
      assert.deepEqual(await readFile(snapshot.queue.items[0]!.attachments[0]!.ref), image);
      const queueImageRef = snapshot.queue.items[0]!.attachments[0]!.ref;
      const readQueuedImage = (override: Record<string, unknown> = {}) => service!.attachmentReadV4({
        workspacePath: root, sessionId, queueItemId: before.followUp[0]!.id,
        attachmentIndex: 0, ref: queueImageRef, offset: 0, limit: 1024, ...override,
      });
      const queuedImageBytes = await readQueuedImage();
      assert.deepEqual(Buffer.from(queuedImageBytes.dataBase64, "base64"), image,
        "a restricted queue item read returns Pi's exact image before deletion");
      await assert.rejects(readQueuedImage({ queueItemId: before.followUp[1]!.id }),
        /queued image ref does not match|no longer in this session queue/);
      await assert.rejects(readQueuedImage({ ref: "unrelated" }), /queued image ref does not match/);
      await assert.rejects(readQueuedImage({ attachmentIndex: 1 }), /queued image ref does not match/);
      await assert.rejects(readQueuedImage({ workspacePath: join(root, "other-workspace") }));
      const bookmark = JSON.parse(await readFile(join(root, "catalog", `${sessionId}.json`), "utf8")) as {
        queueRecovery: Array<{ id: string; attachments: Array<{ ref: string }> }>;
      };
      assert.equal(bookmark.queueRecovery[0]?.id, before.followUp[0]!.id);
      assert.deepEqual(await readFile(bookmark.queueRecovery[0]!.attachments[0]!.ref), image,
        "an interrupted Pi queue retains exact image bytes outside the transient upload directory");
      assert.equal(snapshot.queue.autoDrain, false);
      assert.equal(snapshot.availability.queueEdit.allowed, true);
      assert.equal((await command("reorderQueueItem", { queueItemId: before.followUp[1]!.id,
        beforeQueueItemId: before.followUp[0]!.id }, current().revision)).status, "accepted");
      assert.deepEqual((await supervisor.getQueueCatalog(sessionId)).followUp.map(item => item.text),
        ["edit me", "queued image", "delete me"]);
      assert.equal((await command("editQueueItem", { queueItemId: before.followUp[1]!.id,
        newText: "edited text" }, current().revision)).status, "accepted");
      assert.equal((await command("deleteQueueItem", { queueItemId: before.followUp[2]!.id },
        current().revision)).status, "accepted");
      assert.deepEqual((await supervisor.getQueueCatalog(sessionId)).followUp.map(item => item.text),
        ["edited text", "queued image"]);
      const sendNow = await command("sendQueuedNow", { queueItemId: before.followUp[0]!.id }, current().revision);
      assert.equal(sendNow.status, "accepted", sendNow.message);
      await assert.rejects(readQueuedImage(), /no longer in this session queue/);
      const afterPromotion = await supervisor.getQueueCatalog(sessionId);
      assert.equal(afterPromotion.paused, true);
      assert.deepEqual(afterPromotion.followUp.map(item => item.text), ["edited text"]);
      for (let i = 0; i < 100 && supervisor.getSession(sessionId)?.foregroundExecutionId; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const resumed = await command("setAutoDrain", { autoDrain: true }, current().revision);
      assert.equal(resumed.status, "accepted", resumed.message);
      for (let i = 0; i < 100 && (await supervisor.getQueueCatalog(sessionId)).followUp.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal((await supervisor.getQueueCatalog(sessionId)).paused, false);
      assert.equal((await supervisor.getQueueCatalog(sessionId)).followUp.length, 0);
      assert.ok(bodies.some(body => body.includes("data:image/png;base64,")), "promoted image reached the model");
      const history = await supervisor.getHistoryMessages(sessionId);
      assert.equal(history.filter(message => typeof message === "object" && message !== null &&
        (message as { role?: string }).role === "user" &&
        JSON.stringify((message as { content?: unknown }).content).includes("queued image")).length, 1,
      "Pi history contains one promoted image input");
    } finally {
      releaseFirst?.();
      await service?.dispose();
      model.closeAllConnections();
      await new Promise<void>(resolve => model.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
