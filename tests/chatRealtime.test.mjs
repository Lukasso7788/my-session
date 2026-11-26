import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/lib/chatRealtime.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  const channels = [];
  const removed = [];
  const client = {
    channel(topic) {
      const channel = {
        topic,
        on(type, filter, callback) {
          this.type = type;
          this.filter = filter;
          this.onChange = callback;
          return this;
        },
        subscribe(callback) {
          this.onStatus = callback;
          callback("SUBSCRIBED");
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) {
      removed.push(channel);
      return Promise.resolve();
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    () => ({ supabase: client }), module, module.exports,
  );
  return { ...module.exports, channels, removed };
}

test("chat and unread consumers share one filtered subscription and receive all changes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { subscribeToChatMessages, channels, removed } = setup();
  const first = [];
  const second = [];
  const stopFirst = subscribeToChatMessages("room-a", (event) => first.push(event));
  const stopSecond = subscribeToChatMessages("room-a", (event) => second.push(event));
  assert.equal(channels.length, 1);
  assert.deepEqual(channels[0].filter, {
    event: "*", schema: "public", table: "session_chat_messages", filter: "session_id=eq.room-a",
  });
  for (const eventType of ["INSERT", "UPDATE", "DELETE"]) channels[0].onChange({ eventType });
  assert.equal(first.length, 3);
  assert.deepEqual(second, first);
  stopFirst();
  channels[0].onChange({ eventType: "INSERT" });
  assert.equal(first.length, 3);
  assert.equal(second.length, 4);
  stopSecond();
  t.mock.timers.tick(499);
  assert.equal(removed.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(removed, channels);
});

test("panel and PiP handoffs reuse the channel and replay its current status", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { subscribeToChatMessages, channels, removed } = setup();
  subscribeToChatMessages("room-a", () => {})();
  t.mock.timers.tick(200);
  const statuses = [];
  const stop = subscribeToChatMessages("room-a", () => {}, (status) => statuses.push(status));
  await Promise.resolve();
  assert.deepEqual(statuses, ["SUBSCRIBED"]);
  channels[0].onStatus("CHANNEL_ERROR");
  assert.deepEqual(statuses, ["SUBSCRIBED", "CHANNEL_ERROR"]);
  t.mock.timers.tick(500);
  assert.equal(channels.length, 1);
  assert.equal(removed.length, 0);
  stop();
  t.mock.timers.tick(500);
  assert.equal(removed.length, 1);
});

test("rooms stay isolated and a retiring channel cannot remove its replacement", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { subscribeToChatMessages, channels, removed } = setup();
  let roomBEvents = 0;
  subscribeToChatMessages("room-a", () => {})();
  subscribeToChatMessages("room-b", () => roomBEvents++);
  channels[0].onChange({ eventType: "INSERT" });
  assert.equal(roomBEvents, 0);
  t.mock.timers.tick(500);
  subscribeToChatMessages("room-a", () => {});
  assert.equal(channels.length, 3);
  assert.notEqual(channels[0].topic, channels[2].topic);
  assert.deepEqual(removed, [channels[0]]);
});
