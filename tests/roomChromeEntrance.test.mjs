import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
const topBar = readFileSync("src/components/RoomTopBar.tsx", "utf8");
const bottomBar = readFileSync("src/pages/livekit/LiveKitBottomBarLegacy.tsx", "utf8");
const css = readFileSync("src/pages/livekit/room-chrome-motion.css", "utf8");

test("room chrome waits for the first connection and never hides controls on error or a cancelled join", () => {
  assert.match(room, /import "\.\/livekit\/room-chrome-motion\.css";/);
  assert.match(room, /const roomChromeReady = connected \|\| !!lastErr \|\| \(!prejoinOpen && !joinRequested\);/);
  // Revealed once; reconnects do not hide or replay it.
  assert.match(room, /if \(roomChromeRevealed \|\| !roomChromeReady\) return;/);
  assert.doesNotMatch(room, /setRoomChromeRevealed\(false\)/);
  assert.match(room, /data-room-chrome=\{roomChromeRevealed \? "in" : "pending"\}/);
});

test("top bar, bottom bar and both side panel slots carry the entrance hooks", () => {
  assert.match(topBar, /className=\{`ms-room-topbar /);
  assert.match(bottomBar, /<div className="ms-room-bottombar fixed inset-x-0 bottom-0 z-50">/);
  assert.equal((room.match(/className="ms-room-side /g) || []).length, 2);
});

test("each piece slides from its own edge and ends without a lingering transform", () => {
  assert.match(css, /\[data-room-chrome="pending"\] \.ms-room-topbar \{ transform: translateY\(calc\(-100% - 16px\)\); \}/);
  assert.match(css, /\[data-room-chrome="pending"\] \.ms-room-side \{ transform: translateX\(calc\(100% \+ 16px\)\); \}/);
  assert.match(css, /\[data-room-chrome="pending"\] \.ms-room-bottombar \{ transform: translateY\(100%\); \}/);
  assert.match(css, /visibility: hidden;\s*pointer-events: none;/);
  // A transform left on the fixed bottom bar would re-anchor its fixed popovers.
  for (const name of ["top", "bottom", "right"]) {
    assert.match(css, new RegExp(`animation: ms-chrome-from-${name} \\d+ms var\\(--ms-chrome-ease\\)( \\d+ms)? backwards;`));
  }
  assert.equal((css.match(/to \{ transform: none; opacity: 1; \}/g) || []).length, 3);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none;/);
});
