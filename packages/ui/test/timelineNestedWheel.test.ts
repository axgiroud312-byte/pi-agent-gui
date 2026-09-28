import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nestedElementConsumesWheel,
  timelineWheelScrollIntent,
} from "../src/v4/timelineScrollAnchor.js";

test("a long tool output scrolling internally does not cancel timeline auto-follow", () => {
  const inner = { scrollTop: 120, scrollHeight: 900, clientHeight: 200, overflowY: "auto" };
  assert.equal(nestedElementConsumesWheel({ ...inner, deltaY: -80 }), true);
  assert.equal(timelineWheelScrollIntent(-80, true), "none");
  assert.equal(nestedElementConsumesWheel({ ...inner, deltaY: 80 }), true);
  assert.equal(timelineWheelScrollIntent(80, true), "none");
});

test("a wheel at an inner boundary can still scroll the outer timeline", () => {
  assert.equal(
    nestedElementConsumesWheel({
      scrollTop: 0,
      scrollHeight: 900,
      clientHeight: 200,
      overflowY: "auto",
      deltaY: -80,
    }),
    false,
  );
  assert.equal(timelineWheelScrollIntent(-80, false), "awayFromBottom");
  assert.equal(
    nestedElementConsumesWheel({
      scrollTop: 700,
      scrollHeight: 900,
      clientHeight: 200,
      overflowY: "auto",
      deltaY: 80,
    }),
    false,
  );
  assert.equal(timelineWheelScrollIntent(80, false), "towardBottom");
  assert.equal(
    nestedElementConsumesWheel({
      scrollTop: 120,
      scrollHeight: 900,
      clientHeight: 200,
      overflowY: "visible",
      deltaY: -80,
    }),
    false,
  );
  assert.equal(
    nestedElementConsumesWheel({
      scrollTop: 0,
      scrollHeight: 900,
      clientHeight: 200,
      overflowY: "auto",
      overscrollBehaviorY: "contain",
      deltaY: -80,
    }),
    true,
    "a contained inner boundary must not seize timeline scroll intent",
  );
});
