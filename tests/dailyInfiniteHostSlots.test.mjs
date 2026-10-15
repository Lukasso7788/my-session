import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// "Every day for 7 days" stores day one in session_bookings and the other days
// in infinite_room_host_slots. Each day's email and Discord post must read both.
test("daily email includes extra infinite hosting days for that day", () => {
  const admin = readFileSync("api/livekit/admin.ts", "utf8");
  assert.match(admin, /async function loadExtraInfiniteHostSlots\(/);
  assert.match(admin, /\.from\("infinite_room_host_slots"\)\s*\.select\("id,session_id,user_id,starts_at,ends_at"\)\s*\.lt\("starts_at", endIso\)\s*\.gt\("ends_at", startIso\)/);
  assert.match(admin, /bookingRows\.push\(\.\.\.\(await loadExtraInfiniteHostSlots\(\{ sb, startIso, endIso, existing: bookingRows \}\)\)\);/);
  // A missing table must not stop the email.
  const helper = admin.slice(admin.indexOf("async function loadExtraInfiniteHostSlots("), admin.indexOf("async function loadInfiniteHostingSlots("));
  assert.match(helper, /if \(error\) \{[\s\S]*?return rows;/);
  assert.doesNotMatch(helper, /throw /);
});

test("daily Discord post includes extra infinite hosting days for that day", () => {
  const worker = readFileSync("cloudflare-worker/src/index.ts", "utf8");
  assert.match(worker, /infinite_room_host_slots\?select=session_id,user_id,starts_at,ends_at/);
  assert.match(worker, /&starts_at=lt\.\$\{encodeURIComponent\(iso\(end\)\)\}/);
  assert.match(worker, /\[discord\] extra infinite host slots unavailable/);
});