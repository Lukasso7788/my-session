import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  RECENT_ROOM_RESUME_WINDOW_MS,
  clearRecentRoom,
  consumeRecentRoomResume,
  getRecentRoomResumeDecision,
  markRecentRoom,
  readRoomExit,
  recordRoomExit,
  resetRecentRoomResumeForTests,
} from '../src/lib/recentRoomResume.ts';

const ROOM = '8f0f7ad2-5d4f-4bb1-9a0c-6f1d3c2b1a00';
const OTHER_ROOM = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const MINUTE = 60_000;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    size: () => values.size,
  };
}

beforeEach(() => resetRecentRoomResumeForTests());

test('the window is 20 minutes', () => {
  assert.equal(RECENT_ROOM_RESUME_WINDOW_MS, 20 * MINUTE);
});

test('coming back within 20 minutes rejoins, whatever the way in', () => {
  const storage = memoryStorage();
  markRecentRoom(ROOM, 1_000, storage);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 1_000 + 19 * MINUTE, storage }), true);
  assert.equal(storage.size(), 0, 'the record is consumed');
  assert.equal(getRecentRoomResumeDecision(ROOM)?.markerAgeMs, 19 * MINUTE);
});

test('after 20 minutes, or without a record, the entry goes through prejoin', () => {
  const storage = memoryStorage();
  markRecentRoom(ROOM, 1_000, storage);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 1_000 + RECENT_ROOM_RESUME_WINDOW_MS + 1, storage }), false);
  resetRecentRoomResumeForTests();
  assert.equal(consumeRecentRoomResume(ROOM, { now: 1_000, storage }), false);
  assert.equal(getRecentRoomResumeDecision(ROOM)?.markerAgeMs, null);
});

test('a second entry needs the room to mark itself again', () => {
  const storage = memoryStorage();
  markRecentRoom(ROOM, 1_000, storage);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 2_000, storage }), true);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 10_000, storage }), false);
  markRecentRoom(ROOM, 11_000, storage);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 12_000 + 2_001, storage }), true);
});

test('a StrictMode replay of the entry effect repeats the decision', () => {
  const storage = memoryStorage();
  markRecentRoom(ROOM, 1_000, storage);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 2_000, storage }), true);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 2_500, storage }), true);
});

test('records are per room; Leave clears only its own room', () => {
  const storage = memoryStorage();
  markRecentRoom(OTHER_ROOM, 1_000, storage);
  assert.equal(consumeRecentRoomResume(ROOM, { now: 2_000, storage }), false);
  markRecentRoom(ROOM, 1_000, storage);
  clearRecentRoom(OTHER_ROOM, storage);
  assert.equal(storage.size(), 1);
  clearRecentRoom(ROOM, storage);
  assert.equal(storage.size(), 0);
});

test('missing or broken storage falls back to prejoin', () => {
  assert.equal(consumeRecentRoomResume(ROOM, { now: 1, storage: null }), false);
  resetRecentRoomResumeForTests();
  const broken = memoryStorage();
  broken.setItem(`mysession_room_recent_v1:${ROOM}`, '{not json');
  assert.equal(consumeRecentRoomResume(ROOM, { now: 1, storage: broken }), false);
});

test('the last exit is read once by the next join', () => {
  const storage = memoryStorage();
  recordRoomExit(ROOM, { kind: 'hidden', connected: true, visibility: 'hidden', at: 5_000 }, storage);
  assert.deepEqual(readRoomExit(ROOM, storage), { kind: 'hidden', at: 5_000, connected: true, visibility: 'hidden' });
  assert.equal(readRoomExit(ROOM, storage), null);
  assert.equal(readRoomExit(OTHER_ROOM, storage), null);
});
