import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/roomTimelineModel.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { timelineBlocksToSchedulePayload, timelineBlocksFromSchedule, withScheduleRoomPolicies, indexedScheduleBlocks } = mod.exports;

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
