import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/livekitTabIdentity.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { claimLiveKitTabId, parkLiveKitTabId, unparkLiveKitTabId, resetLiveKitTabIdForTests } = mod.exports;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    snapshot: () => Object.fromEntries(data),
  };
}

let counter = 0;
const makeId = () => `fresh${String(++counter).padStart(7, "0")}`;

test("a reload of the same tab reuses the id parked on pagehide", () => {
  resetLiveKitTabIdForTests();
  const storage = memoryStorage();
  const first = claimLiveKitTabId(makeId, storage);
  parkLiveKitTabId(first, storage);

  resetLiveKitTabIdForTests(); // next page load
  assert.equal(claimLiveKitTabId(makeId, storage), first);
  assert.deepEqual(storage.snapshot(), {}, "the id is taken out again once claimed");
});

test("a duplicated tab copies sessionStorage while the original is alive and gets its own id", () => {
  resetLiveKitTabIdForTests();
  const original = memoryStorage();
  const first = claimLiveKitTabId(makeId, original);

  resetLiveKitTabIdForTests(); // the duplicate's page load
  const duplicate = memoryStorage(original.snapshot());
  assert.notEqual(claimLiveKitTabId(makeId, duplicate), first);
});

test("a page that comes back from the background takes its id out of storage", () => {
  resetLiveKitTabIdForTests();
  const storage = memoryStorage();
  const first = claimLiveKitTabId(makeId, storage);
  parkLiveKitTabId(first, storage);
  unparkLiveKitTabId(first, storage);
  assert.deepEqual(storage.snapshot(), {});
});

test("one page load keeps one id, and broken storage falls back to a fresh one", () => {
  resetLiveKitTabIdForTests();
  const storage = memoryStorage({ mysession_livekit_tab_id_v1: "not valid!" });
  const first = claimLiveKitTabId(makeId, storage);
  assert.match(first, /^fresh/);
  assert.equal(claimLiveKitTabId(makeId, storage), first);

  resetLiveKitTabIdForTests();
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  assert.match(claimLiveKitTabId(makeId, throwing), /^fresh/);
});
