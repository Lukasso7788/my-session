import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/pages/livekit/flowRoomLightTheme.css", import.meta.url), "utf8");
const room = readFileSync(new URL("../src/pages/RoomPageLiveKit.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../src/components/RoomTopBar.tsx", import.meta.url), "utf8");
const bottomBar = readFileSync(new URL("../src/pages/livekit/LiveKitBottomBarLegacy.tsx", import.meta.url), "utf8");
const prejoin = readFileSync(new URL("../src/pages/livekit/PreJoinModalLiveKit.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/pages/livekit/RoomSettingsModalLiveKit.tsx", import.meta.url), "utf8");

function luminance(hex) {
  const [red, green, blue] = hex.match(/[0-9a-f]{2}/gi).map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function token(name) {
  const match = css.match(new RegExp(`--ms-room-flow-${name}: (#[0-9a-f]{6})`, "i"));
  assert.ok(match, `Missing ${name} color token`);
  return match[1];
}

test("light-room foreground and control colors meet WCAG AA", () => {
  for (const [foreground, background] of [
    [token("ink"), "#ffffff"],
    [token("muted"), "#ffffff"],
    [token("muted"), "#d2ddec"],
    [token("ink"), "#eaf3ff"],
    ["#ffffff", token("accent")],
    ["#ffffff", token("accent-hover")],
  ]) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background} is below AA`);
  }
});

test("palette stays scoped to light room and light side panels", () => {
  assert.match(css, /html\[data-theme="light"\] \.ms-room-page/);
  assert.match(css, /\.ms-room-side-panel\[data-panel-theme="light"\]/);
  assert.match(room, /bg-\[#D2DDEC\] text-\[#091454\]/);
  assert.equal(token("accent").toLowerCase(), "#2844e8");
  assert.equal(token("soft").toLowerCase(), "#eaf3ff");
});

test("old purple controls are absent from light-room presentation", () => {
  for (const source of [css, room, topBar, bottomBar, prejoin, settings]) {
    assert.doesNotMatch(source, /#(?:575ce5|474ccb|353aae|858bef)\b/i);
  }
});

test("the original sun/moon SVG switch is retained on desktop and mobile", () => {
  assert.equal(topBar.match(/name=\{isLight \? "theme-sun" : "theme-moon"\}/g)?.length, 2);
  assert.match(bottomBar, /<Icon name="settings" theme=\{theme\}/);
  assert.match(bottomBar, /activePanel === panel \? \(isLight \? "dark" : "light"\) : theme/);
  assert.match(css, /img\[src\$="-light\.svg"\]/);
});
