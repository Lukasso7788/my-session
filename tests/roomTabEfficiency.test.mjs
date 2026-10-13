import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
const livekit = readFileSync("node_modules/livekit-client/dist/livekit-client.esm.mjs", "utf8");

test("remote video pauses in a hidden tab only where every PiP path is one LiveKit keeps playing", () => {
  assert.match(room, /function shouldPauseRemoteVideoInBackground\(\): boolean \{\s*if \(typeof window === "undefined"\) return false;\s*if \(isTabletOrMobilePiPRuntime\(\)\) return false;\s*return typeof \(window as WindowWithDocumentPiP\)\.documentPictureInPicture !== "undefined";\s*\}/);
  // Both Room constructions (pre-warm and connect) use it; none hard-codes false.
  assert.equal((room.match(/pauseVideoInBackground: shouldPauseRemoteVideoInBackground\(\)/g) || []).length, 2);
  assert.doesNotMatch(room, /pauseVideoInBackground: false/);
  // The SDK keeps a track playing while its element is in PiP, Document PiP included.
  assert.match(livekit, /const isVisible = this\.elementInfos\.some\(info => info\.visible\) && !backgroundPause \|\| isPiPMode;/);
  assert.match(livekit, /if \(\(_a = window\.documentPictureInPicture\) === null \|\| _a === void 0 \? void 0 : _a\.window\) return isElementInViewport\(el/);
});

test("music progress re-renders the room at most once a second and resume stays exact", () => {
  assert.match(room, /setSoundscapePosition\(Math\.floor\(engine\.currentTime\(\)\)\);/);
  assert.match(room, /setPersonalSoundscapePosition\(Math\.floor\(engine\.currentTime\(\)\)\);/);
  assert.match(room, /personalSoundscapeId === id && !personalSoundscapePlaying\s*\? engine\.currentTime\(\)\s*: 0;/);
});
