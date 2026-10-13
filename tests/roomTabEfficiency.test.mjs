import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");

test("remote video keeps playing in a hidden tab (no background pause anywhere)", () => {
  // Both Room constructions (pre-warm and connect) keep background video on.
  assert.equal((room.match(/pauseVideoInBackground: false/g) || []).length, 2);
  assert.doesNotMatch(room, /pauseVideoInBackground: (true|should)/);
});

test("music progress re-renders the room at most once a second and resume stays exact", () => {
  assert.match(room, /setSoundscapePosition\(Math\.floor\(engine\.currentTime\(\)\)\);/);
  assert.match(room, /setPersonalSoundscapePosition\(Math\.floor\(engine\.currentTime\(\)\)\);/);
  assert.match(room, /personalSoundscapeId === id && !personalSoundscapePlaying\s*\? engine\.currentTime\(\)\s*: 0;/);
});
