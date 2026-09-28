import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI): void {
  const visitKey = Symbol.for("pi-agent-ide.test.ui-state-starts");
  const visits = globalThis as typeof globalThis & { [visitKey]?: number };
  visits[visitKey] = (visits[visitKey] ?? 0) + 1;
  pi.on("session_start", (_event, ctx) => {
    pi.registerTool({ name: "pi_ide_probe", label: "Pi IDE Probe", description: "Synthetic local probe",
      parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "probe" }] }; } });
    if (visits[visitKey] === 1) {
      ctx.ui.setStatus("startup", "ready");
      ctx.ui.setWidget("startup", ["Pi startup widget"], { placement: "belowEditor" });
      ctx.ui.setTitle("Pi extension terminal title");
      ctx.ui.setEditorText("Pi suggested draft");
      ctx.ui.notify("Pi startup notice", "info");
    }
  });
  pi.registerCommand("pi-ui-state", {
    description: "Exercise pinned Pi RPC extension display state",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("progress", "first");
      ctx.ui.setStatus("progress", "second");
      ctx.ui.setWidget("panel", ["line one", "line two"], { placement: "aboveEditor" });
      ctx.ui.notify("Pi extension notice", "warning");
    },
  });
  pi.registerCommand("pi-ui-clear", {
    description: "Clear pinned Pi RPC extension display state",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("progress", undefined);
      ctx.ui.setWidget("panel", undefined);
    },
  });
}
