import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PiSessionUsagePopover } from "../src/v4/composer/PiSessionUsagePopover.js";

const intl = { formatMessage: ({ id }: { id: string }) => id } as
  ComponentProps<typeof PiSessionUsagePopover>["intl"];

const usage = {
  contextWindow: null,
  cumulative: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 50, cacheWriteTokens: 10 },
};

test("Pi session usage remains available when Pi does not report a cost", () => {
  const html = renderToStaticMarkup(createElement(PiSessionUsagePopover, { usage, intl, locale: "en-US" }));
  assert.match(html, /data-testid="pi-session-usage-trigger"/u,
    "known token and cache usage must not disappear with an unknown cost");
});
