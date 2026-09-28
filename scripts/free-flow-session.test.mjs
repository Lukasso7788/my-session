import assert from "node:assert/strict";
import test from "node:test";
import { isFreeFlowSchedule } from "../src/lib/freeFlowSession.ts";

test("Free Flow schedules are recognized by either persisted marker", () => {
  assert.equal(isFreeFlowSchedule({ kind: "infinite_room", variant: "free_flow" }), true);
  assert.equal(isFreeFlowSchedule({ kind: "infinite_room", variant: " Free_Flow " }), true);
  assert.equal(isFreeFlowSchedule({ kind: "infinite_room", free_flow: true }), true);
});

test("ordinary custom and preset sessions keep their existing badge", () => {
  assert.equal(isFreeFlowSchedule({ kind: "infinite_room", variant: "preset" }), false);
  assert.equal(isFreeFlowSchedule({ kind: "infinite_room", free_flow: false }), false);
  assert.equal(isFreeFlowSchedule({ kind: "infinite_room", free_flow: "true" }), false);
  assert.equal(isFreeFlowSchedule([]), false);
  assert.equal(isFreeFlowSchedule(null), false);
});
