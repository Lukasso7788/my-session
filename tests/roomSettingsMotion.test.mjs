import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/pages/livekit/RoomSettingsModalLiveKit.tsx", "utf8");
const motion = readFileSync("src/pages/livekit/RoomSettingsMotion.tsx", "utf8");
const css = readFileSync("src/pages/livekit/room-settings-motion.css", "utf8");

test("settings TSX parses and every dropdown uses the existing animated presenter", () => {
  const ast = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  // 6 original dropdowns + the two video quality ones.
  assert.equal((source.match(/<SelectField\s/g) || []).length, 8);
  assert.doesNotMatch(source, /<select\s/);
  assert.match(source, /<PreJoinDeviceSelect .*onChange=\{onChange\}/);
});
test("original layout and device callbacks still receive their original values", () => {
  for (const handler of ["onChangeVideoTileLayoutPreset?.(v as VideoTileLayoutPreset)", "onChangeVideoTileLayoutColumns?.(Number(v) || 0)", "onChangeVideoTileLayoutRows?.(Number(v) || 0)", "void onChangeAudioInput(v)", "void onChangeVideoInput(v)", "onChange={onChangeAudioOutput}"]) assert.ok(source.includes(handler), handler);
});
test("animated preview immediately releases the attached track when closed", () => {
  assert.match(source, /track=\{previewOpen \? previewTrack : null\}/);
  assert.match(source, /aria-controls="room-settings-camera-preview"/);
  assert.match(source, /<RoomSettingsDisclosure open=\{previewOpen\}/);
});
test("advanced sound test preserves its mounting and background controls stay lazy", () => {
  assert.match(source, /<PreJoinDisclosure open=\{soundTestOpen\}/);
  assert.match(motion, /open \|\| hasOpened \? children : null/);
  assert.match(source, /<RoomSettingsDisclosure open=\{mode === "blur"\}/);
  assert.match(source, /<RoomSettingsDisclosure open=\{colorCorrectionEnabled\}/);
});
test("control motion is scoped, respects reduced-motion and doesn't tween slider values", () => {
  assert.match(css, /\.ms-room-settings button/);
  assert.match(css, /background-color 160ms ease/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(source, /behavior: reducedMotion \? "auto" : "smooth"/);
  assert.doesNotMatch(css, /transition:\s*all|transition:.*(?:width|left|height)/);
});
test("upload and sliders remain keyboard accessible; dialog is named", () => {
  assert.match(source, /aria-label="Upload background image"/);
  assert.match(source, /<label htmlFor=\{id\}/);
  assert.match(source, /aria-labelledby="room-settings-title"/);
  assert.match(css, /focus-visible/);
});
test("existing room settings and camera icons are preserved", () => {
  for (const asset of ["settings-light.svg", "settings-dark.svg", "camera-on-light.svg", "camera-on-dark.svg", "graphic-design.svg", "command.svg", "layout.svg", "volume.svg"]) assert.ok(source.includes(asset), asset);
});
