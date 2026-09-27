import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PiContextPageView } from "../src/v4/PiContextDialog.js";

type Page = ComponentProps<typeof PiContextPageView>["page"];

test("context inspector marks Pi message projection and withholds image bytes", () => {
  const page: Page = { section: "effective", offset: 0, limit: 20, total: 1, hasMore: false,
    items: [{ id: "effective-0", kind: "message", role: "user", blocks: [
      { kind: "text", text: "visible preview", totalChars: 30, truncated: true },
      { kind: "image", mimeType: "image/png", bytes: 99 },
    ], omittedBlocks: 2 }] };
  const html = renderToStaticMarkup(createElement(PiContextPageView, { page }));
  assert.match(html, /visible preview/u);
  assert.match(html, /仅显示前 15 \/ 30 字符/u);
  assert.match(html, /图片 · image\/png · 99 字节/u);
  assert.match(html, /另有 2 个内容块未显示/u);
  assert.doesNotMatch(html, /effective-0|dataBase64/u);
});
