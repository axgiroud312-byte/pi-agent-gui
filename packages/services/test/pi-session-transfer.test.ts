import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { decodePiHtmlSessionData, parsePiGistUrl } from "../src/pi-agent/pi-session-share.js";
import { copyPiExport, readPiImportSource, validatePiImportBytes } from "../src/pi-agent/pi-session-transfer.js";

function history(cwd: string): Buffer {
  return Buffer.from([
    { type: "session", version: CURRENT_SESSION_VERSION, id: randomUUID(),
      timestamp: new Date().toISOString(), cwd, unknownHeader: { kept: true } },
    { type: "message", id: "user-1", parentId: null, timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text: "first" }] }, unknownEntry: [1, 2, 3] },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
}

test("Pi JSONL import validates without repairing or rewriting source bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-transfer-validator-"));
  try {
    const source = join(directory, "source.jsonl");
    const original = history(directory);
    await writeFile(source, original);
    assert.equal(validatePiImportBytes(original).entryCount, 1);
    assert.deepEqual((await readPiImportSource(source)).bytes, original);
    assert.deepEqual(await readFile(source), original);

    const noNewline = original.subarray(0, -1);
    await writeFile(source, noNewline);
    await assert.rejects(readPiImportSource(source), /newline/);
    assert.deepEqual(await readFile(source), noNewline, "Pi's loader must never get a chance to repair source");

    const blankLine = Buffer.from(original.toString().replace("\n{\"type\":\"message\"", "\n\n{\"type\":\"message\""));
    assert.throws(() => validatePiImportBytes(blankLine), /blank/);
    const danglingParent = Buffer.from(original.toString().replace('"parentId":null', '"parentId":"missing"'));
    assert.throws(() => validatePiImportBytes(danglingParent), /parent/);
    const forwardParent = Buffer.from(original.toString().replace('"parentId":null', '"parentId":"user-1"'));
    assert.throws(() => validatePiImportBytes(forwardParent), /parent/,
      "Pi's append-only tree cannot have forward or cyclic parent links");
    const legacy = Buffer.from(original.toString().replace(`"version":${CURRENT_SESSION_VERSION}`, '"version":2'));
    assert.throws(() => validatePiImportBytes(legacy), /unsupported/,
      "Pi forkFrom does not migrate old entry schemas before assigning a current header");
    assert.throws(() => validatePiImportBytes(Buffer.from([0xff, 0xfe, 0x0a])), /UTF-8/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Pi JSONL export creates a new file and never overwrites a destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-transfer-export-"));
  try {
    const source = join(directory, "source.jsonl");
    const destination = join(directory, "copy.jsonl");
    const original = history(directory);
    await writeFile(source, original);
    await copyPiExport(source, destination, "jsonl");
    assert.deepEqual(await readFile(destination), original);
    if (process.platform !== "win32") assert.equal((await stat(destination)).mode & 0o077, 0);
    await assert.rejects(copyPiExport(source, destination, "jsonl"), { code: "EEXIST" });
    assert.deepEqual(await readFile(destination), original);
    const failedDestination = join(directory, "failed.jsonl");
    await assert.rejects(copyPiExport(join(directory, "missing.jsonl"), failedDestination, "jsonl"),
      { code: "ENOENT" });
    await assert.rejects(stat(failedDestination), { code: "ENOENT" },
      "a failed copy must remove only its own newly created destination");
    await writeFile(failedDestination, "available", { flag: "wx" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Pi secret Gist output is constrained to an HTTPS Gist identity", () => {
  assert.deepEqual(parsePiGistUrl("https://gist.github.com/example/1234567890abcdef1234567890abcdef"), {
    gistUrl: "https://gist.github.com/example/1234567890abcdef1234567890abcdef",
    viewerUrl: "https://pi.dev/session/#1234567890abcdef1234567890abcdef",
  });
  assert.throws(() => parsePiGistUrl("https://evil.example/1234567890abcdef1234567890abcdef"), /unexpected/);
  assert.throws(() => parsePiGistUrl("https://gist.github.com/example/invalid"), /unexpected/);
  const data = { header: { id: randomUUID() }, entries: [{ type: "message", secret: "visible before sharing" }],
    systemPrompt: "system prompt is also external data", tools: [{ name: "read" }] };
  const html = `<script id="session-data" type="application/json">${Buffer.from(JSON.stringify(data)).toString("base64")}</script>`;
  assert.deepEqual(JSON.parse(decodePiHtmlSessionData(html)), data);
  assert.throws(() => decodePiHtmlSessionData("<html></html>"), /reviewable/);
});
