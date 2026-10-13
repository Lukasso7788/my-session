import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
const timers = readFileSync("src/lib/backgroundSafeTimers.ts", "utf8");
const tile = readFileSync("src/pages/livekit/VideoTileLiveKitLegacy.tsx", "utf8");

test("LiveKit keep-alive timers run in a worker, switched in only after it answers", () => {
  assert.match(timers, /import \{ CriticalTimers \} from "livekit-client";/);
  assert.match(timers, /if \(event\.data\?\.pong\) \{\s*if \(installState === "pending"\) switchSdkTimers\(\);/);
  // Timers started before the switch are still cleared natively.
  assert.match(timers, /if \(Number\.isFinite\(numeric\) && numeric >= FIRST_WORKER_TIMER_ID\)[\s\S]*native\(id as number \| undefined\);/);
  assert.match(timers, /catch \{\s*installState = "unavailable";/);
  assert.match(room, /installBackgroundSafeLiveKitTimers\(\);/);
});

test("desktop recovers a dropped room while hidden; phones and tablets still wait", () => {
  assert.match(room, /function canRecoverRoomNow\(\): boolean \{[\s\S]*return document\.visibilityState === "visible" \|\| !isTabletOrMobilePiPRuntime\(\);/);
  assert.match(room, /if \(canRecoverRoomNow\(\)\) \{\s*if \(unexpectedDisconnectRecoveryTimerRef\.current\)/);
  assert.match(room, /const restoreFromLease = \(resetBackoff = true\) => \{\s*if \(!canRecoverRoomNow\(\)\) return;/);
  assert.match(room, /if \(!canRecoverRoomNow\(\)\) clearRecoveryRetry\(\);/);
  // No leftover visible-only gate in the recovery loop.
  assert.doesNotMatch(room, /attempt < 2 && !roomIsActuallyConnected\(\); attempt \+= 1\) \{\s*if \(document\.visibilityState !== "visible"\) return;/);
});

test("a dropped participant keeps a Reconnecting tile and returns without join or leave sounds", () => {
  assert.match(room, /const RECONNECT_GRACE_MS = 60_000;/);
  assert.match(room, /const returning = userKey \? reconnectingParticipantsRef\.current\.get\(userKey\) : undefined;\s*if \(returning\) \{[\s\S]*\} else if \(joinSoundEnabledRef\.current\) \{/);
  assert.match(room, /status: "reconnecting",\s*videoTrack: undefined,\s*audioTrack: undefined,/);
  assert.match(room, /\}, RECONNECT_GRACE_MS\);/);
  assert.match(room, /if \(!presentUserKeys\.has\(userKey\)\) next\.push\(entry\.tile\);/);
  assert.match(room, /clearReconnectingParticipants\(\);\s*setTiles\(\[\]\);/);
  assert.match(tile, /if \(key === "reconnecting"\) return "Reconnecting…";/);
});

test("an intentional Leave is announced and handled as a leave right away", () => {
  assert.match(room, /const PRESENCE_TOPIC = "mysession\.presence\.v1";/);
  assert.match(room, /new TextEncoder\(\)\.encode\(JSON\.stringify\(\{ type: "leaving" \}\)\),\s*\{ reliable: true, topic: PRESENCE_TOPIC \},/);
  assert.match(room, /if \(topic === PRESENCE_TOPIC && sender\) \{[\s\S]*intentionalLeaveAtRef\.current\.set\(leavingUserId, Date\.now\(\)\);/);
  assert.match(room, /Date\.now\(\) - \(intentionalLeaveAtRef\.current\.get\(userKey\) \|\| 0\) < 15_000/);
});
