import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationSnapshotSchema, statePatchSchema } from "@zcode/shared/zcode-protocol-v4";
import {
  emptyPiExtensionUiState,
  reducePiExtensionUiState,
} from "../src/pi-agent/pi-extension-ui-state.js";

test("Pi status and string widgets replace by key, clear, and survive v4 patch parsing", () => {
  let state = emptyPiExtensionUiState();
  for (const event of [
    { method: "setStatus", id: "1", statusKey: "build", statusText: "running" },
    { method: "setStatus", id: "2", statusKey: "build", statusText: "done" },
    { method: "setWidget", id: "3", widgetKey: "summary", widgetLines: ["line 1", "line 2"], widgetPlacement: "belowEditor" },
    { method: "setWidget", id: "4", widgetKey: "summary", widgetLines: ["replacement"], widgetPlacement: "aboveEditor" },
  ]) state = reducePiExtensionUiState(state, { type: "extension_ui_request", ...event });
  assert.deepEqual(state.statuses, [{ key: "build", text: "done" }]);
  assert.deepEqual(state.widgets, [{ key: "summary", lines: ["replacement"], placement: "aboveEditor" }]);
  assert.deepEqual(statePatchSchema.parse({ piExtensionUi: state }).piExtensionUi, state);
  state = reducePiExtensionUiState(state,
    { type: "extension_ui_request", method: "setStatus", id: "5", statusKey: "build" });
  state = reducePiExtensionUiState(state,
    { type: "extension_ui_request", method: "setWidget", id: "6", widgetKey: "summary" });
  assert.deepEqual(state.statuses, []);
  assert.deepEqual(state.widgets, []);
  assert.equal(conversationSnapshotSchema.shape.piExtensionUi.parse(state).notices.length, 0);
});

test("ordinary notify is bounded and duplicate IDs ignored; control replies stay private", () => {
  let state = emptyPiExtensionUiState();
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "notice-1",
    message: "job complete", notifyType: "info" });
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "notice-1",
    message: "duplicate", notifyType: "error" });
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "bridge",
    message: 'pi-ide-control:{"result":{"apiKey":"secret"}}', notifyType: "info" });
  assert.deepEqual(state.notices.map(notice => notice.message), ["job complete"]);
});

test("Pi bridge shutdown clears only its matching extension display generation", () => {
  let state = emptyPiExtensionUiState();
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "start-1",
    message: 'pi-ide-lifecycle:{"protocol":1,"kind":"start","generation":"gen-1"}' });
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "setStatus", id: "status",
    statusKey: "build", statusText: "running" });
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "stop-old",
    message: 'pi-ide-lifecycle:{"protocol":1,"kind":"shutdown","generation":"older"}' });
  assert.equal(state.statuses.length, 1);
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "stop-1",
    message: 'pi-ide-lifecycle:{"protocol":1,"kind":"shutdown","generation":"gen-1"}' });
  assert.deepEqual(state.statuses, []);
  assert.deepEqual(state.widgets, []);
  assert.deepEqual(state.notices, []);
});

test("extension title and editor text are separate from native session title and survive only their display generation", () => {
  let state = emptyPiExtensionUiState();
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "start",
    message: 'pi-ide-lifecycle:{"protocol":1,"kind":"start","generation":"g"}' });
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "setTitle", id: "title",
    title: "Running extension" });
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "set_editor_text", id: "editor",
    text: "suggested\ninput" });
  assert.deepEqual(state.title, { id: "title", text: "Running extension" });
  assert.deepEqual(state.editorText, { id: "editor", text: "suggested\ninput" });
  assert.deepEqual(statePatchSchema.parse({ piExtensionUi: state }).piExtensionUi, state);
  state = reducePiExtensionUiState(state, { type: "extension_ui_request", method: "notify", id: "stop",
    message: 'pi-ide-lifecycle:{"protocol":1,"kind":"shutdown","generation":"g"}' });
  assert.equal(state.title, undefined);
  assert.equal(state.editorText, undefined);
});
