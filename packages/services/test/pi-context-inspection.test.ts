import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPiContextPage } from "../src/pi-agent/pi-context-inspection.js";

const imageData = "aW1hZ2UtYnl0ZXM=";
const entries = [
  { id: "user-1", parentId: null, type: "message", message: { role: "user", content: [
    { type: "text", text: "ORIGINAL_INPUT" }, { type: "image", mimeType: "image/png", data: imageData },
  ] } },
  { id: "edit-1", parentId: "user-1", type: "context_edit", targetId: "user-1",
    replacement: { content: [{ type: "text", text: "REPLACED_INPUT" }] } },
  { id: "compact-1", parentId: "edit-1", type: "compaction", summary: "PI_COMPACTION_SUMMARY",
    firstKeptEntryId: "user-1", tokensBefore: 123 },
  { id: "branch-1", parentId: "compact-1", type: "branch_summary", summary: "PI_BRANCH_SUMMARY" },
  { id: "edit-2", parentId: "branch-1", type: "context_edit", targetId: "user-1", replacement: null },
];
const currentMessages = [
  { role: "compactionSummary", summary: "PI_COMPACTION_SUMMARY", tokensBefore: 123 },
  { role: "user", content: [{ type: "text", text: "REPLACED_INPUT" }] },
  { role: "bashExecution", command: "private-command", output: "PRIVATE_OUTPUT",
    excludeFromContext: true },
];

test("Pi inspection keeps raw history, current messages, edits and summaries separate", () => {
  const history = projectPiContextPage({ section: "history", entries, currentMessages, offset: 0, limit: 20 });
  const effective = projectPiContextPage({ section: "effective", entries, currentMessages, offset: 0, limit: 20 });
  const edits = projectPiContextPage({ section: "edits", entries, currentMessages, offset: 0, limit: 20 });
  const summaries = projectPiContextPage({ section: "summaries", entries, currentMessages, offset: 0, limit: 20 });
  assert.equal(history.total, 5);
  assert.equal(history.items[0]?.blocks[0]?.text, "ORIGINAL_INPUT");
  assert.equal(effective.total, 3);
  assert.equal(effective.items[1]?.blocks[0]?.text, "REPLACED_INPUT");
  assert.equal(effective.items[2]?.excludedFromModel, true);
  assert.equal(edits.total, 2);
  assert.equal(edits.items[0]?.targetId, "user-1");
  assert.equal(edits.items[1]?.change, "omit");
  assert.equal(summaries.total, 2);
  assert.equal(summaries.items[0]?.blocks[0]?.text, "PI_COMPACTION_SUMMARY");
  assert.equal(summaries.items[1]?.blocks[0]?.text, "PI_BRANCH_SUMMARY");
});

test("Pi inspection pages bounded previews without returning image bytes or arbitrary details", () => {
  const history = projectPiContextPage({ section: "history", entries, currentMessages,
    offset: 0, limit: 1, maxTextChars: 8 });
  assert.equal(history.total, 5);
  assert.equal(history.items.length, 1);
  assert.deepEqual(history.items[0]?.blocks[0], {
    kind: "text", text: "ORIGINAL", totalChars: 14, truncated: true,
  });
  assert.deepEqual(history.items[0]?.blocks[1], { kind: "image", mimeType: "image/png", bytes: 11 });
  assert.equal(JSON.stringify(history).includes(imageData), false);
  assert.equal(JSON.stringify(history).includes("REPLACED_INPUT"), false);
  assert.equal(JSON.stringify(history).includes("PRIVATE_OUTPUT"), false);
  const last = projectPiContextPage({ section: "history", entries, currentMessages, offset: 4, limit: 1 });
  assert.equal(last.items[0]?.id, "edit-2");
  assert.equal(last.hasMore, false);
  assert.throws(() => projectPiContextPage({ section: "history", entries, currentMessages,
    offset: -1, limit: 1 }), /pagination/i);
  assert.throws(() => projectPiContextPage({ section: "history", entries, currentMessages,
    offset: 0, limit: 41 }), /pagination/i);
});

test("Pi inspection does not expose tool arguments or oversized metadata", () => {
  const page = projectPiContextPage({ section: "effective", entries: [], currentMessages: [{ role: "assistant",
    content: [{ type: "toolCall", name: "probe", arguments: { secret: "PRIVATE_ARGUMENT" } },
      { type: "image", mimeType: "x".repeat(400), data: imageData }],
  }], offset: 0, limit: 1 });
  assert.deepEqual(page.items[0]?.blocks[0], { kind: "tool", name: "probe" });
  const image = page.items[0]?.blocks[1];
  assert(image?.kind === "image");
  assert.equal(image.mimeType.length, 256);
  assert.equal(JSON.stringify(page).includes("PRIVATE_ARGUMENT"), false);
});
