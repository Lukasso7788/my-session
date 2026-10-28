import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const card = readFileSync("src/components/SessionCard.tsx", "utf8");
const hostPicker = readFileSync("src/components/HostTimePicker.tsx", "utf8");
const page = readFileSync("src/pages/SessionsPage.tsx", "utf8");
const leaderboard = readFileSync("src/pages/LeaderboardPage.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20261014150000_infinite_room_host_slots.sql", "utf8");

test("infinite rooms are booked to host only, with no participant option", () => {
  assert.match(card, /const bookingRoleDraft = "host" as const;/);
  assert.doesNotMatch(card, /Join as participant/);
  assert.match(card, /title="Host this room"/);
  assert.match(card, /\{isInfinite \? "Host a time" : "Book session"\}/);
});

test("a host can repeat the window every day for a week", () => {
  assert.match(hostPicker, /Repeat every day for 7 days/);
  assert.match(card, /Array\.from\(\{ length: 6 \}, \(_, index\) => \(\{\s*starts_at: new Date\(startMs \+ \(index \+ 1\) \* DAY_MS\)/);
  assert.match(card, /const result = await onBookHostSlots\(session\.id, extraSlots\);/);
  assert.match(page, /supabase\.rpc\("save_infinite_room_host_slots", \{\s*p_session_id: id,\s*p_slots: slots,/);
  // Cancelling removes the extra days too.
  assert.match(page, /\.from\("infinite_room_host_slots"\)\s*\.delete\(\)\s*\.eq\("session_id", id\)\s*\.eq\("user_id", user\.id\);/);
});

test("extra hosting days load separately so a missing table cannot break the page", () => {
  assert.match(page, /const loadInfiniteHostSlots = async \(\) => \{[\s\S]*?catch \(error\) \{/);
  assert.match(page, /void loadInfiniteHostSlots\(\);/);
  assert.match(card, /Array\.isArray\(session\?\.host_slots\)/);
});

test("the host-slots migration keeps session_bookings untouched and checks every slot", () => {
  assert.doesNotMatch(migration, /alter table public\.session_bookings/i);
  assert.match(migration, /unique \(session_id, user_id, starts_at\)/);
  assert.match(migration, /if not public\.is_infinite_session\(p_session_id\)/);
  assert.match(migration, /jsonb_array_length\(p_slots\) > 14/);
  assert.match(migration, /interval '24 hours'/);
  assert.match(migration, /grant execute on function public\.save_infinite_room_host_slots\(uuid, jsonb\) to authenticated/);
});

test("host focus rate shows what it is based on, also in the top three", () => {
  assert.match(leaderboard, /"rating" : "ratings"\} · \$\{formatCount\(hosted\)\} \$\{hosted === 1 \? "session" : "sessions"\}/);
  assert.match(leaderboard, /<span className="mt-1 max-w-full truncate text-\[11px\] text-\[#A3A3A3\]">\{entry\.detail\}<\/span>/);
});
