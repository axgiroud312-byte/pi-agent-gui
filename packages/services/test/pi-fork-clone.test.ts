import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { on } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { decodePiHtmlSessionData } from "../src/pi-agent/pi-session-share.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("native fork and clone use real Pi entries and preserve source JSONL", { timeout: 240_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-fork-clone-"));
  const profile = join(workspacePath, "profile");
  const model = createServer(async (request, response) => {
    for await (const _ of request) { /* drain */ }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "fork-test", object: "chat.completion.chunk", created: 1,
      model: "fork-test", choices: [{ index: 0, delta: { role: "assistant", content: "FORK_ANSWER" },
        finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  const address = model.address();
  assert(address && typeof address !== "string");
  await mkdir(profile);
  await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "fork-provider": {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
    models: [{ id: "fork-test", reasoning: false, input: ["text", "image"] }],
  } } }));
  await writeFile(join(profile, "settings.json"), JSON.stringify({
    defaultProvider: "fork-provider", defaultModel: "fork-test",
  }));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  let publishedHtml: Buffer | undefined;
  let publishedCount = 0;
  const service = new PiNativeV4Service(supervisor, join(workspacePath, "catalog"), {
    publishGist: async file => {
      publishedCount++;
      publishedHtml = await readFile(file);
      return "https://gist.github.com/example/1234567890abcdef1234567890abcdef";
    },
  });
  let cancelledService: PiNativeV4Service | undefined;
  const command = (sessionId: string | null, type: string, payload: object,
    revision?: number, epoch?: string) => ({ workspacePath, envelope: {
    commandId: randomUUID(), clientId: "fork-test", sessionId, issuedAt: Date.now(), type, payload,
    ...(revision !== undefined ? { baseRevision: revision } : {}),
    ...(epoch ? { baseLogEpoch: epoch } : {}),
  } });
  try {
    const created = await service.sendConversationCommandV4(command(null, "createSession", { workspaceId: workspacePath }) as never);
    assert(created.result?.type === "createSession");
    const sourceId = created.result.sessionId;
    for (const text of ["first turn", "second turn"]) {
      const settled = (async () => {
        for await (const [id, event] of on(supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
          if (id === sourceId && event.type === "agent_settled") return;
        }
      })();
      const sent = await service.sendConversationCommandV4(command(sourceId, "sendText", { text }) as never);
      assert.equal(sent.status, "accepted", sent.message);
      await settled;
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sourceId);
    }
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
    const imagePath = join(workspacePath, "fork-image.png");
    await writeFile(imagePath, png);
    const imageSettled = (async () => {
      for await (const [id, event] of on(supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
        if (id === sourceId && event.type === "agent_settled") return;
      }
    })();
    const imageSend = await service.sendConversationCommandV4(command(sourceId, "sendText", { text: "image turn",
      attachments: [{ ref: imagePath, fileName: "fork-image.png", mime: "image/png", bytes: png.length }] }) as never);
    assert.equal(imageSend.status, "accepted", imageSend.message);
    await imageSettled;
    await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sourceId);
    const sourceView = supervisor.getSession(sourceId);
    assert(sourceView);
    const original = await readFile(sourceView.sessionFile, "utf8");
    const entries = await supervisor.command(sourceId, { type: "get_entries" }) as {
      entries: Array<{ id: string; type: string; message?: { role?: string; content?: unknown } }> };
    const users = entries.entries.filter(entry => entry.type === "message" && entry.message?.role === "user");
    assert.equal(users.length, 3);
    const range = await service.conversationRowsRangeV4({ workspacePath, sessionId: sourceId, limit: 100 });
    const imageFork = await service.sendConversationCommandV4(command(sourceId, "forkPiEntry",
      { entryId: users[2]!.id }, range.atRevision, range.atLogEpoch) as never);
    assert.equal(imageFork.status, "failed");
    assert.equal(imageFork.reasonCode, "pi.forkImageUnsupported");
    assert.equal(await readFile(sourceView.sessionFile, "utf8"), original);
    const stale = await service.sendConversationCommandV4(command(sourceId, "forkPiEntry",
      { entryId: users[1]!.id }, range.atRevision + 1, range.atLogEpoch) as never);
    assert.equal(stale.status, "stale", "a stale tree must not fork a different Pi entry");
    const unknown = await service.sendConversationCommandV4(command(sourceId, "forkPiEntry",
      { entryId: "not-an-active-user-entry" }, range.atRevision, range.atLogEpoch) as never);
    assert.equal(unknown.status, "failed", "an unavailable entry must fail before the Pi fork command");
    const fork = await service.sendConversationCommandV4(command(sourceId, "forkPiEntry",
      { entryId: users[1]!.id }, range.atRevision, range.atLogEpoch) as never);
    assert.equal(fork.status, "accepted", fork.message);
    assert(fork.result?.type === "forkAssistant");
    assert.equal(fork.result.restoredText, "second turn");
    const childId = fork.result.sessionId;
    assert.notEqual(childId, sourceId);
    assert.equal(supervisor.getSession(sourceId), undefined, "source process should no longer own the source JSONL");
    assert(supervisor.getSession(childId), "child must be rebound to a leased Pi process");
    await assert.rejects(stat(`${sourceView.sessionFile}.pi-agent-ide.lock`), { code: "ENOENT" });
    assert((await stat(`${supervisor.getSession(childId)!.sessionFile}.pi-agent-ide.lock`)).isFile());
    assert.equal(await readFile(sourceView.sessionFile, "utf8"), original, "fork must preserve original JSONL");
    const childHistory = JSON.stringify(await supervisor.getHistoryMessages(childId));
    assert.match(childHistory, /first turn/);
    assert.doesNotMatch(childHistory, /second turn/);
    const childView = supervisor.getSession(childId)!;
    const childOriginal = await readFile(childView.sessionFile, "utf8");
    const childRange = await service.conversationRowsRangeV4({ workspacePath, sessionId: childId, limit: 100 });
    const clone = await service.sendConversationCommandV4(command(childId, "clonePiSession", {},
      childRange.atRevision, childRange.atLogEpoch) as never);
    assert.equal(clone.status, "accepted", clone.message);
    assert(clone.result?.type === "forkAssistant");
    assert.notEqual(clone.result.sessionId, childId);
    assert.equal(await readFile(childView.sessionFile, "utf8"), childOriginal, "clone must preserve its parent JSONL");
    assert.equal(JSON.stringify(await supervisor.getHistoryMessages(clone.result.sessionId)), childHistory,
      "clone must start from the same Pi branch while retaining a separate session identity");
    console.log("[pi-fork-clone] transfer preview");
    const preview = await service.readPiSessionTransfer({ workspacePath, sessionId: clone.result.sessionId });
    assert(preview.revision && preview.lastAssistantText === "FORK_ANSWER");
    const exportsDir = join(workspacePath, "exports");
    await mkdir(exportsDir);
    const jsonl = await service.exportPiSession({ workspacePath, sessionId: clone.result.sessionId,
      expectedRevision: preview.revision, format: "jsonl", directory: exportsDir });
    assert(jsonl.path.endsWith(".jsonl"));
    const exportedBytes = await readFile(jsonl.path);
    assert.deepEqual(exportedBytes, await readFile(supervisor.getSession(clone.result.sessionId)!.sessionFile));
    console.log("[pi-fork-clone] Pi HTML export");
    const html = await service.exportPiSession({ workspacePath, sessionId: clone.result.sessionId,
      expectedRevision: preview.revision, format: "html", directory: exportsDir });
    assert.match(decodePiHtmlSessionData(await readFile(html.path, "utf8")), /first turn/);
    console.log("[pi-fork-clone] Pi JSONL import");
    const imported = await service.importPiSession({ workspacePath, sourcePath: jsonl.path });
    assert.notEqual(imported.sessionId, clone.result.sessionId);
    assert.match(JSON.stringify(await supervisor.getHistoryMessages(imported.sessionId)), /first turn/);
    const importedState = await supervisor.getState(imported.sessionId);
    assert.deepEqual(
      importedState.model && typeof importedState.model === "object"
        ? { provider: (importedState.model as { provider?: string }).provider,
          id: (importedState.model as { id?: string }).id }
        : null,
      { provider: "fork-provider", id: "fork-test" },
      "the imported Pi process must restore its model from JSONL before the native composer can send",
    );
    assert.deepEqual(await readFile(jsonl.path), exportedBytes, "import must not rewrite source JSONL");
    const unknownSource = join(workspacePath, "unknown-entry.jsonl");
    const unknownLines = exportedBytes.toString("utf8").trimEnd().split("\n");
    const unknownEntryIndex = unknownLines.findIndex(line => JSON.parse(line).type === "message");
    assert(unknownEntryIndex > 0);
    const unknownEntry = JSON.parse(unknownLines[unknownEntryIndex]!) as Record<string, unknown>;
    unknownEntry.futureExtensionField = { nested: ["kept", 42] };
    unknownLines[unknownEntryIndex] = JSON.stringify(unknownEntry);
    const unknownSourceBytes = Buffer.from(unknownLines.join("\n") + "\n");
    await writeFile(unknownSource, unknownSourceBytes);
    const unknownImported = await service.importPiSession({ workspacePath, sourcePath: unknownSource });
    const unknownChild = (await readFile(supervisor.getSession(unknownImported.sessionId)!.sessionFile, "utf8"))
      .trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    assert(unknownChild.some(entry => JSON.stringify(entry.futureExtensionField) ===
      JSON.stringify({ nested: ["kept", 42] })), "Pi import must retain unknown entry fields");
    assert.deepEqual(await readFile(unknownSource), unknownSourceBytes);
    const missingNewline = join(workspacePath, "missing-newline.jsonl");
    await writeFile(missingNewline, exportedBytes.subarray(0, -1));
    await assert.rejects(service.importPiSession({ workspacePath, sourcePath: missingNewline }),
      /newline/, "Pi's loader otherwise repairs the import source in place");
    assert.deepEqual(await readFile(missingNewline), exportedBytes.subarray(0, -1));
    console.log("[pi-fork-clone] Pi share preview and local fake publication");
    const sharePreview = await service.preparePiSessionShare({ workspacePath,
      sessionId: clone.result.sessionId, expectedRevision: preview.revision });
    assert.match(sharePreview.sessionDataJson, /first turn/);
    assert.match(sharePreview.sessionDataJson, /systemPrompt/);
    assert.equal(sharePreview.bytes, Buffer.byteLength(sharePreview.html));
    await assert.rejects(service.publishPiSessionShare({ workspacePath,
      sessionId: clone.result.sessionId, token: sharePreview.token, confirmed: false }), /confirm/i);
    assert.equal(publishedHtml, undefined, "preview alone must not publish a Gist");
    const shared = await service.publishPiSessionShare({ workspacePath,
      sessionId: clone.result.sessionId, token: sharePreview.token, confirmed: true });
    assert.deepEqual(publishedHtml, Buffer.from(sharePreview.html), "publish exactly the reviewed Pi HTML");
    assert.equal(shared.viewerUrl, "https://pi.dev/session/#1234567890abcdef1234567890abcdef");
    await assert.rejects(service.publishPiSessionShare({ workspacePath,
      sessionId: clone.result.sessionId, token: sharePreview.token, confirmed: true }), /expired|used/i);
    const staleShare = await service.preparePiSessionShare({ workspacePath,
      sessionId: clone.result.sessionId, expectedRevision: preview.revision });
    await supervisor.command(clone.result.sessionId, { type: "set_session_name", name: "transfer-changed" });
    await assert.rejects(service.publishPiSessionShare({ workspacePath,
      sessionId: clone.result.sessionId, token: staleShare.token, confirmed: true }), /history changed/);
    assert.equal(publishedCount, 1, "changed Pi history must not trigger external publication");
    await assert.rejects(service.exportPiSession({ workspacePath, sessionId: clone.result.sessionId,
      expectedRevision: preview.revision, format: "jsonl", directory: exportsDir }), /history changed/);
    await service.dispose();
    const cancelExtension = join(workspacePath, "cancel-branch.ts");
    await writeFile(cancelExtension, `export default function (pi) {
      pi.on("session_before_fork", () => ({ cancel: true }));
    }`);
    const cancelledSupervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--extension", cancelExtension],
    });
    cancelledService = new PiNativeV4Service(cancelledSupervisor, join(workspacePath, "catalog"));
    await cancelledService.getPiSessionSummary({ workspacePath, sessionId: sourceId });
    const beforeCancelled = await readFile(sourceView.sessionFile, "utf8");
    const cancelRange = await cancelledService.conversationRowsRangeV4({ workspacePath, sessionId: sourceId, limit: 100 });
    const cancelledFork = await cancelledService.sendConversationCommandV4(command(sourceId, "forkPiEntry",
      { entryId: users[1]!.id }, cancelRange.atRevision, cancelRange.atLogEpoch) as never);
    assert.equal(cancelledFork.status, "noop", cancelledFork.message);
    assert.equal(cancelledFork.reasonCode, "pi.branchCancelled");
    const afterFork = cancelledSupervisor.getSession(sourceId);
    assert(afterFork && afterFork.sessionFile === sourceView.sessionFile);
    assert.equal(await readFile(sourceView.sessionFile, "utf8"), beforeCancelled);
    const cloneRange = await cancelledService.conversationRowsRangeV4({ workspacePath, sessionId: sourceId, limit: 100 });
    const cancelledClone = await cancelledService.sendConversationCommandV4(command(sourceId, "clonePiSession", {},
      cloneRange.atRevision, cloneRange.atLogEpoch) as never);
    assert.equal(cancelledClone.status, "noop", cancelledClone.message);
    assert.equal(cancelledClone.reasonCode, "pi.branchCancelled");
    assert.equal(cancelledSupervisor.getSession(sourceId)?.sessionId, sourceId);
    assert.equal(await readFile(sourceView.sessionFile, "utf8"), beforeCancelled,
      "cancelled Pi fork/clone must not replace or rewrite the source JSONL");
  } finally {
    await cancelledService?.dispose();
    await service.dispose();
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});
