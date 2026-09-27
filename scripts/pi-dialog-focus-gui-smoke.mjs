// Issue #26: fixed Pi extension dialog focus, modal shortcut scope, and Escape cancellation.
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./native-smoke/fixture.mjs";
import { closeOwned, assertCleanExit } from "./native-smoke/cleanup.mjs";
import { resizeNativeWindow } from "./native-smoke/evidence.mjs";
import { startPiModel } from "./native-smoke/pi-model.mjs";
import {
  configurePiProfile,
  isolatePiPackage,
  verifyPiPackageCleanup,
} from "./native-smoke/pi-package.mjs";

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, {
  url: model.url,
  modelId: "pi-native-test",
  apiKey: "fixture-not-a-secret",
});
const extensionDir = join(f.env.PI_CODING_AGENT_DIR, "extensions");
await mkdir(extensionDir, { recursive: true });
await copyFile(
  fileURLToPath(new URL("../packages/services/test/fixtures/pi-ui-sequence.ts", import.meta.url)),
  join(extensionDir, "pi-ui-sequence.ts"),
);
const resultFile = join(f.sandbox, "pi-ui-focus-result.json");
f.env.NATIVE_SMOKE_PI_UI_RESULT_FILE = resultFile;
const logs = [];
const report = {
  at: new Date().toISOString(),
  piVersion: "0.87.0",
  boundary:
    "production Electron GUI -> fixed Pi RPC extension; deterministic local model, no online provider",
  pageErrors: [],
  stages: {},
};
let app;
const focusedInside = (dialog) => dialog.evaluate((node) => node.contains(document.activeElement));
const activeName = (page) =>
  page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    testId: document.activeElement?.getAttribute("data-testid"),
    text: document.activeElement?.textContent?.slice(0, 80),
  }));
