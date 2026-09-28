import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { readPiSettingsDocuments, savePiSettingsDocument } from "../src/pi-agent/pi-settings-documents.js";

test("Pi effective settings source follows global-only getters even in a trusted project", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-global-source-"));
  const workspace = join(root, "workspace");
  const agentDir = join(root, "agent");
  try {
    await mkdir(join(workspace, ".pi"), { recursive: true });
    await mkdir(agentDir);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultModel: "user-model", cacheWarming: "idle", defaultProjectTrust: "never",
      httpProxy: "http://127.0.0.1:8181", retry: { enabled: true, maxRetries: 2 },
      unknownUser: { keep: true },
    }));
    await writeFile(join(workspace, ".pi", "settings.json"), JSON.stringify({
      defaultModel: "project-model", cacheWarming: "off", defaultProjectTrust: "always",
      httpProxy: "http://127.0.0.1:9191", retry: { maxRetries: 5 },
      unknownProject: { keep: true },
    }));
    const pi = SettingsManager.create(workspace, agentDir, { projectTrusted: true });
    assert.equal(pi.getCacheWarmingMode(), "idle");
    assert.equal(pi.getDefaultProjectTrust(), "never");
    assert.equal(pi.getGlobalSettings().httpProxy, "http://127.0.0.1:8181");
    const snapshot = await readPiSettingsDocuments(workspace, { PI_CODING_AGENT_DIR: agentDir }, ["--approve"]);
    assert.equal(snapshot.projectTrusted, true);
    assert.equal(snapshot.effective.defaultModel, "project-model");
    assert.equal(snapshot.sources.defaultModel, "project");
    assert.equal(snapshot.effective.cacheWarming, "idle");
    assert.equal(snapshot.effective.defaultProjectTrust, "never");
    assert.equal(snapshot.effective.httpProxy, "http://127.0.0.1:8181");
    assert.equal(snapshot.sources.cacheWarming, "user");
    assert.equal(snapshot.sourcePaths["/retry/enabled"], "user");
    assert.equal(snapshot.sourcePaths["/retry/maxRetries"], "project");
    assert.deepEqual(snapshot.ignoredProjectPaths.sort(),
      ["/cacheWarming", "/defaultProjectTrust", "/httpProxy"].sort());
    assert.deepEqual(snapshot.project.parsed?.unknownProject, { keep: true });
    const saved = await savePiSettingsDocument(workspace, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "project", expectedRevision: snapshot.project.revision, rpcArgs: ["--approve"],
      text: JSON.stringify({ ...snapshot.project.parsed, retry: { maxRetries: 6 } }),
    });
    assert.deepEqual(saved.project.parsed?.unknownProject, { keep: true });
    assert.equal((saved.effective.retry as { enabled: boolean; maxRetries: number }).maxRetries, 6);
    assert.equal(saved.effective.cacheWarming, "idle", "project-only global key remains ignored after a scoped save");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an external settings write after draft preparation cannot be overwritten at commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-late-conflict-"));
  const agentDir = join(root, "agent");
  try {
    await mkdir(agentDir);
    const settingsPath = join(agentDir, "settings.json");
    await writeFile(settingsPath, '{"defaultModel":"before","future":{"keep":1}}');
    const before = await readPiSettingsDocuments(root, { PI_CODING_AGENT_DIR: agentDir });
    await assert.rejects(savePiSettingsDocument(root, { PI_CODING_AGENT_DIR: agentDir }, {
      scope: "user", expectedRevision: before.user.revision,
      text: '{"defaultModel":"mine","future":{"keep":1}}',
    }, { beforeCommit: () => writeFile(settingsPath,
      '{"defaultModel":"external","future":{"keep":2}}') }), /conflict|changed outside/i);
    assert.equal(await readFile(settingsPath, "utf8"),
      '{"defaultModel":"external","future":{"keep":2}}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
