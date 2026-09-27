import assert from "node:assert/strict";
import { test } from "node:test";
import { PiSessionDialogGuard } from "../src/v4/piSessionDialogGuard.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("a router catalog from session A cannot replace a later session B read", async () => {
  const guard = new PiSessionDialogGuard();
  const oldRead = deferred<string>();
  const newRead = deferred<string>();
  let visible = "";
  const oldTicket = guard.begin("session A");
  const oldTask = oldRead.promise.then(value => { if (guard.isCurrent(oldTicket)) visible = value; });
  const firstScope = guard.syncContext("session A");
  const secondScope = guard.syncContext("session B");
  assert.notEqual(firstScope, secondScope, "rendering B must hide state tagged with A's scope");
  const newTicket = guard.begin("session B");
  const newTask = newRead.promise.then(value => { if (guard.isCurrent(newTicket)) visible = value; });
  newRead.resolve("B catalog");
  await newTask;
  oldRead.resolve("A catalog");
  await oldTask;
  assert.equal(visible, "B catalog");
});

test("cancel and close invalidate an earlier action even when the same session reopens", () => {
  const guard = new PiSessionDialogGuard();
  const actionTicket = guard.begin("session A");
  const cancelTicket = guard.begin("session A");
  assert.equal(guard.isCurrent(actionTicket), false);
  assert.equal(guard.isCurrent(cancelTicket), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(cancelTicket), false);
  const reopenedTicket = guard.begin("session A");
  assert.equal(guard.isCurrent(reopenedTicket), true);
  assert.equal(guard.isCurrent(actionTicket), false);
  guard.syncContext("session B");
  assert.equal(guard.isCurrent(reopenedTicket), false);
  assert.notEqual(guard.syncContext("session A"), reopenedTicket.scope);
});
