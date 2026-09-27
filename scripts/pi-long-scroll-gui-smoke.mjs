// Issue #26: nested long Pi tool output, timeline wheel ownership, and keyboard focus.
import assert from "node:assert/strict";
import { cpus, totalmem } from "node:os";
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
  inference: "fixed Pi RPC with local deterministic loopback provider, not online",
  machine: { cpu: cpus()[0]?.model, memoryGiB: Math.round(totalmem() / 2 ** 30) },
  dataSize: { warmupTurns: 24, toolOutputLines: 120, streamFrames: 24 },
  pageErrors: [],
  stages: {},
};
let app;
const composer = (page) => page.getByTestId("v4-composer-input").filter({ visible: true }).first();
const timeline = (page) => page.getByTestId("v4-timeline");
const position = (page) =>
  timeline(page).evaluate((node) => ({
    top: node.scrollTop,
    height: node.scrollHeight,
    viewport: node.clientHeight,
    gap: node.scrollHeight - node.clientHeight - node.scrollTop,
  }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, attempts = 100) {
  for (let index = 0; index < attempts; index++) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(message);
}
async function send(page, text) {
  const input = composer(page);
  await input.click();
  await page.keyboard.insertText(text);
  await page.keyboard.press("Enter");
}
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
  await composer(page).waitFor();
  assert.match(page.url(), /^file:/);
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
  await page.getByTestId("chat-model-select-search").fill("pi-native-test");
  await page.getByRole("menuitemradio", { name: /pi-native-test/ }).first().click();

  await resizeNativeWindow(app, page, { width: 1280, height: 800 });
  model.releaseText();
  const warmupStarted = Date.now();
  for (let index = 0; index < report.dataSize.warmupTurns; index++) {
    const before = model.requests.length;
    await send(page, `PI_TEXT: history item ${index}`);
    await until(
      () => model.requests.length === before + 1,
      `Pi did not receive warmup turn ${index}`,
    );
    await page.getByText(`PI_TEXT_COMPLETE_${index}`, { exact: true }).waitFor({ timeout: 30_000 });
    await page
      .getByRole("button", { name: "停止生成", exact: true })
      .waitFor({ state: "hidden", timeout: 30_000 });
  }
  report.stages.warmup = {
    requests: model.requests.filter((request) => request.scenario === "PI_TEXT").length,
    elapsedMs: Date.now() - warmupStarted,
  };
  assert.equal(report.stages.warmup.requests, report.dataSize.warmupTurns);

  // Measure renderer keydown-to-frame time with the 24-turn history already mounted.
  // The clock stays entirely inside Chromium, so Playwright transport and model
  // latency cannot be mistaken for the editor's response time.
  const latencyInput = composer(page);
  await latencyInput.click();
  await latencyInput.evaluate((node) => {
    window.__piLongHistoryInputFrames = [];
    node.addEventListener("keydown", (event) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__piLongHistoryInputFrames.push(performance.now() - event.timeStamp);
      }));
    });
  });
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press("A");
    await page.waitForFunction((count) => window.__piLongHistoryInputFrames?.length > count, index);
  }
  const inputFrameMs = await page.evaluate(() => window.__piLongHistoryInputFrames);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  assert.equal((await latencyInput.innerText()).trim(), "", "Latency probe must leave the composer empty");
  const inputSorted = [...inputFrameMs].sort((a, b) => a - b);
  report.stages.inputLatency = { samples: inputSorted.length,
    medianMs: inputSorted[Math.floor(inputSorted.length / 2)],
    p95Ms: inputSorted[Math.ceil(inputSorted.length * 0.95) - 1], maxMs: inputSorted.at(-1) };
  assert(inputSorted.length === 10 && report.stages.inputLatency.p95Ms < 250,
    "Long-history composer response must stay below 250 ms at p95 on this machine");

  await send(page, "PI_LONG_TOOL: inspect 120 line shell output");
  await until(
    () =>
      model.requests.some(
        (request) => request.scenario === "PI_LONG_TOOL" && request.toolResults.length > 0,
      ),
    "Fixed Pi did not execute and report its bash tool",
  );
  await page.getByText("PI_LONG_TOOL_START", { exact: false }).last().waitFor({ timeout: 30_000 });
  const toolCard = page
    .locator('[data-tool-call-id="pi-native-long-bash"]')
    .filter({ visible: true })
    .last();
  await toolCard.waitFor();
  const summary = toolCard.locator("[aria-expanded]").first();
  if ((await summary.getAttribute("aria-expanded")) === "false") await summary.click();
  const inner = page.getByTestId("bash-output-scroll").filter({ visible: true }).last();
  await inner.waitFor();
  const innerSize = await inner.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  assert(
    innerSize.scrollHeight > innerSize.clientHeight + 100,
    "Pi 120 line bash result must create a real nested scroller",
  );
  await inner.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const latest = page.getByTestId("v4-timeline-bottom");
  if (await latest.isVisible()) await latest.click();
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="v4-timeline"]');
    return node && node.scrollHeight - node.clientHeight - node.scrollTop < 65;
  });
  const beforeNested = await position(page);
  const innerBefore = await inner.evaluate((node) => node.scrollTop);
  await inner.hover();
  await page.mouse.wheel(0, -70);
  await page.waitForTimeout(250);
  const innerAfter = await inner.evaluate((node) => node.scrollTop);
  assert(innerAfter < innerBefore, "Wheel must scroll the long Pi output itself");
  assert.equal(
    await latest.isVisible(),
    false,
    "Nested output wheel must not make return-to-latest appear",
  );
  model.releaseLongTool();
  await until(() => model.scrollFrames >= 4, "Pi must stream after nested scroll");
  const afterNested = await position(page);
  assert(afterNested.gap < 65, "Nested wheel must leave the timeline following Pi streaming");
  report.stages.nestedWheel = { innerSize, innerBefore, innerAfter, beforeNested, afterNested };
  await page.screenshot({ path: join(f.output, "pi-long-tool-nested-scroll.png") });

  const outerPoint = await timeline(page).evaluate((node) => {
    const box = node.getBoundingClientRect();
    for (const xFraction of [0.06, 0.09, 0.12, 0.18, 0.5, 0.8]) {
      for (const yFraction of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const x = box.x + box.width * xFraction;
        const y = box.y + box.height * yFraction;
        const target = document.elementFromPoint(x, y);
        if (
          target &&
          node.contains(target) &&
          !target.closest('[data-testid="bash-output-scroll"]')
        ) {
          return { x, y };
        }
      }
    }
    return null;
  });
  assert(outerPoint, "A visible timeline point outside nested output must exist");
  await page.mouse.move(outerPoint.x, outerPoint.y);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(250);
  const manualBefore = await position(page);
  assert(manualBefore.gap > 150, "Real outer wheel must leave the streaming bottom");
  const framesBefore = model.scrollFrames;
  await until(
    () => model.scrollFrames >= framesBefore + 3,
    "Pi must append after the user scrolls up",
  );
  const manualAfter = await position(page);
  assert(manualAfter.gap > 150, "Pi stream must not steal manual timeline scroll");
  assert(await latest.isVisible(), "Return-to-latest must be available after outer scroll");
  await page.screenshot({ path: join(f.output, "pi-long-tool-manual-scroll.png") });
  await latest.click();
  await page
    .getByText("PI_LONG_TOOL_COMPLETE", { exact: false })
    .last()
    .waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="v4-timeline"]');
    return node && node.scrollHeight - node.clientHeight - node.scrollTop < 65;
  });
  report.stages.outerWheel = {
    outerPoint,
    manualBefore,
    manualAfter,
    afterLatest: await position(page),
    streamFrames: model.scrollFrames,
  };
  await page.screenshot({ path: join(f.output, "pi-long-tool-return-latest.png") });

  await resizeNativeWindow(app, page, { width: 1920, height: 1080 });
  await page.getByTestId("task-settings-button").filter({ visible: true }).click();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByTestId("settings-page").getByRole("combobox").first().click();
  await page.getByRole("option", { name: "浅色", exact: true }).click();
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await page.getByTestId("settings-back-button").click();
  await page.getByTestId("settings-page").waitFor({ state: "hidden" });
  const input = composer(page);
  await input.click();
  await page.keyboard.press("Control+m");
  await page.getByTestId("chat-model-select-search").waitFor();
  await page.keyboard.press("Escape");
  report.stages.modelShortcut = {
    opened: true,
    focusReturned: await input.evaluate((node) => node === document.activeElement),
  };
  assert(
    report.stages.modelShortcut.focusReturned,
    "Model menu Escape must return focus to composer",
  );
  await page.screenshot({ path: join(f.output, "pi-long-tool-light-focus.png") });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  await app
    ?.windows()[0]
    ?.screenshot({ path: join(f.output, "pi-long-tool-failure.png") })
    .catch(() => {});
} finally {
  try {
    report.cleanup = await closeOwned(app, f);
    assertCleanExit(report.cleanup, logs, "Pi long scroll GUI");
  } catch (error) {
    report.cleanupError = String(error);
    process.exitCode = 1;
  }
  await model.close();
  await writeFile(
    join(f.output, "pi-long-scroll-gui-report.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(join(f.output, "pi-long-scroll-gui.log"), logs.join(""));
  console.log(JSON.stringify(report, null, 2));
}
