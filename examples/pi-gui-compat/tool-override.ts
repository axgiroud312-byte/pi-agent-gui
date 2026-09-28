/** Representative same-name tool override for fixed Pi 0.87.0 GUI verification. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "read",
    label: "Controlled read override",
    description: "Controlled same-name read override for GUI verification",
    parameters: Type.Object({ path: Type.String() }),
    async execute(_toolCallId, params) {
      // Returning a marker instead of touching params.path proves that Pi's
      // extension definition and executor replaced the built-in `read` tool.
      return { content: [{ type: "text", text: `EXTENSION_READ_OVERRIDE_MARKER ${params.path}` }] };
    },
  });
}
