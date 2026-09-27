import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFileMentionMarkdown, parseMentionMarkdown } from "../src/mentions/mentionMarkdown.js";

test("file mentions with Chinese spaces and parentheses remain one clickable Markdown path", () => {
  const markdown = buildFileMentionMarkdown("资料/中文 (最终).md", "中文 (最终).md");
  assert.equal(markdown, "[中文 (最终).md](<./资料/中文 (最终).md>)");
  assert.deepEqual(parseMentionMarkdown(markdown), [{ type: "file", label: "中文 (最终).md" }]);
});

test("simple native file mentions keep the established spelling", () => {
  assert.equal(buildFileMentionMarkdown("src/index.ts", "index.ts"), "[index.ts](./src/index.ts)");
});
