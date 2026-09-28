import assert from "node:assert/strict";
import { test } from "node:test";
import { PiSettingsReadGuard } from "../src/settings/piSettingsReadGuard.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a slower old settings read cannot replace the newly selected scope or workspace", async () => {
  const guard = new PiSettingsReadGuard();
  const oldRead = deferred<string>();
  const newRead = deferred<string>();
  let visible = "";
  const oldTicket = guard.begin("C:/one", "user");
  const oldTask = oldRead.promise.then(value => { if (guard.isCurrent(oldTicket)) visible = value; });
  guard.syncContext("C:/two", "project");
  const newTicket = guard.begin("C:/two", "project");
  const newTask = newRead.promise.then(value => { if (guard.isCurrent(newTicket)) visible = value; });
  newRead.resolve("new project settings");
  await newTask;
  oldRead.resolve("old user settings");
  await oldTask;
  assert.equal(visible, "new project settings");
});

test("typing while a settings read is pending preserves the draft", async () => {
  const guard = new PiSettingsReadGuard();
  const read = deferred<string>();
  let visible = "original";
  const ticket = guard.begin("C:/one", "user");
  const task = read.promise.then(value => { if (guard.isCurrent(ticket)) visible = value; });
  guard.markEdited();
  visible = "user draft";
  read.resolve("stale disk settings");
  await task;
  assert.equal(visible, "user draft");
  assert.equal(guard.isLatestRead(ticket), true, "latest read may clear its loading indicator");
});
