import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("representative extension keeps RPC answers and raw custom message in one pinned Pi session",
  { timeout: 30_000 }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-gui-compat-"));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(workspace, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("../../../examples/pi-gui-compat/extension.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    const records: Record<string, unknown>[] = [];
    const replies: Promise<unknown>[] = [];
    let sessionId: string | undefined;
    supervisor.on("record", (id, record) => {
      if (id !== sessionId) return;
      records.push(record);
      if (record.type !== "extension_ui_request" || typeof record.id !== "string") return;
      const answer = record.method === "select" ? { value: "beta" } :
        record.method === "confirm" ? { confirmed: true } :
          record.method === "input" ? { value: "alpha input" } :
            record.method === "editor" ? { value: "edited\nbody" } : null;
      if (answer) replies.push(supervisor.respondExtension(id, record.id, answer));
    });
    try {
      const session = await supervisor.createSession(workspace);
      sessionId = session.sessionId;
      const pid = session.pid;
      assert.equal(await supervisor.sendText(sessionId, "/gui-compat-demo"), "noRun");
      await Promise.all(replies);
      assert.equal(supervisor.getSession(sessionId)?.pid, pid);
      assert.deepEqual(records.filter(record => record.type === "extension_ui_request" &&
        ["select", "confirm", "input", "editor"].includes(String(record.method))).map(record => record.method),
      ["select", "confirm", "input", "editor"]);
      assert(records.some(record => record.method === "setStatus" && record.statusText === "Waiting for Pi extension answers"));
      assert(records.some(record => record.method === "setStatus" && record.statusKey === "gui-compat" &&
        record.statusText === undefined));
      assert(records.some(record => record.method === "setWidget" && Array.isArray(record.widgetLines)));
      assert(records.some(record => record.method === "setWidget" && record.widgetKey === "gui-compat" &&
        record.widgetLines === undefined));
      assert(records.some(record => record.method === "notify" && record.message === "GUI_COMPAT_COMPLETE"));
      const history = await supervisor.getHistoryMessages(sessionId);
      const raw = history.find(item => typeof item === "object" && item !== null &&
        "customType" in item && item.customType === "pi-gui-compat.result") as { content?: string } | undefined;
      assert(raw?.content, "Pi raw custom message must survive a TUI renderer");
      assert.deepEqual(JSON.parse(raw.content), { selected: "beta", confirmed: true,
        input: "alpha input", edited: "edited\nbody" });
      // Slash commands can finish without an agent turn. The supervisor deliberately
      // requires history reconciliation before another input, so use a fresh Pi session.
      const boundarySession = await supervisor.createSession(workspace);
      sessionId = boundarySession.sessionId;
      const before = records.length;
      assert.equal(await supervisor.sendText(sessionId, "/gui-tui-only"), "noRun");
      const newRecords = records.slice(before);
      assert(newRecords.some(record => record.method === "notify" &&
        typeof record.message === "string" && record.message.includes("TUI_ONLY_IN_RPC")));
      assert.equal(newRecords.some(record => record.method === "custom"), false);
      assert.equal(supervisor.getSession(sessionId)?.pid, boundarySession.pid);
    } finally {
      await supervisor.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });

test("representative extension cancel clears status and widget without claiming completion",
  { timeout: 30_000 }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-gui-compat-cancel-"));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(workspace, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("../../../examples/pi-gui-compat/extension.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    const records: Record<string, unknown>[] = [];
    supervisor.on("record", (id, record) => {
      records.push(record);
      if (record.type === "extension_ui_request" && record.method === "select" && typeof record.id === "string") {
        void supervisor.respondExtension(id, record.id, { cancelled: true });
      }
    });
    try {
      const session = await supervisor.createSession(workspace);
      assert.equal(await supervisor.sendText(session.sessionId, "/gui-compat-demo"), "noRun");
      assert(records.some(record => record.method === "notify" && record.message === "GUI_COMPAT_CANCELLED"));
      assert.equal(records.some(record => record.method === "notify" && record.message === "GUI_COMPAT_COMPLETE"), false);
      assert(records.some(record => record.method === "setStatus" && record.statusKey === "gui-compat" &&
        record.statusText === undefined));
      assert(records.some(record => record.method === "setWidget" && record.widgetKey === "gui-compat" &&
        record.widgetLines === undefined));
    } finally {
      await supervisor.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });

test("pinned Pi RPC exposes the complex TUI boundary without a hidden request or false success",
  { timeout: 30_000 }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-tui-boundary-"));
    const extensionPath = join(workspace, "tui-boundary.mjs");
    await writeFile(extensionPath, `export default function(pi) {
      pi.registerCommand("tui-boundary-probe", { handler: async (_args, ctx) => {
        let factoryCalls = 0;
        const custom = await ctx.ui.custom(() => { factoryCalls++; return { render: () => [], invalidate() {} }; });
        ctx.ui.setWidget("factory", () => { factoryCalls++; return { render: () => [], invalidate() {} }; });
        ctx.ui.setHeader(() => { factoryCalls++; return { render: () => [], invalidate() {} }; });
        ctx.ui.setFooter(() => { factoryCalls++; return { render: () => [], invalidate() {} }; });
        const theme = ctx.ui.setTheme("dark");
        ctx.ui.notify("PI_TUI_BOUNDARY:" + JSON.stringify({ mode: ctx.mode, hasUI: ctx.hasUI,
          customUndefined: custom === undefined, factoryCalls, themeSuccess: theme.success }), "warning");
      } });
    }`);
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(workspace, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e", extensionPath,
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    const records: Record<string, unknown>[] = [];
    supervisor.on("record", (_id, record) => records.push(record));
    try {
      const session = await supervisor.createSession(workspace);
      assert.equal(await supervisor.sendText(session.sessionId, "/tui-boundary-probe"), "noRun");
      const notice = records.find(record => record.method === "notify" && typeof record.message === "string" &&
        record.message.startsWith("PI_TUI_BOUNDARY:"));
      assert(notice && typeof notice.message === "string");
      assert.deepEqual(JSON.parse(notice.message.slice("PI_TUI_BOUNDARY:".length)), {
        mode: "rpc", hasUI: true, customUndefined: true, factoryCalls: 0, themeSuccess: false,
      });
      assert.equal(records.some(record => record.method === "custom" || record.method === "setWidget"), false);
    } finally {
      await supervisor.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });
