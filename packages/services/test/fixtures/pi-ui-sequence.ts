import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFile } from "node:fs/promises";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("pi-ui-sequence", {
    description: "Exercise pinned Pi RPC dialog categories in one session",
    handler: async (_args, ctx) => {
      const selected = await ctx.ui.select("Choose a value", ["alpha", "beta"]);
      const confirmed = await ctx.ui.confirm("Continue?", "Confirm the operation");
      const input = await ctx.ui.input("Optional text", "May be blank");
      const edited = await ctx.ui.editor("Edit multiple lines", "original\nvalue");
      const result = { selected, confirmed, input, edited };
      ctx.ui.notify(`PI_UI_RESULT:${JSON.stringify(result)}`, "info");
      if (process.env.NATIVE_SMOKE_PI_UI_RESULT_FILE) {
        await writeFile(process.env.NATIVE_SMOKE_PI_UI_RESULT_FILE, JSON.stringify(result));
      }
    },
  });
}
