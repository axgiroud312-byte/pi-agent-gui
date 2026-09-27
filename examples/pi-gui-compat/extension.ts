/**
 * Pinned Pi 0.87.0 sample for a GUI host using the same RPC session.
 * Run /gui-compat-demo for serializable UI, /gui-tui-only for the TUI boundary.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const statusKey = "gui-compat";
const customType = "pi-gui-compat.result";
const sampleImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRhsAAAAASUVORK5CYII=";

export default function (pi: ExtensionAPI): void {
  // The renderer is TUI-only. Pi still persists the original custom message in RPC mode.
  pi.registerMessageRenderer(customType, message => new Text(
    typeof message.content === "string" ? message.content : JSON.stringify(message.content), 0, 0));

  pi.registerCommand("gui-compat-demo", {
    description: "Exercise Pi RPC dialogs, status, text widget, and original message",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.setStatus(statusKey, "Waiting for Pi extension answers");
      ctx.ui.setWidget(statusKey, ["Pi extension is waiting for an answer"], { placement: "aboveEditor" });
      ctx.ui.setTitle("Pi GUI compatibility sample");
      try {
        const selected = await ctx.ui.select("Choose a value", ["alpha", "beta"]);
        if (selected === undefined) { ctx.ui.notify("GUI_COMPAT_CANCELLED", "warning"); return; }
        const confirmed = await ctx.ui.confirm("Continue?", "Save the example result to Pi history?");
        if (!confirmed) { ctx.ui.notify("GUI_COMPAT_CANCELLED", "warning"); return; }
        const input = await ctx.ui.input("Short answer", "Text can be blank");
        if (input === undefined) { ctx.ui.notify("GUI_COMPAT_CANCELLED", "warning"); return; }
        const edited = await ctx.ui.editor("Long answer", "Edit this text");
        if (edited === undefined) { ctx.ui.notify("GUI_COMPAT_CANCELLED", "warning"); return; }
        pi.sendMessage({ customType, content: JSON.stringify({ selected, confirmed, input, edited }),
          display: true, details: { source: "pi-gui-compat" } }, { triggerTurn: false });
        ctx.ui.notify("GUI_COMPAT_COMPLETE", "info");
      } finally {
        ctx.ui.setStatus(statusKey, undefined);
        ctx.ui.setWidget(statusKey, undefined);
      }
    },
  });

  pi.registerCommand("gui-compat-image", {
    description: "Keep an extension image and details in Pi history without a TUI renderer",
    handler: async () => {
      pi.sendMessage({ customType: "pi-gui-compat.image", display: true,
        content: [{ type: "text", text: "before image" },
          { type: "image", mimeType: "image/png", data: sampleImage },
          { type: "text", text: "after image" }],
        details: { image: "sample", source: "Pi" } }, { triggerTurn: false });
    },
  });

  pi.registerCommand("gui-tui-only", {
    description: "Demonstrate a component UI that requires Pi's interactive TUI",
    handler: async (_args, ctx) => {
      // hasUI is also true in RPC mode. A TUI factory needs the mode check.
      if (ctx.mode !== "tui") {
        ctx.ui.notify("TUI_ONLY_IN_RPC: use Pi interactive TUI for this component", "warning");
        return;
      }
      const answer = await ctx.ui.custom<string>((_tui, _theme, _keys, done) => ({
        render: () => ["Press a key to finish this TUI-only component"],
        invalidate: () => {},
        handleInput: value => done(value),
      }));
      ctx.ui.notify(`TUI component answered: ${answer}`, "info");
    },
  });
}
