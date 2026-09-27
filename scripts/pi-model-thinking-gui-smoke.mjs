// Issue #3: native model search -> selection -> thinking -> fixed Pi inference.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./native-smoke/fixture.mjs";
import { assertCleanExit, closeOwned } from "./native-smoke/cleanup.mjs";
import { resizeNativeWindow } from "./native-smoke/evidence.mjs";
import {
  configurePiProfile,
  isolatePiPackage,
  verifyPiPackageCleanup,
} from "./native-smoke/pi-package.mjs";

const firstModel = "pi-native-test";
const reasoningModel = "pi-search-reasoning";
const requests = [];
const sockets = new Set();
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ data: [firstModel, reasoningModel].map((id) => ({ id, object: "model" })) }),
    );
    return;
  }
  if (req.method !== "POST" || req.url?.split("?")[0] !== "/v1/chat/completions") {
    res.writeHead(404);
    res.end();
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push({
    model: body.model,
    reasoningEffort: body.reasoning_effort ?? null,
    stream: body.stream,
  });
  const content = `PI_MODEL_${body.model}_COMPLETE`;
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "pi-model-search",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      }),
    );
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (delta, finish_reason = null, usage) =>
    res.write(
      `data: ${JSON.stringify({
        id: "pi-model-search",
        object: "chat.completion.chunk",
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
        ...(usage ? { usage } : {}),
      })}\n\n`,
    );
  send({ role: "assistant", content });
  send({}, "stop", { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 });
  res.end("data: [DONE]\n\n");
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
async function setNativeTheme(page, theme) {
  await page.getByTestId("task-settings-button").filter({ visible: true }).click();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByTestId("settings-page").getByRole("combobox").first().click();
  await page.getByRole("option", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    theme === "dark",
  );
  await page.getByTestId("settings-back-button").click();
  await page.getByTestId("settings-page").waitFor({ state: "hidden" });
}
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const f = await fixture();
await isolatePiPackage(f);
await configurePiProfile(f, {
  url: `http://127.0.0.1:${server.address().port}/v1`,
  modelId: firstModel,
  apiKey: "fixture-not-a-secret",
});
const modelsFile = join(f.env.PI_CODING_AGENT_DIR, "models.json");
const modelConfig = JSON.parse(await readFile(modelsFile, "utf8"));
const first = modelConfig.providers["new-provider"].models[0];
modelConfig.providers["new-provider"].models.push({
  ...first,
  id: reasoningModel,
  name: "Search Reasoning",
  reasoning: true,
});
await writeFile(modelsFile, JSON.stringify(modelConfig));

