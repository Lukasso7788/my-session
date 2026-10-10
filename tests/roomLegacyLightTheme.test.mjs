import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const room = source("../src/pages/RoomPageLiveKit.tsx");
const topBar = source("../src/components/RoomTopBar.tsx");
const bottomBar = source("../src/pages/livekit/LiveKitBottomBarLegacy.tsx");
const preJoin = source("../src/pages/livekit/PreJoinModalLiveKit.tsx");
const settings = source("../src/pages/livekit/RoomSettingsModalLiveKit.tsx");

test("room canvas and controls use the original neutral light palette", () => {
  assert.match(room, /bg-\[#F3F1F1\] text-\[#1F1F1F\]/);
  assert.match(room, /bg-\[#E7E7E7\] hover:bg-\[#DCDCDC\] text-black\/75/);
  assert.match(topBar, /bg-\[#F3F1F1\]\/95 border border-\[#CFCFCF\]/);
  assert.match(bottomBar, /bg-\[#2F2F2F\] text-white hover:bg-\[#111111\]/);
  assert.doesNotMatch(room, /flowRoomLightTheme\.css/);
});

test("pre-join and room settings keep their original light surfaces", () => {
  assert.match(preJoin, /border-\[#D8D0D0\] bg-\[#F3F1F1\] text-\[#20242D\]/);
  assert.match(preJoin, /bg-\[#5286F6\] text-white/);
  assert.match(settings, /bg-\[#F5F5F5\] text-black border border-\[#D8D0D0\]/);
  assert.match(settings, /bg-\[#1F1F1F\] text-white/);
});

test("original sun and moon icons remain unchanged", () => {
  assert.equal(topBar.match(/name=\{isLight \? "theme-sun" : "theme-moon"\}/g)?.length, 2);
  assert.match(bottomBar, /<Icon name="settings" theme=\{theme\}/);
});
