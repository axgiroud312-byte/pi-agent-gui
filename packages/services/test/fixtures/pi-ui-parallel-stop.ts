import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("pi-ui-parallel-stop", {
    description: "Create a second Pi UI request while the first remains pending",
    handler: async (_args, ctx) => {
      const first = ctx.ui.select("First pending request", ["alpha", "beta"]);
      await new Promise(resolve => setTimeout(resolve, 100));
      const second = ctx.ui.input("Second pending request", "Optional answer");
      await Promise.all([first, second]);
    },
  });
}
