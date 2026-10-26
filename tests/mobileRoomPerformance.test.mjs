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
  assert.match(card, /session-booking-drawer relative flex max-h-\[92vh\][^"]*rounded-t-\[28px\][^"]*sm:max-w-\[1280px\] sm:rounded-\[32px\]/);
  assert.match(card, /grid grid-cols-3 divide-x divide-\[#E3E3E3\] rounded-\[18px\] bg-\[#F6F6F6\]/);
  const css = readFileSync("src/index.css", "utf8");
  assert.match(css, /@keyframes sessionBookingDrawerIn \{\s*from \{\s*opacity: 0;\s*transform: translateY\(100%\);/);
  assert.match(css, /@media \(min-width: 640px\) \{\s*\.session-booking-drawer \{\s*animation: sessionDetailsModalIn/);
});
test("session details modal is page-sized, timeline first, and shows only switched-on rules", () => {
  assert.match(card, /lg:grid lg:grid-cols-\[minmax\(0,1fr\)_440px\]/);
  // Type, when and capacity always show; the rest only when switched on.
  for (const key of ["capacity"]) assert.match(card, new RegExp(`key: "${key}",`));
  const optional = card.slice(card.indexOf("...optionalDetails(["), card.indexOf("]),", card.indexOf("...optionalDetails([")));
  for (const key of ["access", "listing", "pinned", "media", "chat", "mic", "music"]) {
    assert.match(optional, new RegExp(`&& \\{\\s*key: "${key}",`));
  }
  // Host and session flow share the first line; details come before About.
  const body = card.slice(card.indexOf("Phones scroll the whole body"));
  const firstLine = body.slice(body.indexOf("Host and session flow share one line"), body.indexOf("grid grid-cols-3 divide-x"));
  assert.match(firstLine, />Hosted by</);
  assert.match(firstLine, /aria-label="Session flow"/);
  assert.ok(body.indexOf('aria-label="Details"') < body.indexOf(">About<"));
  // Copy link sits in the header next to the close button.
  const header = card.slice(card.indexOf("One line: title, start date and time, status"), card.indexOf("Phones scroll the whole body"));
  assert.match(header, /"Copy link"/);
  assert.match(header, /<XIcon size=\{18\}/);
  // Start date and time sit next to the title; chips use the room's icons.
  assert.match(card, /label: "Length"[\s\S]*?label: "In room"/);
  assert.match(header, /drawerStartShort\.date\} · \$\{drawerStartShort\.time/);
  assert.match(card, /<RoomIcon src="\/icons\/participants-light\.svg" \/>/);
  assert.match(card, /<RoomIcon src="\/icons\/camera-on-light\.svg" \/>/);
  assert.match(card, />In the room now</);
  assert.match(card, /onClick=\{\(\) => void handleCopyInviteLink\(\)\}/);
});
test("hovering any person's avatar opens the shared profile card", () => {
  const layer = readFileSync("src/components/ProfileHoverLayer.tsx", "utf8");
  const main = readFileSync("src/main.tsx", "utf8");
  assert.match(main, /<ProfileHoverLayer \/>/);
  // Mouse only, stats cached per person, timezone and a "Check account" link.
  assert.match(layer, /if \(event\.pointerType !== "mouse"\) return;/);
  assert.match(layer, /const statsCache = new Map/);
  assert.match(layer, /timeZone: timezone/);
  assert.match(layer, />\s*Check account\s*</);
  // The profile opens in a new tab, marked with an external-link icon.
  assert.match(layer, /to=\{`\/profile\/\$\{target\.userId\}`\}\s*target="_blank"\s*rel="noopener noreferrer"/);
  assert.match(layer, /<ExternalLink/);
  // Avatars across the app are marked.
  for (const file of [
    "src/components/SessionCard.tsx",
    "src/pages/HostsPage.tsx",
    "src/pages/LeaderboardPage.tsx",
    "src/components/ChatPanel.tsx",
    "src/components/TasksPanel.tsx",
    "src/components/IntentionsPanel.tsx",
    "src/pages/RoomPageLiveKit.tsx",
  ]) {
    assert.match(readFileSync(file, "utf8"), /profileHoverAttrs\(/, file);
  }
});

test("session details modal hugs its content", () => {
  assert.match(card, /sm:max-h-\[min\(90vh,900px\)\] sm:max-w-\[1280px\]/);
  assert.doesNotMatch(card, /sm:h-\[min\(90vh,900px\)\]/);
});
test("timeline tooltips in the session details modal are not clipped", () => {
  const bar = readFileSync("src/components/SessionStageBar.tsx", "utf8");
  assert.match(bar, /tooltipPortal\?: boolean;/);
  assert.match(bar, /if \(tooltipPortal && hoveredStageRect && typeof document !== "undefined"\) \{[\s\S]*?createPortal\(/);
  assert.match(bar, /fixed z-\[2147483647\]/);
  const flow = card.slice(card.indexOf('aria-label="Session flow"'), card.indexOf('aria-label="Session flow"') + 900);
  assert.match(flow, /tooltipPortal: true,/);
});
test("tile hover shade shows with the camera off in dark rooms only", () => {
  const tile = readFileSync("src/pages/livekit/VideoTileLiveKitLegacy.tsx", "utf8");
  assert.match(tile, /!hasCameraOn && isLight\s*\?\s*""\s*:\s*showAllTasks\s*\?\s*"bg-gradient-to-t from-black\/90 via-black\/72 to-black\/20 opacity-100"\s*:\s*"group-hover:bg-gradient-to-t/);
});
test("gentle camera reminder in every room except camera-required ones", () => {
  const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
  const reminder = readFileSync("src/pages/livekit/CameraOffReminder.tsx", "utf8");
  assert.match(reminder, /export const CAMERA_OFF_REMINDER_DELAY_MS = 5 \* 60_000;/);
  // Not shown where the strict camera policy already reminds and disconnects.
  assert.match(room, /const strictCameraPolicy = roomPolicies\.cameraRequired;/);
  assert.match(room, /strictCameraPolicy \|\|\s*cameraReminderStayOff \|\|\s*cameraOffReminderOpen/);
  // Camera on resets the countdown; "stay off" holds for the session.
  assert.match(room, /if \(camOn \|\| !connected\) \{\s*cameraOffStartedAtRef\.current = null;/);
  assert.match(room, /sessionStorage\.setItem\(cameraReminderStorageKey, "1"\)/);
  assert.match(room, /onRemindLater=\{\(\) => snoozeCameraReminder\(CAMERA_OFF_REMINDER_DELAY_MS\)\}/);
  // MySession style: a rounded label instead of an uppercase eyebrow; three full-width buttons.
  assert.doesNotMatch(reminder, /uppercase/);
  assert.match(reminder, /Camera off for \{minutesOff\} min/);
  assert.equal((reminder.match(/sm:flex-1/g) || []).length, 2);
  assert.match(reminder, />\s*Stay off this session\s*</);
  assert.match(reminder, />\s*Remind me in 5 min\s*</);
  assert.match(reminder, />\s*Turn camera on\s*</);
});
test("camera and screen rules are the same for everyone, hosts and moderators included", () => {
  const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
  const policies = readFileSync("src/lib/roomPolicies.ts", "utf8");
  const settings = readFileSync("src/pages/livekit/RoomSettingsModalLiveKit.tsx", "utf8");
  const create = readFileSync("src/components/CreateSessionModal.tsx", "utf8");
  assert.doesNotMatch(policies, /shouldEnforceMediaPolicyForRole/);
  assert.doesNotMatch(room, /shouldEnforceMediaPolicyForRole/);
  // No toggle that exempts staff anywhere in the UI.
  for (const source of [settings, create, card, room]) assert.doesNotMatch(source, /Apply media rules to hosts and moderators/);
  // The strict camera reminder starts from the room setting alone.
  assert.match(room, /!connected \|\|\s*!roomPolicies\.cameraRequired \|\|\s*camOn \|\|/);
});
test("blur/background comes back after a phone hides and shows the room", () => {
  const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
  // The applied-effect cache is per camera capture, so a new capture gets the effect again.
  assert.match(room, /const signature = `\$\{track\.mediaStreamTrack\.id\}:\$\{effectSignature\}:color:/);
  // A dead or missing processor is replaced.
  assert.match(room, /const processorHealthy =\s*!!processor && processor\.processedTrack\?\.readyState === "live";/);
  assert.match(room, /if \(!processorHealthy\) \{\s*activeFxSignaturesRef\.current\.delete\(track\);/);
  // Checked when the tab is visible again and when the camera is (re)published.
  assert.match(room, /if \(!connected \|\| !pageVisible\) return;\s*\/\/[^\n]*\n\s*const timers = \[700, 2500\]/);
  assert.match(room, /if \(publication\?\.source !== Track\.Source\.Camera\) return;\s*window\.setTimeout\(\(\) => ensureVideoFxRef\.current\(\), 300\);/);
});