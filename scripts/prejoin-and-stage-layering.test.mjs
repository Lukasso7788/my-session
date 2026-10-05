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
const bottomBar = readFileSync(join(root, "src/pages/livekit/LiveKitBottomBarLegacy.tsx"), "utf8");

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
  assert.doesNotMatch(prejoin, /title=\{fxBlockedReason \|\| label\}/);
  assert.match(prejoin, /peer-hover:visible peer-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100/);
  assert.match(prejoin, /\{fxBlockedReason \|\| label\}/);
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

test("pre-join surfaces match the neutral room palette while blue stays an accent", () => {
  assert.match(prejoin, /bg-\[#F3F1F1\] text-\[#20242D\]/);
  assert.match(prejoin, /bg-\[#1B1B1B\] text-white/);
  assert.match(prejoin, /const btnPrimary = "bg-\[#5286F6\]/);
  assert.doesNotMatch(prejoin, /bg-\[#191C23\]|bg-\[#1C2029\]|bg-\[#222630\]/);
});

test("room shell gives space back to media and panels without shrinking controls", () => {
  assert.match(room, /pb-\[calc\(68px\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(room, /sm:pb-\[calc\(72px\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(bottomBar, /h-\[60px\] sm:h-\[64px\] grid/);
  assert.match(bottomBar, /const centerControlClass = "h-10 w-10.*md:h-11 md:w-11"/);
  const bottomBarSurface = room.match(/const bottomBarBg = isLight[\s\S]*?;/)?.[0] || "";
  assert.match(bottomBarSurface, /bg-\[#F3F1F1\]/);
  assert.match(bottomBarSurface, /bg-\[#1B1B1B\]/);
  assert.doesNotMatch(bottomBarSurface, /\bborder\b/);
});

test("long room titles cannot squeeze the timeline and reveal the full name instantly", () => {
  assert.match(topBar, /min-w-0 flex-1 px-4/);
  assert.match(topBar, /lg:max-w-\[280px\]/);
  assert.match(topBar, /hidden lg:flex items-center/);
  assert.match(topBar, /flex lg:hidden flex-wrap/);
  assert.match(topBar, /title\.scrollWidth > title\.clientWidth \+ 1/);
  assert.match(topBar, /observer\?\.disconnect\(\)/);
  assert.match(topBar, /\{titleTruncated && \(/);
  assert.match(topBar, /w-max max-w-\[min\(420px,80vw\)\]/);
  assert.match(topBar, /group-hover:visible group-hover:opacity-100 group-focus-within:visible/);
  assert.match(topBar, /\{sessionTitle \|\| "Session"\}/);
});
