import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const room = readFileSync(new URL('../src/pages/RoomPageLiveKit.tsx', import.meta.url), 'utf8');

test('this client stays quiet while it reconnects and right after', () => {
  assert.match(room, /const handleLiveKitReconnecting = \(eventType: string\) => \{\s*\/\/[^\n]*\n\s*mutePresenceSounds\(PRESENCE_SOUNDS_RECONNECT_MUTE_MS\);/);
  assert.match(room, /r\.on\(RoomEvent\.Reconnected, \(\) => \{\s*mutePresenceSounds\(PRESENCE_SOUNDS_AFTER_CONNECT_MUTE_MS\);/);
  assert.match(room, /if \(!terminalDisconnect\) \{\s*\/\/[^\n]*\n\s*mutePresenceSounds\(PRESENCE_SOUNDS_RECONNECT_MUTE_MS\);/);
});

test('someone who drops and comes back makes no join or leave sound', () => {
  // The leave sound waits, and is cancelled if they return.
  assert.match(room, /pendingLeaveSoundTimersRef\.current\.set\(userKey, window\.setTimeout\(/);
  assert.match(room, /\}, PRESENCE_LEAVE_SOUND_DELAY_MS\)\);/);
  // The join sound is skipped for a reconnect.
  assert.match(room, /if \(!isReconnect && now >= presenceSoundsMutedUntilRef\.current && joinSoundEnabledRef\.current\) \{\s*playOneShotFromCandidates\(JOIN_SOUND_CANDIDATES, 0\.8\);/);
  assert.match(room, /\(departedAt !== undefined && now - departedAt < PRESENCE_RECONNECT_WINDOW_MS\)/);
});
