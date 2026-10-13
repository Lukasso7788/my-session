import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
const prejoin = readFileSync("src/pages/livekit/PreJoinModalLiveKit.tsx", "utf8");

test("the real token request and the prejoin prefetch send the same request", () => {
  assert.match(room, /const describeTokenRequest = \(\) => \{/);
  assert.match(room, /const request = describeTokenRequest\(\)!;/);
  // Both requests post exactly the shared body.
  assert.equal((room.match(/body: JSON\.stringify\(request\.body\)/g) || []).length, 2);
  assert.match(room, /return \{ baseUser, identity, body, key: JSON\.stringify\(body\) \};/);
});

test("the token is prefetched only on prejoin, debounced, never for invite links", () => {
  assert.match(room, /if \(!prejoinOpen \|\| joinRequested \|\| lkToken\) return;/);
  assert.match(room, /if \(joinBlocked \|\| !canJoinNow\) return;/);
  assert.match(room, /if \(!request \|\| request\.body\.inviteToken\) return;/);
  assert.match(room, /window\.setTimeout\(\(\) => prefetchJoinToken\(request\), 600\)/);
  assert.match(room, /const PREFETCHED_TOKEN_MAX_AGE_MS = 10 \* 60_000;/);
});

test("Join uses a matching prefetched token first and otherwise the normal request", () => {
  assert.match(room, /if \(await consumePrefetchedJoinToken\(\)\) return;\s*await requestToken\(\);/);
  assert.match(room, /if \(cached\.key !== request\.key\) return false;/);
  assert.match(room, /if \(!joinRequestedRef\.current \|\| lkTokenRef\.current \|\| tokenRequestInFlightRef\.current\) return false;/);
  // Single use, and the tab limit still applies.
  assert.match(room, /const cached = prefetchedJoinTokenRef\.current;\s*prefetchedJoinTokenRef\.current = null;/);
  assert.match(room, /const gate = tryAcquireTabGate\(session\.id, request\.baseUser\);\s*if \(!gate\.ok\) return false;/);
});

test("Enter joins from the name field but not from buttons or device menus", () => {
  assert.match(prejoin, /if \(e\.key === "Enter" && !e\.defaultPrevented && !e\.isComposing && !e\.repeat\)/);
  assert.match(prejoin, /closest\?\.\('button, a, select, textarea, input, \[role="combobox"\], \[role="listbox"\], \[role="option"\]'\)/);
  assert.match(prejoin, /if \(!fxApplying\) handleJoin\(\);/);
});
