import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  SAME_TAB_ROOM_RESUME_WINDOW_MS,
  clearSameTabRoomResume,
  consumeSameTabRoomResume,
  getSameTabRoomResumeDecision,
  markSameTabRoomResume,
  resetSameTabRoomResumeForTests,
} from '../src/lib/sameTabRoomResume.ts';

const ROOM = '8f0f7ad2-5d4f-4bb1-9a0c-6f1d3c2b1a00';
const OTHER_ROOM = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    size: () => values.size,
  };
}

beforeEach(() => resetSameTabRoomResumeForTests());

test('a reload of the same tab on the same room resumes once', () => {
  const storage = memoryStorage();
  markSameTabRoomResume(ROOM, ROOM, 1_000, storage);
  const resumed = consumeSameTabRoomResume(ROOM, {
    now: 61_000,
    storage,
    pageInitialPathname: `/room-livekit/${ROOM}`,
  });
  assert.equal(resumed, true);
  assert.equal(storage.size(), 0, 'marker is consumed');
  assert.equal(getSameTabRoomResumeDecision()?.markerAgeMs, 60_000);
});

test('a later in-app entry during the same page load goes through prejoin', () => {
  const storage = memoryStorage();
  markSameTabRoomResume(ROOM, ROOM, 1_000, storage);
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 2_000, storage, pageInitialPathname: `/room-livekit/${ROOM}` }), true);
  markSameTabRoomResume(ROOM, ROOM, 3_000, storage);
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 60_000, storage, pageInitialPathname: `/room-livekit/${ROOM}` }), false);
});

test('a StrictMode replay of the entry effect repeats the first decision', () => {
  const storage = memoryStorage();
  markSameTabRoomResume(ROOM, ROOM, 1_000, storage);
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 2_000, storage, pageInitialPathname: `/room-livekit/${ROOM}` }), true);
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 2_500, storage, pageInitialPathname: `/room-livekit/${ROOM}` }), true);
});

test('pages loaded somewhere else never auto-join a room', () => {
  const storage = memoryStorage();
  markSameTabRoomResume(ROOM, ROOM, 1_000, storage);
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 2_000, storage, pageInitialPathname: '/sessions' }), false);
});

test('a marker for another room or an expired marker does not resume', () => {
  const storage = memoryStorage();
  markSameTabRoomResume(OTHER_ROOM, OTHER_ROOM, 1_000, storage);
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 2_000, storage, pageInitialPathname: `/room-livekit/${ROOM}` }), false);

  resetSameTabRoomResumeForTests();
  markSameTabRoomResume(ROOM, ROOM, 1_000, storage);
  assert.equal(
    consumeSameTabRoomResume(ROOM, {
      now: 1_000 + SAME_TAB_ROOM_RESUME_WINDOW_MS + 1,
      storage,
      pageInitialPathname: `/room-livekit/${ROOM}/`,
    }),
    false,
  );
});

test('explicit leave clears only the matching room marker', () => {
  const storage = memoryStorage();
  markSameTabRoomResume(ROOM, ROOM, 1_000, storage);
  clearSameTabRoomResume(OTHER_ROOM, storage);
  assert.equal(storage.size(), 1);
  clearSameTabRoomResume(ROOM, storage);
  assert.equal(storage.size(), 0);
});

test('missing or broken storage falls back to prejoin', () => {
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 1, storage: null, pageInitialPathname: `/room-livekit/${ROOM}` }), false);
  resetSameTabRoomResumeForTests();
  const broken = memoryStorage();
  broken.setItem('mysession_room_same_tab_resume_v1', '{not json');
  assert.equal(consumeSameTabRoomResume(ROOM, { now: 1, storage: broken, pageInitialPathname: `/room-livekit/${ROOM}` }), false);
});
