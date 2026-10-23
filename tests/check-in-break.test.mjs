import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the phase is named "Check-in & break" and uses the Intentions color', () => {
  const lib = read('src/lib/checkInBreak.ts');
  assert.match(lib, /CHECK_IN_BREAK_TITLE = "Check-in & break"/);
  assert.match(lib, /INTENTIONS_COLOR = "#ADD3FF"/);
});

test('new preset sessions create "Check-in & break" in the Intentions color', () => {
  const modal = read('src/components/CreateSessionModal.tsx');
  assert.match(modal, /title: CHECK_IN_BREAK_TITLE,\s*note: `\$\{preset\.breakMinutes\}-minute quick check-in and break`,\s*minutes: preset\.breakMinutes,\s*color: INTENTIONS_COLOR,/);
  assert.doesNotMatch(modal, /title:[^\n]*"Break & check-in"/);
});

test('every timeline renders older "Break & check-in" phases the new way', () => {
  assert.match(read('src/components/SessionStageBar.tsx'), /if \(isCheckInBreakName\(stageTitle\(stage\)\)\) return "checkin";/);
  assert.match(read('src/components/SessionCard.tsx'), /isCheckInBreakName\(block\.title\)\s*\?\s*\{ \.\.\.block, title: CHECK_IN_BREAK_TITLE, color: INTENTIONS_COLOR \}/);
  assert.match(read('src/lib/roomTimelineModel.ts'), /title: CHECK_IN_BREAK_TITLE, color: INTENTIONS_COLOR/);
  const room = read('src/pages/RoomPageLiveKit.tsx');
  assert.equal((room.match(/setStages\(formatted\.map\(canonicalRoomStage\)\)/g) || []).length, 4);
  assert.doesNotMatch(room, /setStages\(formatted\);/);
});

test('check-in blocks share the Intentions color in the session editor', () => {
  assert.match(read('src/components/SessionCard.tsx'), /case "checkin":\s*\/\/ Check-ins share the Intentions color\.\s*return INTENTIONS_COLOR;/);
});
