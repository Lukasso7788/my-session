import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Source-level guards for the 2026-10-11 room disconnect fixes
// (docs/room-disconnect-audit-2026-10-11.md). They fail if a later edit
// silently reintroduces one of the confirmed causes.
const root = new URL('..', import.meta.url).pathname;
const read = (file) => readFileSync(join(root, file), 'utf8');
const room = read('src/pages/RoomPageLiveKit.tsx');
const app = read('src/App.tsx');
const bottomBar = read('src/pages/livekit/LiveKitBottomBarLegacy.tsx');

test('side panels are preloaded after connect and protected by boundaries', () => {
  for (const panel of ['ChatPanel', 'TasksPanel', 'RoomSoundscapePanel']) {
    assert.match(room, new RegExp(`const ${panel} = preloadableLazy\\(`));
    assert.match(room, new RegExp(`${panel}\\.preload\\(\\)`));
  }
  assert.equal((room.match(/<RoomPanelErrorBoundary/g) || []).length, 4, 'chat, PiP chat, music and tasks');
  assert.match(room, /return deferDynamicImportReloads\(\);/);
  assert.match(room, /APP_UPDATE_AVAILABLE_EVENT/);
});

test('the room has a crash boundary and a one-time same-tab rejoin after reload', () => {
  assert.match(app, /<RoomCrashBoundary key=\{sessionId\} routeId=\{sessionId\}>/);
  assert.match(app, /if \(!consumeSameTabRoomResume\(sessionId\)\) clearRoomEntryRecoveryLease\(sessionId\);/);
  assert.match(room, /sameTabResumeEligibleSessions\.has\(sessionId\)/);
});

test('background recovery keeps the room when the token request fails', () => {
  assert.match(room, /requestToken\(\{ recovery: true \}\)/);
  assert.match(room, /if \(options\.recovery\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*return undefined;/);
  assert.match(room, /res\.status === 401/);
});

test('media policy countdowns pause while hidden or reconnecting', () => {
  assert.equal((room.match(/!pageVisible \|\|\s*\n\s*livekitReconnecting \|\|\s*\n\s*mobileMediaRestoreOpen/g) || []).length, 2);
  assert.match(room, /setLivekitReconnecting\(true\)/);
});

test('leaving needs confirmation by tap and by voice', () => {
  assert.match(bottomBar, /setLeaveConfirmOpen\(\(open\) => !open\)/);
  assert.match(bottomBar, /aria-label="Leave the room\?"/);
  assert.match(room, /voiceLeaveConfirmUntilRef\.current > Date\.now\(\)/);
});

test('the room shell no longer re-renders every second', () => {
  assert.doesNotMatch(room, /setRemainingTime/);
  assert.doesNotMatch(room, /setSessionAccessTickMs\(Date\.now\(\)\),\s*1000/);
  assert.match(room, /remainingTimeStore\.set\(/);
});

test('room timing uses the measured server clock', () => {
  assert.match(room, /const now = serverNow\(\);/);
  assert.match(room, /const nowMs = sessionAccessTickMs \+ serverClockOffsetMs;/);
  assert.match(read('src/components/SessionStageBar.tsx'), /const nowMs = serverNow\(\);/);
});

test('the side panel keeps one mount point across layouts', () => {
  assert.match(room, /createPortal\(RightPanelBody, rightPanelHost\)/);
  assert.equal((room.match(/ref=\{attachRightPanelHost\}/g) || []).length, 2);
});
