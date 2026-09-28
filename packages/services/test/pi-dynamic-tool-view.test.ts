import assert from "node:assert/strict";
import { test } from "node:test";
import { piControlView, type PiControlSnapshot } from "../src/pi-agent/pi-control-protocol.js";

test("renderer tool view shows only Pi catalog names/descriptions and active names", () => {
  const source = { info: { protocol: 1, bridgeVersion: "1.2.0", piVersion: "0.87.0",
    generation: "g", sessionId: "s", mode: "rpc", operations: ["set_tools"] },
  inspection: { tools: [{ name: "probe", description: "Probe tool", parameters: { secret: "private" } }],
    activeTools: ["probe"], commands: [], promptOptions: {}, systemPrompt: "SECRET PROMPT", projectTrusted: true },
  tree: [], entries: [], leafId: null } as unknown as PiControlSnapshot;
  const view = piControlView(source);
  assert.deepEqual(view.tools, [{ name: "probe", description: "Probe tool" }]);
  assert.deepEqual(view.activeTools, ["probe"]);
  assert.equal(JSON.stringify(view).includes("SECRET PROMPT"), false);
  assert.equal(JSON.stringify(view).includes("private"), false);
});
