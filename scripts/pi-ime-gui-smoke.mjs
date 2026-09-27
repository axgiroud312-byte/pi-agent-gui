// Issue #26: native composer IME Enter boundary against fixed Pi 0.87.0.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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
const logs = [];
const report = {
  at: new Date().toISOString(),
  piVersion: "0.87.0",
  boundary: "native production renderer -> Host -> fixed Pi RPC -> loopback provider",
  onlineProvider: "not tested",
  pageErrors: [],
  cases: [],
};
let app;
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
  await page.getByTestId("v4-composer-input").waitFor();
  assert.match(page.url(), /^file:/, "Use production renderer, not Vite dev server");
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
  assert(
    JSON.stringify(
      JSON.parse(await readFile(join(f.home, ".zcode", "v2", "provider_config.json"), "utf8")),
    ).includes("new-provider"),
  );
  await page.getByTestId("settings-back-button").click();
  await page.getByTestId("settings-page").waitFor({ state: "hidden" });
  await page.getByTestId("chat-model-select-trigger").click();
  await page.getByRole("menuitem", { name: "新供应商", exact: true }).press("ArrowRight");
  await page.getByText("pi-native-test", { exact: true }).click();
  await page.keyboard.press("Escape");

  for (const { size, theme } of [
    { size: { width: 1280, height: 800 }, theme: "dark" },
    { size: { width: 1920, height: 1080 }, theme: "light" },
  ]) {
    await resizeNativeWindow(app, page, size);
    await page.getByTestId("task-settings-button").filter({ visible: true }).click();
    await page.getByRole("button", { name: "外观", exact: true }).click();
    await page.getByTestId("settings-page").getByRole("combobox").first().click();
    await page
      .getByRole("option", { name: theme === "dark" ? "深色" : "浅色", exact: true })
      .click();
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains("dark") === dark,
      theme === "dark",
    );
    await page.getByTestId("settings-back-button").click();
    await page.getByTestId("settings-page").waitFor({ state: "hidden" });

    const input = page.getByTestId("v4-composer-input").filter({ visible: true }).first();
    const text = `PI_TEXT: 中文候选确认 ${size.width}`;
    await input.click();
    await page.keyboard.insertText(text);
    assert((await input.innerText()).includes(text));
    const before = model.requests.length;
    await input.evaluate((el) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
        keyCode: 229,
      });
      el.dispatchEvent(event);
    });
    await page.waitForTimeout(100);
    assert.equal(model.requests.length, before, "Chromium IME keyCode 229 must not reach Pi");
    await input.evaluate((el) =>
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" })),
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    assert.equal(model.requests.length, before, "IME candidate Enter must not reach Pi");
    assert(
      (await input.innerText()).includes(text),
      "IME candidate Enter must preserve the composer draft",
    );
    const trailing = await input.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
        keyCode: 13,
      });
      el.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented };
    });
    assert.equal(
      trailing.defaultPrevented,
      true,
      "Immediate post-composition Enter must be consumed",
    );
    await page.waitForTimeout(150);
    assert.equal(model.requests.length, before, "Post-composition Enter must not reach Pi");
    assert((await input.innerText()).includes(text));
    await page.screenshot({
      path: join(f.output, `pi-ime-${size.width}x${size.height}-${theme}-draft.png`),
    });
    await input.click();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (expected) => document.querySelectorAll("section[data-turn-id]").length >= expected,
      report.cases.length + 1,
      { timeout: 20_000 },
    );
    assert.equal(model.requests.length, before + 1, "Only deliberate Enter submits to Pi");
    assert(
      model.requests.at(-1).promptText.includes(text),
      "Fixed Pi receives the exact Chinese draft",
    );
    model.releaseText();
    await page.getByText("PI_TEXT_COMPLETE", { exact: true }).last().waitFor({ timeout: 30_000 });
    report.cases.push({
      size,
      theme,
      keyCode229Sent: false,
      candidateEnterSent: false,
      trailingEnterSent: false,
      deliberateEnterSent: true,
      piPrompt: model.requests.at(-1).promptText,
    });
    await page.screenshot({
      path: join(f.output, `pi-ime-${size.width}x${size.height}-${theme}-sent.png`),
    });

    // A visible send-button click immediately after composition still means send.
    const clickText = `PI_TEXT: 点击发送 ${size.width}`;
    await input.click();
    await page.keyboard.insertText(clickText);
    await input.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "点" }));
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "点击" }));
    });
    const beforeClick = model.requests.length;
    await page.getByTestId("v4-composer-send").filter({ visible: true }).first().click();
    await page.waitForFunction(
      (expected) => document.querySelectorAll("section[data-turn-id]").length >= expected,
      report.cases.length * 2,
      { timeout: 20_000 },
    );
    assert.equal(
      model.requests.length,
      beforeClick + 1,
      "Explicit button click must not be swallowed",
    );
    assert(model.requests.at(-1).promptText.includes(clickText));
    report.cases.at(-1).buttonClickSent = true;
  }
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  await app
    ?.windows()[0]
    ?.screenshot({ path: join(f.output, "pi-ime-failure.png") })
    .catch(() => {});
} finally {
  try {
    report.cleanup = await closeOwned(app, f);
    assertCleanExit(report.cleanup, logs, "Pi IME GUI");
  } catch (error) {
    report.cleanupError = String(error);
    process.exitCode = 1;
  }
  await model.close();
  await writeFile(join(f.output, "pi-ime-gui-report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, "pi-ime-gui.log"), logs.join(""));
  console.log(JSON.stringify(report, null, 2));
}
