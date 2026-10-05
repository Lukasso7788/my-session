import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prejoin = readFileSync(join(root, "src/pages/livekit/PreJoinModalLiveKit.tsx"), "utf8");
const room = readFileSync(join(root, "src/pages/RoomPageLiveKit.tsx"), "utf8");
const topBar = readFileSync(join(root, "src/components/RoomTopBar.tsx"), "utf8");
const stageBar = readFileSync(join(root, "src/components/SessionStageBar.tsx"), "utf8");

test("production pre-join keeps one camera and mic toggle with blue on/hover states", () => {
  assert.match(room, /from "\.\/livekit\/PreJoinModalLiveKit"/);
  assert.equal([...prejoin.matchAll(/onChange\(\{ \.\.\.value, audioEnabled: !value\.audioEnabled \}\)/g)].length, 1);
  assert.equal([...prejoin.matchAll(/onChange\(\{ \.\.\.value, videoEnabled: !value\.videoEnabled \}\)/g)].length, 1);
  assert.match(prejoin, /const mediaToggleOn = isLight \? .*text-\[#2459BE\].*hover:bg-\[#DDE9FF\]/);
  assert.match(prejoin, /const btnPrimary = "bg-\[#5286F6\] text-white.*hover:bg-\[#3E75ED\]/);
  assert.doesNotMatch(prejoin, /#(?:91E496|B8F2BC|81DB86|9DE4A1|205B25)/i);
});

test("room stage tooltips have an unclipped stacking context above the video grid", () => {
  assert.match(topBar, /relative isolate z-\[60\].*overflow-visible/);
  assert.match(room, /relative isolate z-0 grid grid-rows-1/);
  assert.equal([...topBar.matchAll(/tooltipPlacement="bottom"/g)].length, 2);
  assert.match(stageBar, /tooltipPlacement = "top"/);
});

test("pre-join background choices use supplied icons and the room's saved custom slots", () => {
  for (const name of ["none", "blur", "image", "custom"]) {
    const icon = readFileSync(join(root, `public/icons/prejoin-background-${name}.svg`), "utf8");
    assert.match(icon, /<svg\b/);
    assert.match(prejoin, new RegExp(`prejoin-background-${name}\\.svg`));
  }
  assert.match(prejoin, /<div className=\{`rounded-\[20px\] \$\{inputWrap\}`\}>/);
  assert.match(prejoin, /flex items-center justify-between gap-2 px-3 py-2\.5/);
  assert.match(prejoin, /flex shrink-0 items-center gap-1\.5/);
  assert.match(prejoin, /className="inline-block h-6 w-6 shrink-0 bg-current"/);
  assert.match(prejoin, /aria-label=\{label\}/);
  assert.doesNotMatch(prejoin, /<span>\{label\}<\/span>/);
  assert.ok(prejoin.indexOf('role="group" aria-label="Background effect choices"') < prejoin.indexOf('(visibleBackgroundChoice !== "off"'));
  assert.doesNotMatch(prejoin, /<details className=\{`group rounded-\[20px\] \$\{inputWrap\}`\}>/);
  assert.match(prejoin, /"No backgrounds"/);
  assert.match(prejoin, /"Custom image"/);
  assert.match(prejoin, /customBackgroundSlots\.map\(\(slot\)/);
  assert.match(room, /customBackgroundSlots=\{customBackgroundSlots\}/);
  assert.match(room, /onUploadCustomBackground=\{async \(slotId, file\)/);
  assert.match(room, /readImageFileAsDataUrl\(file\)/);
  assert.match(room, /saveCustomBackgroundSlots\(customBackgroundSlots\)/);
});
