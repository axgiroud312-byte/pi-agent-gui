import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_NAME, productServiceFetch, requireProductCapability, productMessage, isVendorProductAssetUrl } from "./product.ts";
import { resolveDesktopProductIdentity, resolveWindowsAppUserModelIdForFlavor } from "../../desktop/scripts/desktop-product-identity.mjs";
import { createCustomAboutDialogHtml } from "../../desktop/src/main/aboutWindow.ts";
import { extractDeepLinkUrlFromArgs, extractWorkspaceOpenPath } from "../../desktop/src/main/desktopDeepLinkUrl.ts";

test("product-service transport rejects before any outbound side effect, including a changed endpoint", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const transport = productServiceFetch(async () => { calls++; return new Response("unexpected"); });
  for (const input of ["https://zcode.z.ai/api/v1/client/configs", new URL("https://example.com/api/v1/oauth/token"), new Request("https://example.com/api/v1/share")]) {
    await assert.rejects(transport(input), /vendorServices is not available/);
  }
  assert.equal(calls, 0);
  assert.equal(globalThis.fetch, originalFetch, "generic provider/MCP fetch must not be patched globally");
});

test("direct excluded actions fail instead of pretending success", () => {
  for (const action of ["vendorAccount", "cloudSharing", "vendorFeedback", "vendorUpdates", "vendorCatalog", "offPeak"]) {
    assert.throws(() => requireProductCapability(action), /not available in this product/);
  }
});

test("product artwork classification does not blacklist model providers or user hosts by name", () => {
  assert.equal(isVendorProductAssetUrl("https://cdn-zcode.z.ai/zcode/official-plugin/assets/icon.png"), true);
  for (const url of ["https://api.z.ai/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4", "https://cdn-zcode.z.ai.example.com/image.png", "https://example.com/zcode/image.png", "data:image/png;base64,AA==", undefined]) {
    assert.equal(isVendorProductAssetUrl(url), false);
  }
});

test("static branding happens before user interpolation and preserves the isolated engine identity", () => {
  const template = productMessage("Open {path} in ZCode; ZCode Agent · ZCodeProject");
  assert.equal(template.replace("{path}", "C:/ZCode/project"), `Open C:/ZCode/project in ${PRODUCT_NAME}; ZCode Agent · ZCodeProject`);
  assert.equal(productMessage("BigModel / Z.AI / API key"), "BigModel / Z.AI / API key");
});

test("desktop identities keep Pi production, preview and development separate from upstream", () => {
  const production = resolveDesktopProductIdentity({ ZCODE_ENV: "production" });
  assert.equal(production.productName, PRODUCT_NAME);
  assert.equal(production.appId, "io.github.axgiroud312-byte.pi-agent-ide");
  assert.equal(resolveDesktopProductIdentity({}).productName, "Pi Agent IDE Preview");
  assert.notEqual(resolveWindowsAppUserModelIdForFlavor("preview"), production.appId);
  assert.notEqual(resolveWindowsAppUserModelIdForFlavor("production", { isPackaged: false }), production.appId);
});

test("native About keeps escaping and shows the Pi mark alongside upstream legal attribution", () => {
  const html = createCustomAboutDialogHtml({ applicationName: PRODUCT_NAME, appVersion: "<dev>", copyright: "Based on ZCode · Apache-2.0", optimizationLine: "", versionLabel: "version", okButtonLabel: "OK" });
  assert.match(html, /Pi Agent IDE/);
  assert.match(html, /&lt;dev&gt;/);
  assert.match(html, /Based on ZCode · Apache-2.0/);
  assert.match(html, /viewBox="0 0 64 64"/);
  assert.match(html, /window.close\(\)/);
});

test("workspace deep links use the Pi product identity and keep encoded paths intact", () => {
  const path = "C:/project with spaces/项目";
  const url = `pi-agent-ide://workspace/open?path=${encodeURIComponent(path)}`;
  assert.equal(extractDeepLinkUrlFromArgs(["electron", url]), url);
  assert.equal(extractWorkspaceOpenPath(new URL(url)), path);
  assert.equal(extractWorkspaceOpenPath(new URL("zcode://workspace/open?path=C:/original")), null);
});