try {
  app = await f.playwright._electron.launch({
    executablePath: f.electronPath,
    args: [fileURLToPath(new URL("./native-smoke/bootstrap.cjs", import.meta.url)), "--lang=zh-CN"],
    cwd: f.root,
    env: f.env,
    timeout: 60_000,
  });
  app.process().stdout?.on("data", (chunk) => logs.push(String(chunk)));
  app.process().stderr?.on("data", (chunk) => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const name of [
    /^(使用 API key|Use API key)$/,
    /^(暂时跳过|Skip for now)$/,
    /^(退出引导|Exit onboarding)$/,
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.isVisible()) {
      await button.click();
      await page.waitForTimeout(1800);
    }
  }
  await page.getByRole("button", { name: "添加项目", exact: true }).click();
  await page.getByRole("menuitem", { name: "打开文件夹", exact: true }).click();
  const composer = page.getByTestId("v4-composer-input").filter({ visible: true }).first();
  await composer.waitFor();
  await page.getByTestId("sidebar").getByTestId("task-settings-button").click();
  if (!(await page.getByRole("button", { name: "创建自定义供应商", exact: true }).isVisible())) {
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page.getByTestId("model-provider-add-provider-button").click();
  }
  await page.getByRole("button", { name: "创建自定义供应商", exact: true }).click();
  await page.getByTestId("model-provider-base-url-input").fill(model.url);
  await page.getByTestId("model-provider-api-key-input").fill("fixture-not-a-secret");
  await page.getByTestId("model-provider-api-format-trigger").click();
  await page.getByRole("option", { name: /Chat Completions/ }).click();
  await page.getByTestId("model-provider-add-model-button").click();
  await page.getByPlaceholder("模型 ID", { exact: true }).fill("pi-native-test");
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByTestId("settings-back-button").click();
  await page.getByTestId("settings-page").waitFor({ state: "hidden" });
  await page.getByTestId("chat-model-select-trigger").click();
  await page.getByRole("menuitem", { name: "新供应商", exact: true }).press("ArrowRight");
  await page.getByText("pi-native-test", { exact: true }).click();
  await page.keyboard.press("Escape");
  await resizeNativeWindow(app, page, { width: 1280, height: 800 });
  await composer.click();
  await page.keyboard.type("PI_TEXT: establish pinned Pi session for modal focus smoke");
  model.releaseText();
  await page.getByTestId("v4-composer-send").filter({ visible: true }).first().click();
  await page.getByText("PI_TEXT_COMPLETE", { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some((request) => request.scenario === "PI_TEXT"));
  await composer.click();
  await page.keyboard.insertText("/pi-ui-sequence");
  await page.getByTestId("v4-composer-send").filter({ visible: true }).first().click();
  const dialog = page.getByTestId("v4-user-input-dialog");
  await dialog.waitFor({ timeout: 20_000 });
  report.stages.selectInitialFocus = await activeName(page);
  assert(await focusedInside(dialog), "Pi select dialog must own initial keyboard focus");
  assert(
    await dialog
      .getByTestId("v4-user-input-option-alpha")
      .evaluate((node) => node === document.activeElement),
  );
  await page.keyboard.press("Shift+Tab");
  assert(
    await dialog
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((node) => node === document.activeElement),
    "Reverse Tab must wrap inside the modal",
  );
  await page.keyboard.press("Tab");
  assert(
    await dialog
      .getByTestId("v4-user-input-option-alpha")
      .evaluate((node) => node === document.activeElement),
  );
  report.stages.modalScopeBeforeShortcut = await page.evaluate(() => ({
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((node) => ({
      ariaModal: node.getAttribute("aria-modal"),
      testId: node.getAttribute("data-testid"),
    })),
    menus: document.querySelectorAll('[role="menu"]').length,
  }));
  assert.equal(
    report.stages.modalScopeBeforeShortcut.menus,
    0,
    "Model setup must leave no menu open before the Pi modal keyboard test",
  );
  await page.keyboard.press("Control+m");
  assert.equal(
    await page.getByRole("menu").count(),
    0,
    "Composer shortcut must not open behind Pi modal",
  );
  assert(await focusedInside(dialog), "Modal shortcut must not steal focus");
  await page.screenshot({ path: join(f.output, "pi-dialog-select-focus.png") });
  await page.keyboard.press("Escape");
  await dialog.getByText("Confirm the operation", { exact: true }).waitFor();
  report.stages.selectCancel = true;
  await dialog.getByTestId("v4-user-input-option-false").click();
  await dialog.getByText("Optional text", { exact: true }).waitFor();
  assert(
    await dialog
      .getByTestId("v4-user-input-text")
      .evaluate((node) => node === document.activeElement),
    "Pi input must focus its textbox",
  );
  await page.keyboard.press("Escape");
  await dialog.getByText("Edit multiple lines", { exact: true }).waitFor();
  const editor = dialog.getByTestId("v4-user-input-text");
  assert(
    await editor.evaluate((node) => node === document.activeElement),
    "Pi editor must focus its textarea",
  );
  assert.equal(await editor.inputValue(), "original\nvalue");
  await editor.fill("changed\nsecond line");
  await page.screenshot({ path: join(f.output, "pi-dialog-editor-focus.png") });
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  report.stages.afterDialog = await activeName(page);
  report.stages.afterDialogDom = await page.evaluate(() => ({
    composers: Array.from(document.querySelectorAll('[data-testid="v4-composer-input"]')).map(
      (node) => ({
        connected: node.isConnected,
        rects: node.getClientRects().length,
        contenteditable: node.getAttribute("contenteditable"),
      }),
    ),
    returnControls: ["chat-model-select-trigger", "pi-tree-open"].map((testId) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      return {
        testId,
        visible: Boolean(node?.getClientRects().length),
        disabled: node?.matches(':disabled, [aria-disabled="true"]') ?? null,
      };
    }),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((node) => ({
      testId: node.getAttribute("data-testid"),
      state: node.getAttribute("data-state"),
      ariaModal: node.getAttribute("aria-modal"),
    })),
  }));
  await page.waitForFunction(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.getClientRects().length) return false;
    const testId = active.getAttribute("data-testid");
    return (
      (testId === "v4-composer-input" && active.getAttribute("contenteditable") === "true") ||
      ((testId === "chat-model-select-trigger" || testId === "pi-tree-open") &&
        !active.matches(':disabled, [aria-disabled="true"]'))
    );
  });
  await page.waitForTimeout(500);
  report.stages.focusRestored = await page.evaluate(() => {
    const active = document.activeElement;
    const testId = active?.getAttribute("data-testid");
    return {
      testId,
      contenteditable: active?.getAttribute("contenteditable"),
      usable:
        active instanceof HTMLElement &&
        active.getClientRects().length > 0 &&
        ((testId === "v4-composer-input" && active.getAttribute("contenteditable") === "true") ||
          ((testId === "chat-model-select-trigger" || testId === "pi-tree-open") &&
            !active.matches(':disabled, [aria-disabled="true"]'))),
    };
  });
  assert(report.stages.focusRestored.usable, "Focus must remain on an enabled native control");
  assert.equal(report.stages.focusRestored.testId, "v4-composer-input",
    "an acknowledged Pi extension command must return focus to the editable native composer");
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      result = JSON.parse(await readFile(resultFile, "utf8"));
      break;
    } catch {
      await page.waitForTimeout(100);
    }
  }
  assert.deepEqual(
    result,
    { confirmed: false, edited: "changed\nsecond line" },
    "Pi, not the host, must resolve both Escape cancellations and the remaining answers",
  );
  report.stages.piResult = result;
  await composer.click();
  await page.keyboard.type("PI_TEXT: follow up after Pi extension command");
  await page.getByTestId("v4-composer-send").filter({ visible: true }).first().click();
  await page.getByText("PI_TEXT_COMPLETE", { exact: true }).nth(1).waitFor({ timeout: 30_000 });
  assert.equal(model.requests.filter((request) => request.scenario === "PI_TEXT").length, 2,
    "the extension command must leave the same Pi session ready for the next model input");
  report.stages.followUpModelRun = true;
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  await app
    ?.windows()[0]
    ?.screenshot({ path: join(f.output, "pi-dialog-focus-failure.png") })
    .catch(() => {});
} finally {
  try {
    report.cleanup = await closeOwned(app, f);
    assertCleanExit(report.cleanup, logs, "Pi dialog focus GUI");
  } catch (error) {
    report.cleanupError = String(error);
    process.exitCode = 1;
  }
  await model.close();
  await writeFile(
    join(f.output, "pi-dialog-focus-gui-report.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(join(f.output, "pi-dialog-focus-gui.log"), logs.join(""));
  console.log(JSON.stringify(report, null, 2));
}
