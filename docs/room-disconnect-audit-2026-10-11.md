# Room "thrown out" audit — 2026-10-11

Scope: two user reports.

1. Clicking a bottom control that opens a side panel (People, Chat, Tasks,
   Music) sometimes throws the person out of the room.
2. On phones and tablets, switching browser tabs or apps can throw the person
   out of the room.

Method: read-only trace of `src/pages/RoomPageLiveKit.tsx` (23k lines), the
bottom bar, the app shell/routes, `api/livekit/token.ts`, `api/livekit/admin.ts`,
Supabase migrations and cron, plus aggregated production diagnostics from
`public.room_diagnostics` and `public.connection_diagnostics` (last ~14 days,
counts only, no user identifiers copied). No data or settings were changed.
Line numbers in the findings refer to `origin/main` at `b66f09a`, before the
fixes. All ten findings were fixed afterwards; see "Fixes" at the end.

## Production evidence

`room_join` is written once per room component instance when LiveKit connects
(`RoomPageLiveKit.tsx` ~11792-11817) and carries a per-mount `tabId`. A second
`room_join` for the same user and session within 15 minutes with a different
`tabId` means the room component was mounted again (page reload, OS tab
discard + reload, or leaving and re-entering the room).

| Device | Users in rooms | Users with a quick re-entry from a new page | Quick re-entries | Re-entries with no LiveKit event in between |
| --- | --- | --- | --- | --- |
| Phone | 19 | 10 | 28 | 18 |
| Tablet | 8 | 6 | 9 | 6 |
| Desktop | 95 | 31 | 210 | 182 |

- Most quick re-entries have **no** `livekit.disconnected`/`reconnecting`
  event in between: the page or component went away, not the media connection.
  `connection_diagnostics` only stores connection transitions and failures
  remotely (`CONNECTION_DIAGNOSTICS_REMOTE_EVENTS`, ~2676-2689), and a reload or
  unmount removes listeners before `disconnect()`, so these cases leave no trace.
- Only a small share coincides with a deploy (a `main` commit between the two
  joins): desktop 11 of 199 (~3x chance), phone 1 of 27, tablet 0 of 9.
- 84 desktop quick re-entries happen within 30 seconds of the previous join.
- `livekit.disconnected` in the same period: desktop 73, tablet 19, phone 17.
  Almost all have reason `UNKNOWN` (the SDK passed no reason). The handler
  treats these as recoverable.
- `token.fetch_failed`: 26 in total, several right after the tab was hidden
  (< 1 min, 1-10 min, > 10 min). Remote writes are rate-limited per event type,
  so real counts can be higher.
- `camera.track_ended`: desktop 31, phone 6, tablet 4.

## Findings

Ranked by likely contribution to the two reports. "Confirmed" means the code
path was traced end to end.

### 1. Stale lazy chunk after a deploy reloads the room (report 1) — confirmed

- Chat, Tasks and Music are `React.lazy` chunks loaded on first open
  (`RoomPageLiveKit.tsx` 128-131). People is inline and not affected.
- `main` received 67 commits in two weeks; each production deploy replaces the
  hashed chunks. A room opened before the deploy still references the old hashes.
- `vercel.json` falls back to `/index.html` for any missing path, so an old
  chunk URL returns `200 text/html` (verified live:
  `https://mysession.club/assets/ChatPanel-OLDHASH123.js`). The module import fails.
- `src/lib/dynamicImportRecovery.ts` (installed in `main.tsx`) catches that
  failure and calls `window.location.reload()` (line 72). The LiveKit session
  ends and the person lands on prejoin (see finding 3).
- Within the 60-second cooldown the reload is skipped, the lazy component throws,
  and finding 2 applies (white screen).
- Evidence: deploy-correlated quick re-entries are ~3x chance on desktop.
- Fix: preload the three panel chunks right after a successful connect (they
  are small: chat, tasks, music) so they come from the build the room started
  with; inside a live room do not hard-reload on an import failure, show a
  non-blocking "New version available, refresh when convenient" notice and keep
  the room mounted; consider Vercel Skew Protection; return a real 404 for
  `/assets/*` so failures are fast and explicit.

### 2. No error boundary anywhere in the room (reports 1 and 2) — confirmed

- The only boundary is `PiPChatBoundary` in `src/pages/livekit/LiveKitPiPPortal.tsx`.
  `main.tsx`, `App.tsx` and the room have none.
- Any render-time exception in the room tree (a lazy import rejection, a panel
  render error, an unexpected participant payload) unmounts the whole app. The
  room cleanup closes the LiveKit connection and the user sees a white page.
