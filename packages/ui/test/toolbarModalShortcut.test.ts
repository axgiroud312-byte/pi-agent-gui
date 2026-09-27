import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZCodeConfigOption } from "@zcode/shared";
import { resolveEffectiveShortcutBindings } from "../src/shortcuts/bindings.js";
import { resolveToolbarShortcutAction } from "../src/v4/composer/toolbarShortcuts.js";

const modelOption: ZCodeConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "pi-native-test",
  options: [{ value: "pi-native-test", name: "pi-native-test" }],
};
const key = {
  key: "m",
  code: "KeyM",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  repeat: false,
  isComposing: false,
};
const base = {
  hasAnyOption: true,
  toolbarDisabled: false,
  modelMenuDisabled: false,
  modelOption,
};

test("model shortcut remains available in the composer but does not cross an open modal", () => {
  const bindings = resolveEffectiveShortcutBindings();
  assert.equal(resolveToolbarShortcutAction(key, bindings, base), "openModelMenu");
  assert.equal(resolveToolbarShortcutAction(key, bindings, { ...base, modalOpen: true }), null);
});
