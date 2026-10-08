import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [resolve("src/lib/roomThemeMode.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { parseRoomThemeMode, roomThemeContrastBase } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

test("room theme reads existing choices and persists autumn as a distinct mode", () => {
  assert.equal(parseRoomThemeMode("light"), "light");
  assert.equal(parseRoomThemeMode("autumn"), "autumn");
  assert.equal(parseRoomThemeMode("dark"), "dark");
  assert.equal(parseRoomThemeMode(" LIGHT "), "light");
  assert.equal(parseRoomThemeMode(null), "dark");
  assert.equal(parseRoomThemeMode("unknown"), "dark");
  assert.equal(roomThemeContrastBase("autumn"), "light");
  assert.equal(roomThemeContrastBase("light"), "light");
});

const css = readFileSync(resolve("src/pages/livekit/autumnRoomTheme.css"), "utf8");
function color(token) {
  const match = css.match(new RegExp(`--ms-autumn-${token}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `Missing autumn color token ${token}`);
  return match[1];
}
function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(foreground, background) {
  const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}

test("autumn text, muted text, accents and buttons meet WCAG AA normal-text contrast", () => {
  for (const [foreground, background] of [
    [color("text"), color("surface")],
    [color("muted"), color("surface")],
    [color("text"), color("raised")],
    [color("accent"), color("surface")],
    ["#ffffff", color("primary")],
    [color("ink"), color("panel-light")],
    ["#6a3d2a", color("panel-light")],
    [color("text"), color("panel")],
    [color("text"), color("active")],
    [color("icon"), color("raised")],
  ]) {
    const ratio = contrast(foreground, background);
    assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
  }
});
