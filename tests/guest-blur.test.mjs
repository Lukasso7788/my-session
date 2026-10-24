import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('../src/components/SessionCard.tsx', import.meta.url), 'utf8');
const switcher = readFileSync(new URL('../src/components/SessionTypeSwitcher.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/SessionsPage.tsx', import.meta.url), 'utf8');

test('signed-out visitors see participant counts and people blurred', () => {
  assert.match(card, /const isGuest = !userId;/);
  // Card: live presence and seat counter; details: stats, seats, in the room, who's coming.
  assert.ok((card.match(/<GuestBlur active=\{isGuest\}/g) || []).length >= 6);
  assert.match(card, /<GuestBlur active=\{isGuest && !!fact\.people\}>/);
  assert.match(card, /<GuestBlur active=\{isGuest && detail\.key === "capacity"\}/);
});

test('guests cannot open the list of people in a session', () => {
  assert.match(card, /if \(!isGuest\) setIsLiveUsersModalOpen\(true\);/);
});

test('the live head count on the session switcher is blurred for guests', () => {
  assert.match(page, /blurLiveCounts=\{!user\?\.id\}/);
  assert.match(switcher, /blurLiveCounts \? "select-none blur-\[3px\]"/);
});
