import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { piSessionDirectory } from "../src/pi-agent/pi-session-path.js";
import { readPiSettingsDocuments, savePiSettingsDocument } from "../src/pi-agent/pi-settings-documents.js";

test("Pi settings show user/project source and preserve unknown fields through a scoped edit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-documents-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await mkdir(agentDir);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultModel: "user-model", retry: { enabled: true, maxRetries: 2 }, futureKey: { keep: "user" },
    }));
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({
      defaultModel: "project-model", retry: { maxRetries: 4 }, projectOnly: 17,
    }));
    const before = await readPiSettingsDocuments(cwd, { PI_CODING_AGENT_DIR: agentDir });
    assert.equal(before.projectTrusted, false, "untrusted project settings must not be reported as effective");
    assert.equal(before.effective.defaultModel, "user-model");
    assert.equal(before.sources.defaultModel, "user");
    assert.equal(before.sourcePaths["/retry/enabled"], "user");
    assert.equal(before.project.parsed?.defaultModel, "project-model", "project file remains inspectable");
    const approved = await readPiSettingsDocuments(cwd, { PI_CODING_AGENT_DIR: agentDir }, ["--approve"]);
    assert.equal(approved.projectTrusted, true);
    assert.equal(approved.effective.defaultModel, "project-model");
    assert.equal(approved.sourcePaths["/retry/maxRetries"], "project");
    assert.equal(approved.sourcePaths["/retry/enabled"], "user");
    const saved = await savePiSettingsDocument(cwd, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: before.user.revision,
      text: JSON.stringify({ ...before.user.parsed, defaultModel: "edited-model" }),
    });
    assert.equal(saved.effective.defaultModel, "edited-model");
    assert.deepEqual(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")).futureKey, { keep: "user" });
    assert.deepEqual((await readdir(agentDir)).filter(name => name.endsWith(".tmp") || name.endsWith(".lock")), []);
    assert.equal(SettingsManager.create(cwd, agentDir, { projectTrusted: false }).getDefaultModel(), "edited-model");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi settings respect Pi's lock directory and leave the original document intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-lock-"));
  const agentDir = join(root, "agent");
  try {
    await mkdir(agentDir);
    const path = join(agentDir, "settings.json");
    await writeFile(path, '{"defaultModel":"before"}');
    const before = await readPiSettingsDocuments(root, { PI_CODING_AGENT_DIR: agentDir });
    await mkdir(`${path}.lock`);
    await assert.rejects(savePiSettingsDocument(root, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: before.user.revision, text: '{"defaultModel":"mine"}',
    }), /busy/i);
    assert.equal(await readFile(path, "utf8"), '{"defaultModel":"before"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi settings reject stale revisions and invalid JSON without overwriting external changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-conflict-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  try {
    await mkdir(cwd);
    await mkdir(agentDir);
    const path = join(agentDir, "settings.json");
    await writeFile(path, '{"defaultModel":"before","unknown":true}');
    const before = await readPiSettingsDocuments(cwd, { PI_CODING_AGENT_DIR: agentDir });
    await writeFile(path, '{"defaultModel":"external","unknown":true}');
    await assert.rejects(savePiSettingsDocument(cwd, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: before.user.revision, text: '{"defaultModel":"mine"}',
    }), /changed outside|conflict/i);
    await assert.rejects(savePiSettingsDocument(cwd, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: createHash("sha256").update(await readFile(path)).digest("hex"),
      text: '{"defaultModel":',
    }), /invalid JSON/i);
    assert.equal(await readFile(path, "utf8"), '{"defaultModel":"external","unknown":true}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi settings surface bad existing JSON and do not permit it to be silently replaced", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-invalid-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  try {
    await mkdir(cwd);
    await mkdir(agentDir);
    const path = join(agentDir, "settings.json");
    await writeFile(path, '{broken');
    const snapshot = await readPiSettingsDocuments(cwd, { PI_CODING_AGENT_DIR: agentDir });
    assert.match(snapshot.user.error ?? "", /invalid JSON/i);
    await assert.rejects(savePiSettingsDocument(cwd, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: snapshot.user.revision, text: '{}',
    }), /invalid JSON/i);
    assert.equal(await readFile(path, "utf8"), '{broken');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi settings refuse malformed UTF-8 bytes even when JSON structure looks valid", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-encoding-"));
  const agentDir = join(root, "agent");
  try {
    await mkdir(agentDir);
    const path = join(agentDir, "settings.json");
    await writeFile(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
    const snapshot = await readPiSettingsDocuments(root, { PI_CODING_AGENT_DIR: agentDir });
    assert.match(snapshot.user.error ?? "", /UTF-8/i);
    await assert.rejects(savePiSettingsDocument(root, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: snapshot.user.revision, text: '{}',
    }), /UTF-8/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native Pi service exposes scoped settings through its Host RPC seam", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-host-"));
  const agentDir = join(root, "agent");
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, rpcArgs: ["--no-approve"],
  });
  const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
  try {
    await mkdir(agentDir);
    await writeFile(join(agentDir, "settings.json"), '{"defaultModel":"service-model"}');
    const snapshot = await service.readPiSettings({ workspacePath: root });
    assert.equal(snapshot.effective.defaultModel, "service-model");
    assert.equal(snapshot.offline, true);
    const saved = await service.savePiSettings({ workspacePath: root, scope: "user",
      expectedRevision: snapshot.user.revision, text: '{"defaultModel":"saved-model"}' });
    assert.equal(saved.effective.defaultModel, "saved-model");
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("a newly started pinned Pi RPC session uses a saved user default model", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-real-rpc-"));
  const agentDir = join(root, "agent");
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  try {
    await mkdir(agentDir);
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: {
      "settings-test": { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", apiKey: "local-test-only",
        models: [{ id: "first" }, { id: "selected" }] },
    } }));
    await writeFile(join(agentDir, "settings.json"), '{"defaultProvider":"settings-test","defaultModel":"first"}');
    const before = await readPiSettingsDocuments(root, { PI_CODING_AGENT_DIR: agentDir });
    await savePiSettingsDocument(root, { PI_CODING_AGENT_DIR: agentDir }, { scope: "user",
      expectedRevision: before.user.revision,
      text: '{"defaultProvider":"settings-test","defaultModel":"selected"}' });
    const created = await supervisor.createSession(root);
    const state = await supervisor.getState(created.sessionId);
    assert.equal((state.model as { provider?: string; id?: string } | undefined)?.provider, "settings-test");
    assert.equal((state.model as { provider?: string; id?: string } | undefined)?.id, "selected");
  } finally {
    await supervisor.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("native session path follows Pi settings with CLI and environment precedence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-session-dir-"));
  const agentDir = join(root, "agent");
  try {
    await mkdir(join(root, ".pi"));
    await mkdir(agentDir);
    await writeFile(join(agentDir, "settings.json"), '{"sessionDir":"user-sessions"}');
    await writeFile(join(root, ".pi", "settings.json"), '{"sessionDir":"project-sessions"}');
    const env = { PI_CODING_AGENT_DIR: agentDir };
    assert.equal(await piSessionDirectory(root, env, []), join(root, "project-sessions"));
    assert.equal((await readPiSettingsDocuments(root, env)).sessionDirectory, join(root, "project-sessions"));
    assert.equal(await piSessionDirectory(root, { ...env, PI_CODING_AGENT_SESSION_DIR: "env-sessions" }, []),
      join(root, "env-sessions"));
    assert.equal(await piSessionDirectory(root, { ...env, PI_CODING_AGENT_SESSION_DIR: "env-sessions" },
      ["--session-dir", "cli-sessions"]), join(root, "cli-sessions"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("advanced Pi settings reject a value that fixed Pi cannot use before replacing the document", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-invalid-value-"));
  const agentDir = join(root, "agent");
  try {
    await mkdir(agentDir);
    const path = join(agentDir, "settings.json");
    const original = '{"compaction":{"reserveTokens":16384},"futureKey":"keep"}';
    await writeFile(path, original);
    const before = await readPiSettingsDocuments(root, { PI_CODING_AGENT_DIR: agentDir });
    await assert.rejects(savePiSettingsDocument(root, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: before.user.revision,
      text: '{"compaction":{"reserveTokens":-1},"futureKey":"keep"}',
    }), /Invalid compaction\.reserveTokens/iu);
    await assert.rejects(savePiSettingsDocument(root, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: before.user.revision,
      text: '{"compaction":{"modelOverrides":{"fixture/model":{"keepRecentTokens":-1}}}}',
    }), /Invalid compaction\.modelOverrides/iu);
    assert.equal(await readFile(path, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
