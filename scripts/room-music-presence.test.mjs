import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advertiseSharedMusic, musicSessionIdsFromPresence, roomMusicPresenceKey,
  sameSessionIds, sharedRoomMusicActive, SESSION_LIVE_STATUS_CHANNEL,
} from "../src/lib/roomMusicPresence.ts";

const room = "081ef47a-362b-479e-8246-ede214073448";
const waitFor = async (predicate) => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Presence setup timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("only a connected shared music publisher advertises", () => {
  assert.equal(sharedRoomMusicActive(true, "ambient", true, true, false), true);
  assert.equal(sharedRoomMusicActive(true, "ambient", true, false, false), false);
  assert.equal(sharedRoomMusicActive(true, null, false, false, true), true);
  assert.equal(sharedRoomMusicActive(false, "ambient", true, true, true), false);
  assert.equal(sharedRoomMusicActive(true, null, false, false, false), false);
});

test("presence keys are stable and do not reveal session IDs", async () => {
  const key = await roomMusicPresenceKey(room);
  assert.equal(key, await roomMusicPresenceKey(room.toUpperCase()));
  assert.match(key, /^shared-music:[a-f0-9]{64}$/);
  assert.equal(key.includes(room), false);
  await assert.rejects(roomMusicPresenceKey(""));
});

test("only visible sessions with playing presence get music badges", async () => {
  const key = await roomMusicPresenceKey(room);
  const visible = new Map([[key, room]]);
  assert.deepEqual([...musicSessionIdsFromPresence({ [key]: [{ playing: true }] }, visible)], [room]);
  assert.deepEqual([...musicSessionIdsFromPresence({ [key]: [{ playing: false }] }, visible)], []);
  assert.deepEqual([...musicSessionIdsFromPresence({ [key]: [{ playing: "true" }] }, visible)], []);
  assert.equal(sameSessionIds(new Set([room]), new Set([room])), true);
  assert.equal(sameSessionIds(new Set([room]), new Set()), false);
});

test("publisher tracks on subscribe/reconnect and cleans up on stop", async () => {
  const calls = [];
  const channel = {
    subscribe(callback) { this.onStatus = callback; return this; },
    track(payload) { calls.push(["track", payload]); return Promise.resolve("ok"); },
  };
  const client = {
    channel(topic, options) { calls.push(["channel", topic, options]); return channel; },
    removeChannel(value) { calls.push(["remove", value]); return Promise.resolve("ok"); },
  };
  const stop = advertiseSharedMusic(client, room);
  await waitFor(() => calls.some(([kind]) => kind === "channel"));
  assert.equal(calls[0][1], SESSION_LIVE_STATUS_CHANNEL);
  assert.equal(calls[0][2].config.presence.key, await roomMusicPresenceKey(room));
  assert.equal(calls[0][2].config.presence.enabled, true);
  channel.onStatus("SUBSCRIBED");
  channel.onStatus("SUBSCRIBED");
  assert.equal(calls.filter(([kind]) => kind === "track").length, 2);
  stop();
  channel.onStatus("SUBSCRIBED");
  assert.equal(calls.filter(([kind]) => kind === "track").length, 2);
  assert.equal(calls.filter(([kind]) => kind === "remove").length, 1);
});

test("unmount before hash completion never opens a late channel", async () => {
  let calls = 0;
  const client = { channel() { calls++; }, removeChannel() { calls++; } };
  advertiseSharedMusic(client, room)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 0);
});