- Fix: wrap each lazy panel in a small local boundary ("Panel failed to load,
  Retry") and add a room-level boundary that keeps a recovery UI instead of a
  blank page. A boundary does not catch async errors, so keep the existing
  try/catch in effects.

### 3. Any page reload or OS tab discard lands on prejoin (report 2) — confirmed

- `RoomPageLiveKitEntry` in `src/App.tsx` (85-99) clears every
  `mysession_mobile_room_lease:<session>:*` key on each room entry, including a
  full reload, before the room mounts. This is intentional: a fresh entry must
  never skip prejoin.
- The prejoin bootstrap only auto-rejoins when a lease exists
  (`RoomPageLiveKit.tsx` 9735-9752), so after a reload it always opens prejoin.
- iOS Safari and Android Chrome discard background tabs that hold camera/WebRTC
  memory; returning reloads the tab. The restore overlay's "Refresh page" button
  (~21507) and finding 1 lead to the same place.
- Evidence: most quick re-entries on phones and tablets have no LiveKit event in
  between, which fits a discarded/reloaded page better than a network drop.
- Fix: keep the fresh-entry rule for new tabs, but allow a one-time automatic
  rejoin after a reload of the **same tab**: store a short-lived marker in
  `sessionStorage` (it survives reload/discard in the same tab, not new tabs),
  for example valid for 10 minutes, and rejoin with the saved mic/camera choice.
  If auto-publishing media after a reload is not acceptable, show a one-tap
  "Rejoin" that skips the full device setup.

### 4. A token request error during background recovery opens prejoin (report 2) — confirmed

- Recovery on return (`restoreMobileMediaFromBackground`, ~16595-16733) always
  requests a fresh token (`requestToken`, ~16658).
- If that request throws (iOS often fails the first request right after
  resuming, or the 15-second timeout hits), the `catch` in `requestToken`
  (~10794-10806) sets `joinRequested=false` and `prejoinOpen=true`. Admission
  blocks do the same (~10726-10754). The person is moved from the room to the
  device-setup screen while the recovery loop is still running.
- Evidence: `token.fetch_failed` events right after hidden periods.
- Fix: pass a "recovery" flag to `requestToken`; in recovery mode keep the
  restore overlay and retry with backoff instead of opening prejoin. Only an
  admission or ban decision should leave the room UI.

### 5. Camera/screen-share policy kick ignores background and recovery (report 2) — confirmed

- Rooms with "cameras required", "screen share required" or "camera or screen
  share required" run a countdown while the required media is off: reminder
  after 20 s, final reminder after 70 s more, disconnect after 30 s more
  (~14955-15035 and ~15037-15125). The disconnect sets `kickedBySignalRef` and
  shows the kick notice.
- The timers do not check `document.visibilityState`, the restore overlay or an
  in-progress reconnect.
- On mobile, the OS can end the camera track in the background. The `ended`
  handler (~11985-11995) sets `camOn=false` and asks the user to turn the camera
  on manually. `connectRoom` also sets `camOn=false` before republishing
  (~14329-14330), restarting the countdown on every reconnect; if the camera
  fails to start after resume (`camera.start_failed.*` on phones and tablets in
  production), the person is removed about two minutes later.
- Screen share is not available in most mobile browsers, so "screen share
  required" rooms remove phone users after the countdown regardless.
- Fix: pause the countdown while hidden, while recovering and for a short grace
  period after a reconnect; restart it from zero when the page is visible and
  connected again. Show the policy before joining on devices that cannot meet
  it. This changes policy timers only, not capture/send/receive behavior.

### 6. Recovery gives up to a manual "Rejoin room" (report 2) — confirmed, UX

- After `ROOM_AUTO_RECOVERY_MANUAL_THRESHOLD` (3) failed attempts the overlay
  switches to `needs_action` and asks the person to tap "Rejoin room"
  (~16700-16728, UI ~21424-21484). Backoff continues (1.5 / 3 / 7 / 15 / 30 s),
  but to the person the room looks lost.
- Fix: keep retrying silently longer while the page is visible and online, and
  word the overlay as "Reconnecting…" with Rejoin as a secondary action.

### 7. Leave has no confirmation; voice "leave room" uses the same path — confirmed, low

- The bottom-bar Leave button (`LiveKitBottomBarLegacy.tsx` 990-998) calls
  `leave()` (`RoomPageLiveKit.tsx` 17095-17148) immediately: disconnect, then
  `window.location.replace('/sessions?postSession=1…')`.
- The panel buttons are not next to Leave (desktop: right cluster; phone: the
  "⋯" menu on the left), so a mis-tap from a panel click is unlikely.
- With voice controls on, the `leave_room` command (~15900) leaves immediately.
- Fix: a small confirm step for Leave (or "Undo" for a few seconds) and a
  confirmation phrase for the voice command.

### 8. Scheduled rooms close on the device clock — confirmed, situational

- `sessionCloseInfo` (~7136-7229) closes a non-infinite room for everyone at
  `start + stage total + 10 minutes` (`SESSION_CLOSE_GRACE_MINUTES`, 2865), using
  `Date.now()` of the device and the current stages/stage-bar start time. The
  auto-close effect then disconnects (~13772-13802).
- A device clock that runs ahead, or a stage edit that shortens the total, can
  close the room early for that person. Not related to panels or tab switching.
- Fix: use a server-time offset (from a response `Date` header or an RPC) and
  freeze the close time once the session has started.

### 9. The whole room re-renders every second, even in 24/7 rooms — confirmed, performance

- `setSessionAccessTickMs(Date.now())` runs every second for any session
  (~7140-7150) although only scheduled rooms use it, and the stage timer effect
  (~7990-8034) also updates state every second. Each tick re-renders the
  23k-line room component.
- This is wasted CPU/battery on phones and may make background-tab discard more
  likely (not measured).
- Fix: skip the ticker for infinite rooms and move countdown state into a small
  child component so the room shell does not re-render.

### 10. Panel remount when the layout switches — confirmed, minor

- `RightPanelBody` has two mount points chosen by
  `useOverlayRightPanel = !isLgUp || roomDeviceType === "tablet"` (6329,
  21557-21567). Crossing the breakpoint while a panel is open (resize, rotation)
  remounts the panel and can trigger finding 1 again. LiveKit and
  `RoomAudioRenderer` are outside these branches and are not affected.

## Checked and ruled out

- Panel button handlers: they only set panel state (plus a PiP mode switch for
  chat). No disconnect, leave, fullscreen or reload.
- `pagehide`/`beforeunload` (~10210-10255) only write the lease and a heartbeat
  unless Leave was clicked. No visibility threshold forces a leave.
- `DUPLICATE_IDENTITY`: identity is `<userId>--<tabId>` with a per-mount
  `tabId`; a second tab or a reload gets a new identity. Disconnects from a
  superseded room are ignored (~14064-14069). A same-tab race is theoretically
  possible only with a forced Rejoin during an active native reconnect.
- Tab limit: 20 tabs per user and room, 18-second slot TTL. Not reachable on a phone.
- Token: no `ttl` set, so the 6-hour SDK default applies; recovery always mints
  a fresh token. Admission counts bookings, not live participants; reconnects
  are not refused for capacity. No paywall, session status or presence check on
  the server.
- Server removal: the only LiveKit removal is an explicit host/moderator kick
  (`remove_participant` in `api/livekit/admin.ts`). No LiveKit webhooks.
- Free Flow cleanup cron cancels and hides a room 10 minutes after the owner's
  last heartbeat, but the room client does not disconnect on that update and
  `sessions` stays readable (SELECT policy `true`), so rejoining still works.
- `AppBootstrapGate` already refuses to swap a ready room for its loader.
- Same-user `TOKEN_REFRESHED`/`SIGNED_IN` does not change `authUserId`, so the
  session, entitlement and paywall checks do not re-run mid-session.

## Diagnostics gaps

To confirm the remaining share without guessing, add to the `room_join`
payload and to a remote `room.unmounted` event:

- `performance.getEntriesByType("navigation")[0].type` (`navigate`, `reload`,
  `back_forward`) and `document.wasDiscarded` (Chromium);
- the build id (`import.meta.env` or the entry chunk name);
- the previous instance's last heartbeat time from the lease;
- `window.pagehide` with `persisted` as a remote event (rate-limited);
- the `dynamicImportRecovery` reload as a remote event before reloading.

## Suggested order of work

1. Finding 1 (preload panel chunks, no hard reload inside a live room) and
   finding 2 (panel and room error boundaries). Small, isolated, no media change.
2. Finding 4 (recovery mode for token errors) and finding 3 (same-tab reload
   rejoin marker). Needs the product decision on auto-publishing media after a
   reload.
3. Finding 5 (pause policy countdown while hidden/recovering).
4. Diagnostics gaps, then re-run the queries above for two weeks to measure.
5. Findings 6-10 as follow-ups.

None of these fixes change video capture, send or receive quality, PiP, or
background video handling. Any change that would should be discussed first, as
required by the project rules.

## Fixes (2026-10-11, same branch)

The owner approved all of the above, including a one-time automatic rejoin
after a reload of the same tab with the previous microphone/camera choice.

| Finding | Fix | Where |
| --- | --- | --- |
| 1 Stale chunk reload | Chat, Tasks and Music are `preloadableLazy` and preloaded (idle) right after connect. While joined, `deferDynamicImportReloads()` stops `dynamicImportRecovery` from reloading; it fires `mysession:app-update-available` and the room shows a dismissible "new version" banner with Refresh. | `src/lib/preloadableLazy.ts`, `src/lib/dynamicImportRecovery.ts`, room effects after the `room_join` diagnostic |
| 2 No error boundaries | `RoomPanelErrorBoundary` around Chat, PiP chat, Music and Tasks (stale chunk: Refresh with rejoin; other errors: Try again; Close panel). `RoomSilentErrorBoundary` around AI host, bug report, settings, report participant, timeline editor, Free Flow intro and profile modals (closes them). `RoomCrashBoundary` around the room route (Rejoin / Back to sessions). Errors go to Sentry when configured and to `room_diagnostics`. | `src/components/RoomErrorBoundary.tsx`, `src/App.tsx` |
| 3 Reload lands on prejoin | `sessionStorage` marker (`src/lib/sameTabRoomResume.ts`), refreshed by every lease write while the room is joined. `RoomPageLiveKitEntry` keeps the lease (so the existing lease auto-join runs) only for the first room mount after a page load, when the page was loaded on that room URL and the marker is at most 10 minutes old. The marker is consumed, and revoked on Leave, kick, policy removal, terminal disconnect, session close, ban and in-app exits. | `src/lib/sameTabRoomResume.ts`, `src/App.tsx`, `writeMobileRoomLease` / `revokeSameTabRoomResume` |
| 4 Token error opens prejoin | `requestToken({ recovery: true })` from background recovery keeps the room and overlay on exceptions and on generic errors; admission/ban decisions still leave the room. A 401 retries once after `supabase.auth.refreshSession()`. | `requestToken`, `restoreMobileMediaFromBackground` |
| 5 Policy countdown in background | Camera and screen-share countdowns only run while the page is visible, LiveKit is not reconnecting and the restore overlay is closed; they start over afterwards. "Screen share required" rooms block joining on browsers without screen capture with an explanation in prejoin; reminders on such devices no longer offer an impossible "Share screen". | policy effects, `onJoinGate` |
| 6 Manual Rejoin | Overlay says "Still reconnecting…" and that retries continue; the button is "Rejoin now", and a failed manual attempt hands control back to the automatic loop. Refresh page rejoins automatically. Offline shows a waiting-for-network text. | restore overlay |
| 7 Leave without confirmation | Bottom-bar Leave opens "Leave the room? Stay / Leave" (auto-closes after 8 s, outside tap or Escape). Voice "Leave room" must be repeated or confirmed with "Confirm" within 8 s. | `LiveKitBottomBarLegacy.tsx`, voice handler |
| 8 Device clock | `src/lib/serverClock.ts` measures the offset from the `Date` header of `HEAD /robots.txt` (ignored under 2 s or with a > 10 s round trip). Auto-close, join window, stage timer and `SessionStageBar` use server time. | `serverClock.ts`, room, `SessionStageBar.tsx` |
| 9 Per-second re-render | Stage countdown text lives in `createRoomCountdownStore`; only the top bar, Tasks panel and PiP subscribe. `sessionAccessTickMs` updates only at the end/close boundaries (scheduled rooms). | `src/lib/roomCountdownStore.ts`, room |
| 10 Panel remount on layout switch | `RightPanelBody` renders once through a portal into a host element that moves between the desktop column and the overlay. | room, `attachRightPanelHost` |
| Diagnostics | `room_join` payload adds `navigationType`, `wasDiscarded`, `buildId`, `resumedAfterReload`, `resumeMarkerAgeMs`, `serverClockOffsetMs`; every `room_diagnostics` row has `buildId`; new events `app_update_deferred`, `room_panel_failed`, `room_section_failed`, `room_crashed`; local diagnostics add `token.auth_refresh_retry`. Build id comes from `VERCEL_GIT_COMMIT_SHA` (vite `define`). | `src/lib/pageLifecycle.ts`, `src/lib/roomDiagnosticsReport.ts`, `vite.config.ts` |

Verification: `node --experimental-strip-types --test scripts/*.test.mjs
tests/*.test.mjs` (112 tests, including new `same-tab-room-resume`,
`room-reliability-helpers`, `dynamic-import-recovery` and the source guards in
`room-disconnect-guards`); `scripts/verify-room-performance-types.mjs` (0 new
TS diagnostics); `scripts/verify-room-performance-lint.mjs` (0 new); focused
ESLint on new files; `npm run build`; `scripts/verify-room-performance-bundle.mjs`
(timeline and music still lazy); `CHROME_PATH=... node
scripts/room-reliability-browser.mjs` (8 real-component checks in headless
Chrome at 390 px: stale-chunk panel, render-error panel, crash screen, Leave
confirmation). Not verified: a live two-person LiveKit room on real iOS/Android
devices (needs test accounts); check after deploy with the queries above,
split by `buildId` and `navigationType`.
