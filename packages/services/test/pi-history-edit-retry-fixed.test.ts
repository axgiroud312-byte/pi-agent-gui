import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { on } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("pinned Pi retries a real historical image entry on a new branch and edits text only after explicit send",
  { timeout: 120_000 }, async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "pi-history-retry-"));
    const profile = join(workspacePath, "profile");
    const requests: string[] = [];
    const model = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ id: `history-${requests.length}`, object: "chat.completion.chunk", created: 1,
        model: "history-test", choices: [{ index: 0, delta: { role: "assistant", content: `ANSWER_${requests.length}` },
          finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
      const address = model.address();
      assert(address && typeof address !== "string");
      await mkdir(profile);
      await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "history-provider": {
        baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
        models: [{ id: "history-test", reasoning: false, input: ["text", "image"] }],
      } } }));
      await writeFile(join(profile, "settings.json"), JSON.stringify({
        defaultProvider: "history-provider", defaultModel: "history-test",
      }));
      const extension = fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url));
      const cancellationFlag = join(workspacePath, "cancel-next-tree");
      const cancellationExtension = join(workspacePath, "cancel-tree.ts");
      await writeFile(cancellationExtension, `import { existsSync } from "node:fs";
export default function(pi) { pi.on("session_before_tree", () => existsSync(${JSON.stringify(cancellationFlag)})
  ? { cancel: true } : undefined); }`);
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
        rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
          "--extension", extension, "--extension", cancellationExtension],
      });
      service = new PiNativeV4Service(supervisor, join(workspacePath, "catalog"));
      const command = (sessionId: string | null, type: string, payload: object,
        revision?: number, epoch?: string) => ({ workspacePath, envelope: {
        commandId: randomUUID(), clientId: "history-test", sessionId, issuedAt: Date.now(), type, payload,
        ...(revision !== undefined ? { baseRevision: revision } : {}),
        ...(epoch ? { baseLogEpoch: epoch } : {}),
      } });
      const retryOnCurrentSnapshot = async (sessionId: string, entryId: string) => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const range = await service!.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
          const ack = await service!.sendConversationCommandV4(command(sessionId, "retryPiEntry",
            { entryId }, range.atRevision, range.atLogEpoch) as never);
          if (ack.status !== "stale") return ack;
          assert.equal(ack.reasonCode, "pi.branchSnapshotChanged");
        }
        throw new Error("Pi snapshot kept changing before retry admission");
      };
      const settledAfter = () => (async () => {
        for await (const [id, event] of on(supervisor, "record", { signal: AbortSignal.timeout(25_000) })) {
          if (id === sessionId && event.type === "agent_settled") return;
        }
      })();
      const created = await service.sendConversationCommandV4(command(null, "createSession",
        { workspaceId: workspacePath }) as never);
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("Pi session creation failed");
      const sessionId = created.result.sessionId;
      let settled = settledAfter();
      const first = await service.sendConversationCommandV4(command(sessionId, "sendText",
        { text: "first historical input" }) as never);
      assert.equal(first.status, "accepted", first.message);
      await settled;
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
      const imagePath = join(workspacePath, "history.png");
      await writeFile(imagePath, png);
      settled = settledAfter();
      const imageSend = await service.sendConversationCommandV4(command(sessionId, "sendText", {
        text: "historical image input",
        attachments: [{ ref: imagePath, fileName: "history.png", mime: "image/png", bytes: png.length }],
      }) as never);
      assert.equal(imageSend.status, "accepted", imageSend.message);
      await settled;
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      const source = supervisor.getSession(sessionId)!;
      const original = await readFile(source.sessionFile);
      const entriesBefore = await supervisor.command(sessionId, { type: "get_entries" }) as {
        entries: Array<{ id: string; type: string; parentId: string | null;
          message?: { role?: string; content?: Array<{ type: string; data?: string }> } }> };
      const users = entriesBefore.entries.filter(entry => entry.type === "message" && entry.message?.role === "user");
      assert.equal(users.length, 2);
      assert.equal(users[1]?.message?.content?.find(part => part.type === "image")?.data,
        png.toString("base64"), "Pi JSONL is the original image source");
      const beforeRange = await service.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
      assert(beforeRange.atRevision > 0);
      const stale = await service.sendConversationCommandV4(command(sessionId, "retryPiEntry",
        { entryId: users[1]!.id }, beforeRange.atRevision - 1, beforeRange.atLogEpoch) as never);
      assert.equal(stale.status, "stale");
      assert.deepEqual(await readFile(source.sessionFile), original);
      settled = settledAfter();
      const retry = await retryOnCurrentSnapshot(sessionId, users[1]!.id);
      assert.equal(retry.status, "accepted", retry.message);
      assert.equal(retry.result?.type, "inputAccepted");
      await settled;
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      assert.equal(requests.length, 3, "one Pi retry produces exactly one new provider request");
      assert(requests[2]?.includes(png.toString("base64")), "new provider call retains image bytes");
      const afterRetry = await readFile(source.sessionFile);
      assert(afterRetry.subarray(0, original.length).equals(original), "retry appends; old Pi JSONL is unchanged");
      const entriesAfter = await supervisor.command(sessionId, { type: "get_entries" }) as typeof entriesBefore;
      const userCopies = entriesAfter.entries.filter(entry => entry.type === "message" &&
        entry.message?.role === "user" && entry.message.content?.some(part => part.type === "image"));
      assert.equal(userCopies.length, 2);
      assert.equal(userCopies[1]?.message?.content?.find(part => part.type === "image")?.data,
        png.toString("base64"));
      const tree = await service.readPiControlTree({ workspacePath, sessionId });
      const edited = await service.runPiControlTree({ workspacePath, sessionId, action: {
        operation: "navigate", targetId: users[0]!.id, summarize: false,
        sessionId, generation: tree.info.generation,
      } });
      assert.equal(edited.result?.editorText, "first historical input");
      assert.equal(requests.length, 3, "entering edit must not silently start a Pi run");
      const afterEditNavigation = await readFile(source.sessionFile);
      assert(afterEditNavigation.subarray(0, afterRetry.length).equals(afterRetry));
      settled = settledAfter();
      const editedSend = await service.sendConversationCommandV4(command(sessionId, "sendText",
        { text: "edited historical input" }) as never);
      assert.equal(editedSend.status, "accepted", editedSend.message);
      await settled;
      assert.equal(requests.length, 4);
      const finalEntries = await supervisor.command(sessionId, { type: "get_entries" }) as typeof entriesBefore;
      assert(finalEntries.entries.some(entry => entry.type === "message" && entry.message?.role === "user" &&
        entry.message.content?.some(part => part.type === "text" && "text" in part &&
          part.text === "edited historical input")), "Pi owns the edited branch's new user entry");
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      const beforeCancel = await readFile(source.sessionFile);
      await writeFile(cancellationFlag, "cancel");
      const cancelled = await retryOnCurrentSnapshot(sessionId, users[0]!.id);
      assert.equal(cancelled.status, "noop", "Pi extension cancellation is an explicit no-op");
      assert.equal(cancelled.reasonCode, "pi.branchCancelled");
      assert.equal(requests.length, 4, "cancelled retry cannot reach the model");
      assert.deepEqual(await readFile(source.sessionFile), beforeCancel,
        "cancelled navigation leaves the original Pi JSONL unchanged");
      await rm(cancellationFlag);
      const referencedPath = join(workspacePath, "history-reference.txt");
      await writeFile(referencedPath, "ORIGINAL_REFERENCE_BYTES");
      settled = settledAfter();
      const referenced = await service.sendConversationCommandV4(command(sessionId, "sendText", {
        text: "inspect [history-reference.txt](<./history-reference.txt>)",
      }) as never);
      assert.equal(referenced.status, "accepted", referenced.message);
      await settled;
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      const entriesWithReference = await supervisor.command(sessionId, { type: "get_entries" }) as typeof entriesBefore;
      const originalReference = entriesWithReference.entries.find(entry => entry.type === "message" &&
        entry.message?.role === "user" && entry.message.content?.some(part => part.type === "text" &&
          "text" in part && typeof part.text === "string" && part.text.includes("ORIGINAL_REFERENCE_BYTES")));
      assert(originalReference);
      const referenceText = originalReference.message!.content!.find(part => part.type === "text") as
        { type: "text"; text: string };
      assert.equal(referenceText.text.match(/Pi file snapshots captured at send time/gu)?.length, 1);
      await writeFile(referencedPath, "CHANGED_REFERENCE_BYTES");
      settled = settledAfter();
      const referenceRetry = await retryOnCurrentSnapshot(sessionId, originalReference.id);
      assert.equal(referenceRetry.status, "accepted", referenceRetry.message);
      await settled;
      const afterReferenceRetry = await supervisor.command(sessionId, { type: "get_entries" }) as typeof entriesBefore;
      const replayedReference = afterReferenceRetry.entries.filter(entry => entry.type === "message" &&
        entry.message?.role === "user" && entry.message.content?.some(part => part.type === "text" &&
          "text" in part && part.text === referenceText.text));
      assert.equal(replayedReference.length, 2, "Pi retry reuses old captured bytes without a second snapshot");
      assert.equal(requests.at(-1)?.includes("CHANGED_REFERENCE_BYTES"), false);
    } finally {
      await service?.dispose();
      model.closeAllConnections();
      await new Promise<void>(resolve => model.close(() => resolve()));
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
