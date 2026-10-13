import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/videoQualityPreferences.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const q = mod.exports;

const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
const settings = readFileSync("src/pages/livekit/RoomSettingsModalLiveKit.tsx", "utf8");

test("Auto receives exactly the room's previous size-based cap", () => {
  assert.deepEqual(q.receiveCapFor("auto", 1), { width: 1280, height: 720 });
  assert.deepEqual(q.receiveCapFor("auto", 2), { width: 1280, height: 720 });
  assert.deepEqual(q.receiveCapFor("auto", 3), { width: 854, height: 480 });
  assert.deepEqual(q.receiveCapFor("auto", 4), { width: 854, height: 480 });
  assert.deepEqual(q.receiveCapFor("auto", 5), { width: 640, height: 360 });
  assert.deepEqual(q.receiveCapFor("auto", 30), { width: 640, height: 360 });
});

test("explicit choices cap receiving and override the camera preset; Auto overrides nothing", () => {
  assert.deepEqual(q.receiveCapFor("high", 30), { width: 1280, height: 720 });
  assert.deepEqual(q.receiveCapFor("medium", 2), { width: 640, height: 360 });
  assert.deepEqual(q.receiveCapFor("low", 2), { width: 320, height: 180 });
  assert.equal(q.sendPresetOverride("auto"), null);
  assert.deepEqual(q.sendPresetOverride("high"), { width: 960, height: 540, fps: 24 });
  assert.deepEqual(q.sendPresetOverride("medium"), { width: 640, height: 360, fps: 15 });
  assert.deepEqual(q.sendPresetOverride("low"), { width: 320, height: 180, fps: 10 });
  assert.equal(q.normalizeVideoQualityChoice("ultra"), "auto");
  assert.equal(q.normalizeVideoQualityChoice(null), "auto");
  assert.equal(q.normalizeVideoQualityChoice("low"), "low");
});

test("every camera start uses the override first and otherwise its existing preset", () => {
  assert.match(room, /if \(cameraQualityOverride\) return cameraQualityOverride;\s*if \(lowPowerMobileMode\) \{/);
  assert.match(room, /width: cameraQualityOverride\?\.width \?\? \(lowPowerMobileMode \? 320 : capturePreset\.width\)/);
  assert.match(room, /frameRate: cameraQualityOverride\?\.fps \?\? \(lowPowerMobileMode \? 8 : capturePreset\.fps\)/);
  assert.match(room, /width: cameraQualityOverride\?\.width \?\? \(isChromeOS \? 640 : capturePreset\.width\)/);
  assert.match(room, /frameRate: cameraQualityOverride\?\.fps \?\? \(isChromeOS \? 15 : capturePreset\.fps\)/);
  // Remote cameras are capped from the setting; a running camera gets new
  // constraints instead of a restart.
  assert.match(room, /const maxCameraDimensions = receiveCapFor\(receiveVideoQuality, participantsCount\);/);
  assert.match(room, /source\.applyConstraints\(\{/);
});

test("settings offer both controls with Auto first and performance tips", () => {
  assert.match(settings, /\["video-quality", "Video quality",/);
  assert.match(settings, /label="My camera"/);
  assert.match(settings, /label="Others' video"/);
  assert.match(settings, /\{ value: "auto", label: "Auto \(recommended\)" \}/);
  assert.match(settings, /\{ value: "auto", label: "Auto \(by room size\)" \}/);
  assert.match(settings, /Optimize performance/);
  assert.match(room, /sendVideoQuality=\{sendVideoQuality\}\s*receiveVideoQuality=\{receiveVideoQuality\}/);
});
