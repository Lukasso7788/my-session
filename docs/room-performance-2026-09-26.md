# Room performance implementation — 2026-09-26

## Scope

Focused application-layer changes to the existing LiveKit room, chat, Tasks and
soundscape engine. No database migration, server configuration, new polling,
authentication change, AI-host default change, or production deployment.
Existing separate Plunk email migration edits are not part of this change.

## Implemented

- `api/livekit/token.ts`: parallelize independent pending-access/ban checks, then
  independent assigned-server/microphone-policy reads. Admission, invite booking,
  authorization, grants and errors remain in the same logical order.
- `src/pages/RoomPageLiveKit.tsx`: share token-request completion instead of
  waking concurrent callers every 100 ms; preserve the existing request timeout.
  Defer tile-task reads/subscriptions and Tasks mounting until connected. Guard
  task SELECTs against obsolete responses; coalesce task-change bursts for 150 ms.
  Filter tile-task subscriptions to participant IDs (Supabase limit: 100 IDs);
  retain a client-filtered fallback above that limit and sparse DELETE handling.
- `src/lib/publishedColorCorrection.ts`,
  `src/pages/livekit/PersonColorCorrectionProcessor.ts`,
  `src/pages/livekit/LiveKitBottomBar.tsx`: separate pure color helpers from the
  heavy effect SDK. Import effects only when used. Serialize preview changes and
  register published-effect operations before asynchronous imports, so a late
  blur/background cannot overwrite a newer Off selection or ended camera track.
- `src/hooks/useLatestCallback.ts`, `src/pages/livekit/VideoTileLiveKit.tsx`,
  `src/pages/livekit/VideoTileLiveKitLegacy.tsx`: keep tile callbacks stable with
  current committed behavior; compare task contents rather than newly allocated
  arrays; mount microphone waveform analysers only for speaking participants.
- `src/lib/roomSoundscapes.ts`: preserve Play-only audio creation. Use metadata
  preload rather than automatic whole-track preload for both streams. Do not
  wait for standby metadata before starting. Cancel superseded loads; release
  old sources on selection changes and both streams on Stop/disconnect. Pause
  retains position for resume. Preserve seamless crossfade and streaming.
- Room music progress ticks only while playing and the music tab is selected;
  actual playback continues when the tab is closed. Stale play completions cannot
  publish/update newer music state.
- `src/components/TasksPanel.tsx`: tick task timers only while enabled/running.
  Stable room-scoped encouragement subscription; counts paint before avatars.
  INSERT task events are room-filtered. UPDATE intentionally stays broad for
  tasks moved out of a room; DELETE remains broad because it can carry only PK
  and Supabase does not support filtering DELETE. Unrelated deletes do not cause
  state allocation. Off-screen team rows use `content-visibility: auto`.
- `src/components/ChatPanel.tsx`, `src/lib/chatMessageWindow.ts`: first load 50
  messages rather than 150, then keyset-page older messages on demand. Bound
  messages/reactions/read-receipt references to a 300-message client window.
  This does not delete messages in the database. At most four view/account-scoped
  caches, with a five-minute reuse TTL. Resolve author profiles before first
  message paint; avatar image downloads remain independent of message rendering.
  Keep channels stable across thread switches/rerenders; clean them on unmount.
  Healthy Realtime has no polling; existing degraded fallback runs only while
  online/visible. UUID-based optimistic sends reconcile RPC/Realtime confirmation
  without duplicate messages. Stale SELECTs cannot revert newer inserts, edits
  or deletes; obsolete room/account responses are ignored. Older-page scroll
  position is restored before painting, and queued reaction loads keep page IDs.

## Verification

Run from the implementation checkout:

```powershell
node --experimental-strip-types --test scripts/room-performance.test.mjs
node scripts/verify-room-performance-types.mjs
node scripts/verify-room-performance-lint.mjs
npx tsc --noEmit --skipLibCheck --module esnext --moduleResolution bundler --target es2022 --types node api/livekit/token.ts
npm run build
node scripts/verify-room-performance-bundle.mjs
git diff --check
```

Results on 2026-09-26:

- 10/10 regression tests passed: chat bounds/reconciliation, color helper
  equivalence, Play-only audio creation, cancellation, pause/resume, Stop cleanup,
  unavailable media and browser playback rejection.
- App TypeScript baseline: 252 existing diagnostics; changed tree: 251; **0 new**.
  Full project-wide typecheck is not claimed clean.
- Changed-file ESLint baseline: 716 errors; changed tree: 714; **0 new errors or
  warnings**. Existing `.eslintignore` compatibility warning remains.
- Token endpoint targeted TypeScript passed; production build and generated SEO
  route verification passed; diff whitespace validation passed.
- Production static import graph confirms processors are NOT eagerly imported
  by the room: 155,086 bytes (47,024 gzip bytes) of processor/factory JS deferred.
  This is a bundle fact, not an observed RAM or connection-latency percentage.
- Browser verification used actual ChatPanel/TasksPanel with an isolated mock
  API: initial general chat made one message SELECT; parent rerender did not
  create channels; confirmed send rendered once; failed send restored its draft;
  delayed SELECT did not remove a newer Realtime message; 650 insert events left
  300 retained message elements and three channels. Both panels removed every
  owned channel on unmount (zero active). General/Direct switching reused channels
  and kept thread content separate. No uncaught browser errors.
