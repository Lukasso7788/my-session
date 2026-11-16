import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/roomTimelineModel.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { getEditedCycleAnchor, getTimelineEditWindow, preserveStartedTimelineBlocks, timelineBlocksToSchedulePayload, timelineBlocksFromSchedule, withScheduleRoomPolicies, indexedScheduleBlocks } = mod.exports;

const pomodoro = [{ id: "g", kind: "intentions", title: "Share your goals", minutes: 5 }];
for (let i = 1; i <= 8; i++) {
  pomodoro.push({ id: `f${i}`, kind: "focus", title: "Focus", minutes: 25 });
  if (i < 8) pomodoro.push({ id: `b${i}`, kind: "break", title: "Break", minutes: 5 });
}
pomodoro.push({ id: "p", kind: "recap", title: "Share your progress", minutes: 5 });
const policies = { camera_required: true, public_chat_disabled: false };

test("saving a room timeline with room policies keeps the blocks under `blocks`", () => {
  const schedule = withScheduleRoomPolicies(timelineBlocksToSchedulePayload(pomodoro), policies);
  assert.ok(Array.isArray(schedule.blocks));
  assert.equal(schedule.blocks.length, 17);
  assert.deepEqual(schedule.room_policies, policies);
  assert.equal(Object.keys(schedule).some((key) => /^\d+$/.test(key)), false);
  assert.equal(timelineBlocksFromSchedule(schedule).length, 17);
});

test("schedules without room policies and infinite schedules are left as they are", () => {
  const plain = timelineBlocksToSchedulePayload(pomodoro);
  assert.equal(withScheduleRoomPolicies(plain, null), plain);
  const infinite = timelineBlocksToSchedulePayload(pomodoro, { preserveInfinite: true, anchorTs: "2026-11-01T00:00:00Z" });
  const withPolicies = withScheduleRoomPolicies(infinite, policies);
  assert.equal(withPolicies.kind, "infinite_room");
  assert.equal(withPolicies.timer.phases.length, 17);
});

test("schedules saved with the blocks spread into numbered keys read back in order", () => {
  const broken = { ...timelineBlocksToSchedulePayload(pomodoro), room_policies: policies };
  assert.equal(indexedScheduleBlocks(broken).length, 17);
  const blocks = timelineBlocksFromSchedule(broken);
  assert.equal(blocks.length, 17);
  assert.equal(blocks[0].title, "Share your goals");
  assert.equal(blocks[16].title, "Share your progress");
  assert.equal(blocks.reduce((sum, block) => sum + block.minutes, 0), 245);
  assert.equal(indexedScheduleBlocks({ blocks: [], room_policies: policies }), null);
});

const originalCycle = [
  { id: "focus", kind: "focus", title: "Focus", minutes: 25 },
  { id: "break", kind: "break", title: "Break", minutes: 5 },
  { id: "checkin", kind: "checkin", title: "Check-in", minutes: 5 },
];
const anchor = "2026-11-01T00:00:00.000Z";
// Two cycles have passed, followed by 7 minutes and 23 seconds in Focus.
const nowMs = Date.parse(anchor) + (77 * 60 + 23) * 1000;
const cycleElapsedAfterEdit = (nextBlocks) => {
  const nextAnchor = getEditedCycleAnchor({
    anchor,
    nowMs,
    previousBlocks: originalCycle.map(({ id, minutes }) => ({ id, seconds: minutes * 60 })),
    nextBlocks,
  });
  const cycleMs = nextBlocks.reduce((sum, block) => sum + block.minutes * 60_000, 0);
  return ((nowMs - Date.parse(nextAnchor)) % cycleMs) / 1000;
};

test("saving an edited 24/7 timeline keeps elapsed time in the active block after changing its duration and position", () => {
  const [focus, pause, checkin] = originalCycle;
  assert.equal(cycleElapsedAfterEdit([pause, { ...focus, minutes: 30 }, checkin]), (5 + 7) * 60 + 23);
});

test("shortening an active block past elapsed time starts the next block at its beginning", () => {
  const [focus, pause, checkin] = originalCycle;
  assert.equal(cycleElapsedAfterEdit([{ ...focus, minutes: 5 }, pause, checkin]), 5 * 60);
});

test("deleting the active block starts the next surviving block from the old schedule", () => {
  const [, pause, checkin] = originalCycle;
  assert.equal(cycleElapsedAfterEdit([checkin, pause]), 5 * 60);
});

test("saving non-timing changes keeps the existing 24/7 anchor", () => {
  assert.equal(getEditedCycleAnchor({
    anchor,
    nowMs,
    previousBlocks: originalCycle.map(({ id, minutes }) => ({ id, seconds: minutes * 60 })),
    nextBlocks: originalCycle.map((block) => ({ ...block, title: block.title + " edited" })),
  }), anchor);
});

test("the editing boundary follows room time, including 24/7 rollover and finite completion", () => {
  const start = Date.parse(anchor);
  const stages = [60, 90, 120];
  assert.equal(getTimelineEditWindow(anchor, start - 1, stages, false).lockedCount, 0);
  assert.equal(getTimelineEditWindow(anchor, start, stages, false).nextBoundaryMs, start + 60_000);
  assert.equal(getTimelineEditWindow(anchor, start + 60_000, stages, false).lockedCount, 2);
  const finished = getTimelineEditWindow(anchor, start + 270_000, stages, false);
  assert.equal(finished.currentIndex, -1);
  assert.equal(finished.finished, true);
  assert.equal(finished.lockedCount, 3);
  const looped = getTimelineEditWindow(anchor, start + 270_000, stages, true);
  assert.equal(looped.currentIndex, 0);
  assert.equal(looped.lockedCount, 1);
  assert.equal(looped.finished, false);
});

test("saving across a boundary restores started blocks and saves remaining upcoming changes", () => {
  const [focus, pause, checkin] = originalCycle;
  const changedCheckin = { ...checkin, title: "Share progress" };
  const validDraft = [focus, { ...pause, minutes: 8 }, changedCheckin];
  assert.equal(preserveStartedTimelineBlocks(originalCycle, validDraft, 1), validDraft);
  assert.deepEqual(preserveStartedTimelineBlocks(originalCycle, validDraft, 2), [focus, pause, changedCheckin]);
  assert.deepEqual(preserveStartedTimelineBlocks(originalCycle, [changedCheckin, focus], 2), [focus, pause, changedCheckin]);
});

test("started blocks retain exact seconds when an upcoming stage is edited", () => {
  const lockedStageSeconds = [25 * 60 + 20];
  const nextBlocks = [originalCycle[0], { ...originalCycle[1], minutes: 8 }];
  const finite = timelineBlocksToSchedulePayload(nextBlocks, { lockedStageSeconds });
  const infinite = timelineBlocksToSchedulePayload(nextBlocks, { preserveInfinite: true, anchorTs: anchor, lockedStageSeconds });
  assert.equal(finite[0].seconds, lockedStageSeconds[0]);
  assert.equal(infinite.timer.phases[0].seconds, lockedStageSeconds[0]);
  assert.equal(infinite.timer.phases[1].seconds, undefined);
});
