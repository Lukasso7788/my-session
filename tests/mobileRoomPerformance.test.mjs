import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
const downscale = readFileSync("src/lib/backgroundImageDownscale.ts", "utf8");
const prefetch = readFileSync("src/lib/prefetchBackgroundFx.ts", "utf8");
const card = readFileSync("src/components/SessionCard.tsx", "utf8");

test("phones/tablets keep custom backgrounds small", () => {
  assert.match(downscale, /export const MOBILE_BACKGROUND_MAX_SIDE = 1280;/);
  // New uploads are shrunk before they are stored or applied.
  assert.match(room, /async function readImageFileAsDataUrl\(file: File\): Promise<string> \{\s*\/\/[^\n]*\n\s*if \(isMobileOrTabletDeviceLike\(\)\) \{\s*try \{\s*return await downscaleImageFile\(file\);/);
  // Backgrounds saved earlier at full size are shrunk once and saved back.
  assert.match(room, /if \(isMobileOrTabletDeviceLike\(\) && slots\.some\(\(slot\) => isLargeDataUrl\(slot\.dataUrl\)\)\)/);
  assert.match(room, /void saveCustomBackgroundSlots\(shrunk\)/);
  // The two object-URL upload paths use the small copy on mobile too.
  assert.equal((room.match(/if \(lowPowerMobileMode\) \{\s*(\/\/[^\n]*\n\s*)?(url = await readImageFileAsDataUrl\(file\)|void readImageFileAsDataUrl\(file\))/g) || []).length, 2);
});

test("phones/tablets start downloading the segmenter early when an effect is saved", () => {
  assert.match(room, /if \(!lowPowerMobileMode\) return;\s*if \(videoFxMode === "off" && restoredVideoFxPreference\.mode === "off"\) return;\s*prefetchBackgroundFxAssets\(\);/);
  assert.match(prefetch, /priority: "low"/);
});

test("prefetched URLs match the MediaPipe version LiveKit's processor loads", () => {
  const nested = JSON.parse(
    readFileSync("node_modules/@livekit/track-processors/package.json", "utf8"),
  ).dependencies["@mediapipe/tasks-vision"];
  assert.match(prefetch, new RegExp(`TASKS_VISION_VERSION = "${nested.replace(/[.^]/g, "\\$&")}"`));
  const bundled = readFileSync("node_modules/@livekit/track-processors/dist/index.js", "utf8");
  assert.ok(bundled.includes("selfie_segmenter/float16/latest/selfie_segmenter.tflite"));
  assert.match(prefetch, /selfie_segmenter\/float16\/latest\/selfie_segmenter\.tflite/);
});

test("infinite-room schedule is grouped by day and shows no host label", () => {
  assert.match(card, /const hostingScheduleDays = useMemo\(/);
  assert.match(card, /\? "Today"\s*: key === tomorrow\.toDateString\(\)\s*\? "Tomorrow"/);
  const schedule = card.slice(card.indexOf("Hosting schedule"), card.indexOf("Who's coming"));
  assert.doesNotMatch(schedule, />Host</);
  assert.match(schedule, />Now</);
});

test("session details open as a modal (bottom sheet on phones) with one facts block", () => {
  assert.match(card, /fixed inset-0 z-\[950\] flex items-end justify-center sm:items-center/);
  assert.match(card, /session-booking-drawer relative flex max-h-\[92vh\][^"]*rounded-t-\[28px\][^"]*sm:rounded-\[28px\]/);
  assert.match(card, /grid grid-cols-3 divide-x divide-\[#E3E3E3\] rounded-\[18px\] bg-\[#F6F6F6\]/);
  const css = readFileSync("src/index.css", "utf8");
  assert.match(css, /@keyframes sessionBookingDrawerIn \{\s*from \{\s*opacity: 0;\s*transform: translateY\(100%\);/);
  assert.match(css, /@media \(min-width: 640px\) \{\s*\.session-booking-drawer \{\s*animation: sessionDetailsModalIn/);
});