- Older-history merge/cursor path was exercised using the actual handler and
  local query double. Production PostgREST/RLS keyset-query behavior and live
  multiuser calls still require end-to-end deployment verification.

Optional isolated browser fixture (never included in the app build):

```powershell
node scripts/room-performance-browser.mjs
# http://127.0.0.1:4192 — local mock data only
```

### Chat author reliability follow-up

The initial performance change painted messages before author profiles arrived.
Additionally, a partial host override was treated as a loaded profile, and a
failed profile request had no automatic retry. This could leave a generic name
or initials in place indefinitely.

Chat now batches/deduplicates author reads, waits for actual names and avatar URLs
before displaying initial/history/realtime messages, and caches only confirmed
database profiles for read suppression. Partial overrides cannot stop the read
or wipe a confirmed name/avatar. Avatar image fetching does not delay the text.
Transient profile failures retry once; persistent failures show a Retry profiles
action rather than silently stranding placeholders. No polling was added.
Existing message/view revisions guard every post-profile-await update, so deleted
messages cannot reappear and delayed events cannot leak into another DM thread.

Verification: 15/15 unit/regression tests passed; 17 isolated actual-ChatPanel
browser assertions passed (slow author reads, partial override, deduplication,
automatic/manual retry, avatar rerender, pending delete/update, stale reconnect
SELECT, thread switching and channel cleanup). Production build/SEO verification
passed; TypeScript stayed at 251 baseline diagnostics (zero new); changed-file
ESLint improved from 714 to 709 errors (zero new errors/warnings).

```powershell
node --test scripts/chat-profile-loader.test.mjs scripts/room-performance.test.mjs
# Start the isolated server in a separate terminal:
node scripts/room-performance-browser.mjs
# Then verify actual components using mock data only:
npx --no-install agent-browser --session chat-profile open 'http://127.0.0.1:4192/?profileDelay=1500'
Get-Content -Raw scripts/fixtures/chat-profile-browser-check.js | npx --no-install agent-browser --session chat-profile eval --stdin
npx --no-install agent-browser --session chat-profile close
```

### Tasks-panel warm reopen follow-up

Previously every mount initialized personal/room tasks to empty arrays, resolved
even UUID room IDs in an effect, and showed blocking spinners again on refresh.
The Tasks panel now restores a per-account/per-room in-memory snapshot before
paint: tasks, participant profiles, order and encouragement state. The cache is
limited to four snapshots with a five-minute TTL and is not stored on disk.
Authenticated UUID rooms no longer need a resolving render on initial mount.

Reopening still revalidates in the background because subscriptions are removed
while the panel is closed. This is not a claim that every reopen makes zero
database reads. Cached tasks/avatars remain visible, including when that read
fails. A fresh snapshot cannot undo newer edits/inserts/deletes. Account/room
changes invalidate pending reads; cached data cannot trigger automatic public
task reconciliation until personal tasks have been validated against Supabase.
One external tasks-updated event no longer issues two personal SELECTs. A public
task reconcile with no changes no longer refetches the entire room task list.
Timers, ordering, task visibility and subscription cleanup are preserved.

Verification: 22 unit/regression tests and 18 actual TasksPanel browser assertions
passed with mock delayed/failed reads, changes while closed, stale SELECTs,
account/room switches, cached-public-task protection and repeated-open cleanup.
Warm reopen displayed cached tasks within the test's 250ms ceiling while all
task reads were artificially delayed 900ms. This is a local mock test, not a
measured production speedup. Production PostgREST/RLS is unchanged.

```powershell
node --test scripts/tasks-panel-cache.test.mjs scripts/chat-profile-loader.test.mjs scripts/room-performance.test.mjs
# With the isolated fixture server running in another terminal:
npx --no-install agent-browser --session tasks-cache open http://127.0.0.1:4192/
Get-Content -Raw scripts/fixtures/tasks-panel-cache-browser-check.js | npx --no-install agent-browser --session tasks-cache eval --stdin
npx --no-install agent-browser --session tasks-cache close
```

## Intentionally preserved / remaining measurement

Existing adaptive video sizing, screen-share simulcast, LiveKit prewarming,
prepared-camera reuse, lazy panels/emoji data and video detach cleanup already
existed and are preserved. Do not pause attendance/host-lease heartbeats, room
stage timing, active audio or required transport recovery just to reduce UI work.
Do not force a codec or turn down fullscreen screen-share readability without
measurements across supported browsers.

No claim that every speculative optimization is shipped: full DOM virtualization
of draggable Tasks and arbitrary-height chat, codec changes, SFU tuning, database
indexes and device-specific quality changes remain separate measured work.
Do not change infrastructure or write production load-test data for this test.

Before rollout, verify a real two-user room and a larger room on weak hardware:
entry/reentry, camera effects including rapid Off, screen-share tile/fullscreen,
chat/DM/history/reactions, task publishing/encouragements/timers, room and personal
music (including short seamless loops), PiP and background-tab return. Compare
entry p50/p95, decoder/video-frame metrics, CPU, JS heap and total tab memory over
30–60 minutes; JS heap alone does not measure WebRTC/GPU/audio memory.
