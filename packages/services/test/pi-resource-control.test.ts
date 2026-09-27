import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";
import { PiControlBridge } from "../src/pi-agent/pi-control-bridge.js";
import { piControlIntent, piControlView } from "../src/pi-agent/pi-control-protocol.js";

const fullPiControlView = (snapshot: Parameters<typeof piControlView>[0]) => piControlView(snapshot, true);

test("Pi resource control rejects credential URLs and invalid package filters before invoking Pi", () => {
  assert.throws(() => piControlIntent({ operation: "package_install",
    source: "https://user:secret@example.invalid/group/package.git", scope: "user" }));
  assert.throws(() => piControlIntent({ operation: "package_filter",
    source: "npm:fixture", scope: "user", filters: [] }));
  assert.throws(() => piControlIntent({ operation: "package_filter",
    source: "npm:fixture", scope: "user", filters: { prompts: [42] } }));
});

test("pinned Pi owns loaded resources and local package install/filter/remove across reloads", { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-resources-"));
  const profile = join(root, "profile");
  const workspace = join(root, "workspace");
  const fixture = join(root, "local-package");
  const calls: unknown[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "resource-test", object: "chat.completion.chunk", created: 1,
      model: "resource-model", choices: [{ index: 0, delta: { role: "assistant", content: "RESOURCE_OK" },
        finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  let client: PiRpcClient | undefined;
  let bridge: PiControlBridge | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    await mkdir(join(profile, "skills", "global-skill"), { recursive: true });
    await mkdir(join(workspace, ".pi", "prompts"), { recursive: true });
    await mkdir(join(fixture, "prompts"), { recursive: true });
    await mkdir(join(fixture, "skills", "package-skill"), { recursive: true });
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
      "resource-provider": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-test-only", models: [{ id: "resource-model" }] },
    } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProjectTrust: "always",
      defaultProvider: "resource-provider", defaultModel: "resource-model" }));
    await writeFile(join(profile, "skills", "global-skill", "SKILL.md"),
      "---\nname: global-skill\ndescription: Global skill fixture\n---\nGlobal skill instructions");
    await writeFile(join(profile, "APPEND_SYSTEM.md"), "Global appended system prompt fixture");
    await writeFile(join(workspace, "AGENTS.md"), "Workspace context fixture");
    await writeFile(join(workspace, ".pi", "prompts", "project-template.md"),
      "---\ndescription: Project template fixture\n---\nExpanded $1 and ${2:-default}");
    await writeFile(join(fixture, "package.json"), JSON.stringify({ name: "resource-fixture", version: "1.0.0",
      pi: { prompts: ["prompts"], skills: ["skills"] } }));
    await writeFile(join(fixture, "prompts", "package-template.md"),
      "---\ndescription: Package template fixture\n---\nPackage $1");
    await writeFile(join(fixture, "skills", "package-skill", "SKILL.md"),
      "---\nname: package-skill\ndescription: Package skill fixture\n---\nPackage skill instructions");
    client = new PiRpcClient({ executable: process.execPath,
      args: [fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")), "--offline",
        "--extension", fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url))],
      cwd: workspace, env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" }, });
    await client.start();
    bridge = new PiControlBridge(client);
    const resourceSnapshot = await bridge.refresh();
    const redacted = piControlView(resourceSnapshot);
    assert.equal(JSON.stringify(redacted).includes("Workspace context fixture"), false);
    assert.equal(JSON.stringify(redacted).includes("Global appended system prompt fixture"), false);
    const initial = fullPiControlView(resourceSnapshot);
    assert(initial.resources.commands.some(command => command.name === "project-template" &&
      command.source === "prompt" && command.sourceInfo.scope === "project"));
    assert(initial.resources.skills.some(skill => skill.name === "global-skill" &&
      skill.sourceInfo.scope === "user"));
    assert(initial.resources.contextFiles.some(file => file.path.endsWith("AGENTS.md") &&
      file.content.includes("Workspace context fixture")));
    assert(initial.resources.appendSystemPrompt.includes("Global appended system prompt fixture"));
    const skillPath = join(profile, "skills", "global-skill", "SKILL.md");
    const disabledSkill = fullPiControlView(await bridge.act({ operation: "resource_toggle", kind: "skill",
      path: skillPath, enabled: false, sessionId: initial.info.sessionId,
      generation: initial.info.generation }));
    assert.equal(disabledSkill.resources.skills.some(skill => skill.name === "global-skill"), false);
    assert(disabledSkill.resources.availableResources.some(item => item.path === skillPath && !item.enabled));
    const enabledSkill = fullPiControlView(await bridge.act({ operation: "resource_toggle", kind: "skill",
      path: skillPath, enabled: true, sessionId: disabledSkill.info.sessionId,
      generation: disabledSkill.info.generation }));
    assert(enabledSkill.resources.skills.some(skill => skill.name === "global-skill"));
    const templatePath = join(workspace, ".pi", "prompts", "project-template.md");
    const disabledTemplate = fullPiControlView(await bridge.act({ operation: "resource_toggle", kind: "prompt",
      path: templatePath, enabled: false, sessionId: enabledSkill.info.sessionId,
      generation: enabledSkill.info.generation }));
    assert.equal(disabledTemplate.resources.commands.some(command => command.name === "project-template"), false);
    const enabledTemplate = fullPiControlView(await bridge.act({ operation: "resource_toggle", kind: "prompt",
      path: templatePath, enabled: true, sessionId: disabledTemplate.info.sessionId,
      generation: disabledTemplate.info.generation }));
    assert(enabledTemplate.resources.commands.some(command => command.name === "project-template"));
    const openedSnapshot = await bridge.act({ operation: "resource_read", path: templatePath,
      sessionId: enabledTemplate.info.sessionId, generation: enabledTemplate.info.generation });
    assert.equal(piControlView(openedSnapshot).result?.resource, undefined);
    const opened = fullPiControlView(openedSnapshot);
    assert(opened.result?.resource?.content.includes("Expanded $1"));
    await writeFile(templatePath, "---\ndescription: External change\n---\nExternal $1");
    await assert.rejects(bridge.act({ operation: "resource_write", path: templatePath,
      expectedHash: opened.result!.resource!.hash, content: "stale overwrite",
      sessionId: enabledTemplate.info.sessionId, generation: enabledTemplate.info.generation }),
    /changed on disk/);
    const fresh = fullPiControlView(await bridge.act({ operation: "resource_read", path: templatePath,
      sessionId: enabledTemplate.info.sessionId, generation: enabledTemplate.info.generation }));
    const saved = fullPiControlView(await bridge.act({ operation: "resource_write", path: templatePath,
      expectedHash: fresh.result!.resource!.hash,
      content: "---\ndescription: Edited in GUI\n---\nEdited $1 and ${2:-default}",
      sessionId: enabledTemplate.info.sessionId, generation: enabledTemplate.info.generation }));
    assert.notEqual(saved.info.generation, enabledTemplate.info.generation);
    assert.equal((await readFile(templatePath, "utf8")).includes("Edited $1"), true);
    assert(saved.resources.commands.some(command => command.name === "project-template" &&
      command.description === "Edited in GUI"));
    const createdPrompt = fullPiControlView(await bridge.act({ operation: "resource_create", kind: "replace",
      scope: "project", content: "Project replacement system prompt fixture",
      sessionId: saved.info.sessionId, generation: saved.info.generation }));
    assert.equal(createdPrompt.resources.customSystemPrompt, "Project replacement system prompt fixture");
    assert(createdPrompt.resources.systemPromptFiles.some(item => item.kind === "replace" &&
      item.scope === "project" && item.active));
    const contextPath = join(workspace, "AGENTS.md");
    const contextRead = fullPiControlView(await bridge.act({ operation: "resource_read", path: contextPath,
      sessionId: createdPrompt.info.sessionId, generation: createdPrompt.info.generation }));
    const contextSaved = fullPiControlView(await bridge.act({ operation: "resource_write", path: contextPath,
      expectedHash: contextRead.result!.resource!.hash, content: "Updated workspace context fixture",
      sessionId: createdPrompt.info.sessionId, generation: createdPrompt.info.generation }));
    assert(contextSaved.resources.contextFiles.some(item => item.path === contextPath &&
      item.content.includes("Updated workspace context fixture")));
    const invoke = async (message: string) => {
      const settled = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { client?.off("record", listener); reject(new Error("Pi did not settle")); }, 20_000);
        const listener = (record: Record<string, unknown>) => {
          if (record.type === "agent_settled") { clearTimeout(timeout); client?.off("record", listener); resolve(); }
        };
        client?.on("record", listener);
      });
      const accepted = await client!.request({ type: "prompt", message });
      assert.equal(accepted.success, true, accepted.error);
      await settled;
    };
    await invoke("/project-template Alpha");
    assert(JSON.stringify(calls.at(-1)).includes("Edited Alpha and default"), "Pi expanded the edited template");
    await invoke("/skill:global-skill Beta");
    assert(JSON.stringify(calls.at(-1)).includes("Global skill instructions"), "Pi expanded the loaded Skill");
    assert(JSON.stringify(calls.at(-1)).includes("Beta"), JSON.stringify(calls.at(-1)));
    const installed = fullPiControlView(await bridge.act({ operation: "package_install", source: fixture, scope: "project",
      sessionId: contextSaved.info.sessionId, generation: contextSaved.info.generation }));
    assert.notEqual(installed.info.generation, contextSaved.info.generation);
    assert(installed.resources.packages.some(pkg => pkg.scope === "project" && pkg.installedPath === fixture),
      JSON.stringify(installed.resources.packages));
    assert(installed.resources.commands.some(command => command.name === "package-template" &&
      command.sourceInfo.origin === "package"));
    assert(installed.resources.skills.some(skill => skill.name === "package-skill" &&
      skill.sourceInfo.origin === "package"));
    await invoke("/package-template Gamma");
    assert(JSON.stringify(calls.at(-1)).includes("Package Gamma"), "Pi expanded the package template");
    const configuredSource = installed.resources.packages.find(pkg => pkg.scope === "project" && pkg.installedPath === fixture)!.source;
    const projectSettingsPath = join(workspace, ".pi", "settings.json");
    const settingsBeforeFilter = JSON.parse(await readFile(projectSettingsPath, "utf8"));
    settingsBeforeFilter.packages = [{ source: configuredSource, futurePackageField: "preserve" }];
    settingsBeforeFilter.futureSettingsField = { preserved: true };
    await writeFile(projectSettingsPath, JSON.stringify(settingsBeforeFilter));
    const filtered = fullPiControlView(await bridge.act({ operation: "package_filter", source: configuredSource, scope: "project",
      filters: { prompts: [], skills: [] }, sessionId: installed.info.sessionId,
      generation: installed.info.generation }));
    assert.equal(filtered.resources.commands.some(command => command.name === "package-template"), false);
    assert.equal(filtered.resources.skills.some(skill => skill.name === "package-skill"), false);
    assert(filtered.resources.packages.some(pkg => pkg.source === configuredSource && pkg.filtered));
    const settingsAfterFilter = JSON.parse(await readFile(projectSettingsPath, "utf8"));
    assert.equal(settingsAfterFilter.packages[0].futurePackageField, "preserve");
    assert.equal(settingsAfterFilter.futureSettingsField.preserved, true);
    const removed = fullPiControlView(await bridge.act({ operation: "package_remove", source: configuredSource, scope: "project",
      sessionId: filtered.info.sessionId, generation: filtered.info.generation }));
    assert.equal(removed.resources.packages.some(pkg => pkg.source === configuredSource), false);
    const settings = JSON.parse(await readFile(join(workspace, ".pi", "settings.json"), "utf8"));
    assert.deepEqual(settings.packages ?? [], []);
    await writeFile(join(profile, "settings.json"), "{ invalid JSON");
    const diagnosed = fullPiControlView(await bridge.refresh());
    assert(diagnosed.resources.diagnostics.some(item => item.includes("global") || item.includes("user")),
      "Pi settings parse errors must remain visible alongside the loaded session snapshot");
  } finally {
    bridge?.dispose();
    await client?.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("pinned Pi installs and removes a pinned Git package from an isolated repository", { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-package-"));
  const workspace = join(root, "workspace");
  const profile = join(root, "profile");
  const sourceRepo = join(root, "source");
  const bare = join(root, "repositories", "group", "fixture.git");
  let daemon: ChildProcess | undefined;
  let client: PiRpcClient | undefined;
  let bridge: PiControlBridge | undefined;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    await mkdir(join(sourceRepo, "prompts"), { recursive: true });
    await mkdir(workspace);
    await mkdir(profile);
    await mkdir(join(root, "repositories", "group"), { recursive: true });
    await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
    await writeFile(join(sourceRepo, "prompts", "git-template.md"),
      "---\ndescription: Git fixture\n---\nPinned Git $1");
    git("init", "--bare", bare);
    git("-C", sourceRepo, "init");
    git("-C", sourceRepo, "add", "prompts/git-template.md");
    git("-C", sourceRepo, "-c", "user.name=Pi Test", "-c", "user.email=pi-test@example.invalid",
      "commit", "-m", "fixture");
    git("-C", sourceRepo, "tag", "v1");
    git("-C", sourceRepo, "remote", "add", "origin", bare);
    git("-C", sourceRepo, "push", "origin", "HEAD:refs/heads/main", "refs/tags/v1");
    const portServer = createServer();
    await new Promise<void>(resolve => portServer.listen(0, "127.0.0.1", resolve));
    const address = portServer.address();
    assert(address && typeof address !== "string");
    await new Promise<void>(resolve => portServer.close(() => resolve()));
    daemon = spawn("git", ["daemon", `--base-path=${join(root, "repositories")}`, "--export-all", "--reuseaddr",
      "--listen=127.0.0.1", `--port=${address.port}`], { cwd: process.cwd(), stdio: "ignore", windowsHide: true });
    const packageSource = `git:git://127.0.0.1:${address.port}/group/fixture.git@v1`;
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { git("ls-remote", packageSource.slice(4, -3)); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert(ready, "isolated Git daemon did not start");
    client = new PiRpcClient({ executable: process.execPath,
      args: [fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")), "--offline",
        "--extension", fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url))],
      cwd: workspace, env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0", GIT_TERMINAL_PROMPT: "0" } });
    await client.start();
    bridge = new PiControlBridge(client);
    const before = fullPiControlView(await bridge.refresh());
    const installed = fullPiControlView(await bridge.act({ operation: "package_install", source: packageSource,
      scope: "project", sessionId: before.info.sessionId, generation: before.info.generation }));
    assert(installed.resources.packages.some(pkg => pkg.source === packageSource && pkg.installedPath));
    assert(installed.resources.commands.some(command => command.name === "git-template" &&
      command.sourceInfo.origin === "package"));
    const removed = fullPiControlView(await bridge.act({ operation: "package_remove", source: packageSource,
      scope: "project", sessionId: installed.info.sessionId, generation: installed.info.generation }));
    assert.equal(removed.resources.packages.some(pkg => pkg.source === packageSource), false);
    assert.equal(removed.resources.commands.some(command => command.name === "git-template"), false);
  } finally {
    bridge?.dispose();
    await client?.dispose();
    if (daemon?.pid && process.platform === "win32") {
      try { execFileSync("taskkill", ["/PID", String(daemon.pid), "/T", "/F"], { stdio: "ignore" }); }
      catch { daemon.kill(); }
    } else daemon?.kill();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