const logs = [];
const report = {
  at: new Date().toISOString(),
  piVersion: "0.87.0",
  boundary: "production Electron -> Host -> pinned Pi RPC -> deterministic local model",
  pageErrors: [],
  stages: {},
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
  const composer = page.getByTestId("v4-composer-input").filter({ visible: true }).first();
  await composer.waitFor();
  await page.getByTestId("sidebar").getByTestId("task-settings-button").click();
  if (!(await page.getByRole("button", { name: "创建自定义供应商", exact: true }).isVisible())) {
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page.getByTestId("model-provider-add-provider-button").click();
  }
  await page.getByRole("button", { name: "创建自定义供应商", exact: true }).click();
  await page
    .getByTestId("model-provider-base-url-input")
    .fill(`http://127.0.0.1:${server.address().port}/v1`);
  await page.getByTestId("model-provider-api-key-input").fill("fixture-not-a-secret");
  await page.getByTestId("model-provider-api-format-trigger").click();
  await page.getByRole("option", { name: /Chat Completions/ }).click();
  await page.getByTestId("model-provider-add-model-button").click();
  await page.getByPlaceholder("模型 ID", { exact: true }).fill(firstModel);
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByTestId("settings-back-button").click();
  await page.getByTestId("settings-page").waitFor({ state: "hidden" });
  await page.getByTestId("chat-model-select-trigger").click();
  await page.getByRole("menuitem", { name: "新供应商", exact: true }).press("ArrowRight");
  await page.getByText(firstModel, { exact: true }).click();
  await composer.click();
  await page.keyboard.type("PI_TEXT: establish a fixed Pi session");
  await page.getByTestId("v4-composer-send").filter({ visible: true }).first().click();
  await page
    .getByText(`PI_MODEL_${firstModel}_COMPLETE`, { exact: true })
    .waitFor({ timeout: 30_000 });
  assert.equal(requests.at(-1)?.model, firstModel);
  await resizeNativeWindow(app, page, { width: 1280, height: 800 });
  await setNativeTheme(page, "dark");
  await page.getByTestId("chat-model-select-trigger").click();
  const search = page.getByTestId("chat-model-select-search");
  await search.waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("data-testid") === "chat-model-select-search",
  );
  report.stages.searchInitialFocus = true;
  await page.keyboard.type("new-provider pi-search-reasoning");
  report.stages.searchTyped = {
    value: await search.inputValue(),
    active: await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
  };
  assert.equal(report.stages.searchTyped.value, "new-provider pi-search-reasoning");
  assert.equal(await page.getByRole("menuitemradio", { name: firstModel }).count(), 0);
  await page.getByRole("menuitemradio", { name: "Search Reasoning" }).waitFor();
  report.stages.searchFocused = await search.evaluate((node) => node === document.activeElement);
  assert(
    report.stages.searchFocused,
    "Search must retain keyboard focus while filtering Pi models",
  );
  await page.screenshot({ path: join(f.output, "pi-model-search-1280-dark.png") });
  await page.getByRole("menuitemradio", { name: "Search Reasoning" }).click();
  const config = page.getByTestId("v4-model-config");
  await page.waitForFunction(
    (model) =>
      document.querySelector('[data-testid="v4-model-config"]')?.getAttribute("data-model") ===
      model,
    reasoningModel,
  );
  await composer.click();
  await page.keyboard.type("PI_TEXT: run selected reasoning model");
  await page.getByTestId("v4-composer-send").filter({ visible: true }).first().click();
  await page
    .getByText(`PI_MODEL_${reasoningModel}_COMPLETE`, { exact: true })
    .waitFor({ timeout: 30_000 });
  assert.equal(
    requests.at(-1)?.model,
    reasoningModel,
    "Pi provider request must use the searched model",
  );
  await page.waitForFunction(() => {
    const levels =
      document
        .querySelector('[data-testid="v4-model-config"]')
        ?.getAttribute("data-thought-levels")
        ?.split(",") ?? [];
    return levels.includes("off") && levels.some((level) => level !== "off");
  });
  const levels = (await config.getAttribute("data-thought-levels")).split(",");
  const before = await config.getAttribute("data-thought");
  await composer.click();
  await page.keyboard.press("Control+t");
  await page.waitForFunction(
    (oldValue) =>
      document.querySelector('[data-testid="v4-model-config"]')?.getAttribute("data-thought") !==
      oldValue,
    before,
  );
  const selectedThought = await config.getAttribute("data-thought");
  assert(
    levels.includes(selectedThought),
    "The thinking shortcut must only choose a Pi-reported level",
  );
  await resizeNativeWindow(app, page, { width: 1920, height: 1080 });
  await setNativeTheme(page, "light");
  report.stages.thinking = { levels, before, selectedThought };
  await page.screenshot({ path: join(f.output, "pi-model-thinking-1920.png") });
  const responseRows = page.getByText(`PI_MODEL_${reasoningModel}_COMPLETE`, { exact: true });
  const priorResponses = await responseRows.count();
  const priorRequests = requests.length;
  await composer.click();
  await page.keyboard.type("PI_TEXT: keep selected thinking level");
  await page.getByTestId("v4-composer-send").filter({ visible: true }).first().click();
  for (let attempt = 0; attempt < 300; attempt++) {
    if (requests.length > priorRequests && (await responseRows.count()) > priorResponses) break;
    await page.waitForTimeout(100);
  }
  assert(requests.length > priorRequests && (await responseRows.count()) > priorResponses,
    "The thinking change must reach Pi and render a new reply");
  assert.equal(requests.at(-1)?.model, reasoningModel);
  report.stages.contextUsage = {
    used: await config.getAttribute("data-usage-used"),
    max: await config.getAttribute("data-usage-max"),
    unknownVisible: await page.getByTestId("pi-context-usage-unknown").isVisible(),
  };
  assert(
    Number(report.stages.contextUsage.used) > 0,
    "Pi must report effective context after a response",
  );
  assert.equal(report.stages.contextUsage.max, "32000");
  await page.getByTestId("pi-session-usage-trigger").click();
  const usagePanel = page.getByTestId("pi-session-usage-panel");
  await usagePanel.waitFor();
  const inputTokens = await usagePanel.locator('[data-pi-usage-key="chat.piSessionUsage.input"]').innerText();
  report.stages.sessionTotals = {
    inputTokens,
    cost: await usagePanel.getByTestId("pi-session-cost").innerText(),
    effectiveContext: await usagePanel.getByTestId("pi-effective-context").innerText(),
  };
  assert.match(inputTokens, /[1-9]/, "Pi session totals must contain real input usage");
  assert.match(report.stages.sessionTotals.cost, /0[.,]00/, "Zero-rated local model must not invent fees");
  assert.match(report.stages.sessionTotals.effectiveContext, /32,?000/);
  await page.screenshot({ path: join(f.output, "pi-model-usage-1920-light.png") });
  await page.keyboard.press("Escape");
  report.requests = requests;
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  await app
    ?.windows()[0]
    ?.screenshot({ path: join(f.output, "pi-model-thinking-failure.png") })
    .catch(() => {});
} finally {
  try {
    report.cleanup = await closeOwned(app, f);
    assertCleanExit(report.cleanup, logs, "Pi model thinking GUI");
  } catch (error) {
    report.cleanupError = String(error);
    process.exitCode = 1;
  }
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    join(f.output, "pi-model-thinking-gui-report.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(join(f.output, "pi-model-thinking-gui.log"), logs.join(""));
  console.log(JSON.stringify(report, null, 2));
}
