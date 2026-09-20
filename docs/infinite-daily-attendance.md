# Infinite-room daily attendance repair

Applied to MySession on 2026-09-20 as migration 20260920161100.

## Confirmed causes

- Daily attendance already existed, but profiles.attended_sessions_count was
  recomputed from distinct session_attendance.session_id only.
- A second set of incremental triggers ran alongside recounting and could add
  another +1 after recounting.
- The room requested a daily row only on entry, never on a midnight heartbeat.
- The old lifetime calculator used NOT on an OR expression containing nullable
  JSON checks. Missing schedule keys could exclude ordinary sessions.

## Semantics

Each (user, infinite room, calendar date) contributes one attendance unit.
Rejoins, multiple tabs and several hours on that date do not add another unit.
A different infinite room on the same date contributes independently.
Ordinary scheduled sessions still contribute once per room/session, not per day.

The authoritative day uses profiles.timezone; absent/invalid zones use UTC.
Postgres timezone conversion handles local midnight and DST. The first successful
presence heartbeat after midnight records the new date; no new timers, browser
requests or polling were added. Existing attendance join/upsert and heartbeat
update fallbacks all go through the same database trigger.

session_attendance remains the live one-row-per-user/room lease. Daily history
remains in infinite_room_daily_attendance under its existing unique constraint.
The profile display and lifetime eligibility RPC now use the same canonical count.
Profile row locking serializes concurrent counter recomputations. Ordinary
same-day heartbeats perform an indexed existence check, not a profile update.

The older daily-record RPC remains callable for compatibility but now requires
recent confirmed presence and uses the saved timezone. The frontend's redundant
pre-join call is removed. Apply the migration before deploying this frontend.

## History

Existing daily rows are preserved and included in repaired counters. For a
user/room pair with no daily history, only the proven joined_at date is backfilled.
No intermediate days are invented from a long joined_at/last_seen_at range.
Days lost before daily recording cannot reliably be reconstructed from the old
single-row presence table. Existing historical timezone labels are not rewritten.

## Verification

- Ran the migration plus SQL assertions in a transaction and rolled everything back.
- Applied the migration to MySession and reran supabase/tests/infinite_daily_attendance.sql
  (rollback-only; uses inactive existing fixtures).
- Verified prior day + current heartbeat, same-day heartbeat/rejoin deduplication,
  independent rooms, scheduled-session reconnects, profile/lifetime consistency,
  timezone override resistance, midnight/DST and internal helper privileges.
- Post-apply: zero duplicate daily keys, zero profile/canonical-count mismatches,
  no remaining legacy incremental triggers and no new security advisor findings.
- npx vite build and git diff --check passed.

Rollback-only tests do not call external services or preserve synthetic attendance.
No real overnight browser session was waited through; rollover uses actual
database triggers with a prior-day ledger fixture.
