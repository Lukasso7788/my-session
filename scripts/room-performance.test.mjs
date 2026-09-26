import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { boundChatMessages, reconcileChatSnapshot, CHAT_WINDOW_LIMIT } from "../src/lib/chatMessageWindow.ts";
import { RoomSoundscapeEngine } from "../src/lib/roomSoundscapes.ts";
import { isPublishedColorCorrectionIdentity, publishedColorCorrectionSignature } from "../src/lib/publishedColorCorrection.ts";

const message = (id, body = String(id)) => ({ id: String(id).padStart(4, "0"), created_at: `2026-09-26T12:${String(Math.floor(Number(id) / 60)).padStart(2, "0")}:${String(Number(id) % 60).padStart(2, "0")}.000Z`, body });

test("chat history is bounded, ordered and deduplicated", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => message(i));
  const bounded = boundChatMessages([...rows.reverse(), message(999, "confirmed")]);
  assert.equal(bounded.length, CHAT_WINDOW_LIMIT);
  assert.equal(bounded[0].id, "0700");
  assert.equal(bounded.at(-1).body, "confirmed");
});

test("stale SELECT cannot undo insert, edit or deletion", () => {
  const snapshot = [message(1), message(2), message(3)];
  const current = [message(1, "edited"), message(3), message(4)];
  const next = reconcileChatSnapshot(snapshot, current, new Set(["0001", "0002", "0004"]));
  assert.deepEqual(next.map((row) => row.id), ["0001", "0003", "0004"]);
  assert.equal(next[0].body, "edited");
});

test("reconnect keeps older pages but refreshes the latest page", () => {
  assert.deepEqual(reconcileChatSnapshot([message(3, "new")], [message(1), message(2), message(3)], new Set()).map((row) => row.body), ["1", "2", "new"]);
  assert.deepEqual(reconcileChatSnapshot([], [message(1)], new Set()), []);
});

test("color helpers preserve identity and normalized signatures", () => {
  assert.equal(isPublishedColorCorrectionIdentity({ brightness: 100, contrast: 100, saturation: 100, warmth: 0 }), true);
  assert.equal(publishedColorCorrectionSignature({ brightness: 999, contrast: 0, saturation: 250, warmth: -200 }), "150:50:200:-100");
});

class FakeAudio extends EventTarget {
  static instances = [];
  constructor() {
    super();
    this.src = "";
    this.currentTime = 0;
    this.duration = 120;
    this.readyState = 0;
    this.paused = true;
    FakeAudio.instances.push(this);
  }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
  load() { this.readyState = 0; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  ready() { this.readyState = 1; this.dispatchEvent(new Event("loadedmetadata")); }
}

const previous = { window: globalThis.window, Audio: globalThis.Audio, HTMLMediaElement: globalThis.HTMLMediaElement };
let engine;
beforeEach(() => {
  globalThis.window = { location: { href: "https://mysession.test/" }, setTimeout, clearTimeout, setInterval, clearInterval };
  globalThis.Audio = FakeAudio;
  globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };
  FakeAudio.instances = [];
  engine = new RoomSoundscapeEngine();
});
afterEach(() => {
  engine.destroy();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

test("no audio loads until Play; standby never delays initial playback", async () => {
  assert.equal(FakeAudio.instances.length, 0);
  const playing = engine.play("rain", 0.35);
  assert.equal(FakeAudio.instances.length, 2);
  assert.equal(FakeAudio.instances[0].preload, "metadata");
  FakeAudio.instances[0].ready();
  assert.equal(await playing, true);
  assert.equal(FakeAudio.instances[1].paused, true);
});

test("switching during load cancels and releases the old track", async () => {
  const first = engine.play("rain", 0.35);
  const abandoned = FakeAudio.instances.slice();
  const second = engine.play("forest", 0.35);
  FakeAudio.instances[2].ready();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.ok(abandoned.every((audio) => audio.paused && audio.src === ""));
});

test("Stop during load cannot resurrect playback and releases resources", async () => {
  const pending = engine.play("ambient", 0.35);
  engine.stop();
  assert.equal(await pending, false);
  assert.ok(FakeAudio.instances.every((audio) => audio.paused && audio.src === ""));
});

test("Pause retains resume position; Stop releases the audio pair", async () => {
  const pending = engine.play("ambient", 0.35);
  FakeAudio.instances[0].ready();
  await pending;
  FakeAudio.instances[0].currentTime = 42;
  assert.equal(engine.pause(), 42);
  assert.equal(await engine.play("ambient", 0.35, 42), true);
  assert.equal(FakeAudio.instances.length, 2);
  engine.stop();
  assert.ok(FakeAudio.instances.every((audio) => audio.src === ""));
});

test("unavailable media fails honestly and releases both streams", async () => {
  const pending = engine.play("rain", 0.35);
  FakeAudio.instances[0].dispatchEvent(new Event("error"));
  await assert.rejects(pending, /not available/);
  assert.ok(FakeAudio.instances.every((audio) => audio.paused && audio.src === ""));
});

test("browser Play rejection releases streams rather than reporting success", async () => {
  const pending = engine.play("rain", 0.35);
  FakeAudio.instances[0].play = async () => { throw new DOMException("blocked", "NotAllowedError"); };
  FakeAudio.instances[0].ready();
  await assert.rejects(pending, /blocked/);
  assert.ok(FakeAudio.instances.every((audio) => audio.paused && audio.src === ""));
});
