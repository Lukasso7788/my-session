import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advertiseSharedMusic, musicSessionIdsFromPresence, roomMusicPresenceKey,
  sameSessionIds, sharedRoomMusicActive, SESSION_LIVE_STATUS_CHANNEL,
} from '../src/lib/roomMusicPresence.ts';

const room = '081ef47a-362b-479e-8246-ede214073448';
const waitFor = async (predicate) => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Presence setup timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test('only shared room music or tab music advertises while connected', () => {
  assert.equal(sharedRoomMusicActive(true, 'ambient', true, false, false), true);
  assert.equal(sharedRoomMusicActive(true, 'ambient', false, false, false), false);
  assert.equal(sharedRoomMusicActive(true, null, false, true, false), true);
  assert.equal(sharedRoomMusicActive(true, null, false, false, true), true);
  assert.equal(sharedRoomMusicActive(false, 'ambient', true, true, true), false);
  // The personal soundtrack is deliberately not an input to this predicate.
  assert.equal(sharedRoomMusicActive(true, null, false, false, false), false);
});

test('opaque room keys are stable, case-insensitive and expose no session UUID', async () => {
  const key = await roomMusicPresenceKey(room);
  assert.equal(key, await roomMusicPresenceKey(room.toUpperCase()));
  assert.match(key, /^shared-music:[a-f0-9]{64}$/);
  assert.equal(key.includes(room), false);
  await assert.rejects(roomMusicPresenceKey(''));
});

test('the listing accepts only playing presences for its visible sessions', async () => {
  const key = await roomMusicPresenceKey(room);
  const other = await roomMusicPresenceKey('77777777-7777-4777-8777-777777777777');
  const visible = new Map([[key, room]]);
  const state = {
    [key]: [{ playing: false }, { playing: true }],
    [other]: [{ playing: true }],
    unknown: [{ playing: true }],
  };
  assert.deepEqual([...musicSessionIdsFromPresence(state, visible)], [room]);
  assert.deepEqual([...musicSessionIdsFromPresence({ [key]: [{ playing: false }] }, visible)], []);
  assert.deepEqual([...musicSessionIdsFromPresence({ [key]: [{ playing: 'true' }] }, visible)], []);
  assert.equal(sameSessionIds(new Set([room]), new Set([room])), true);
  assert.equal(sameSessionIds(new Set([room]), new Set()), false);
});

test('publisher tracks on subscribe/reconnect, then removes channel on pause', async () => {
  const log = [];
  const channel = {
    subscribe(callback) { this.status = callback; return this; },
    track(payload) { log.push(['track', payload]); return Promise.resolve('ok'); },
  };
  const client = {
    channel(topic, options) { log.push(['channel', topic, options]); return channel; },
    removeChannel(value) { log.push(['remove', value]); return Promise.resolve('ok'); },
  };
  const stop = advertiseSharedMusic(client, room);
  await waitFor(() => log.some(([type]) => type === 'channel'));
  assert.equal(log[0][1], SESSION_LIVE_STATUS_CHANNEL);
  assert.equal(log[0][2].config.presence.enabled, false);
  assert.equal(log[0][2].config.presence.key, await roomMusicPresenceKey(room));
  channel.status('SUBSCRIBED'); channel.status('SUBSCRIBED');
  assert.equal(log.filter(([type]) => type === 'track').length, 2);
  stop(); channel.status('SUBSCRIBED');
  assert.equal(log.filter(([type]) => type === 'track').length, 2);
  assert.equal(log.filter(([type]) => type === 'remove').length, 1);
});

test('leaving before key generation cannot create a late channel', async () => {
  let calls = 0;
  const client = { channel() { calls++; throw new Error('late channel'); }, removeChannel() { calls++; } };
  advertiseSharedMusic(client, room)();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 0);
});
