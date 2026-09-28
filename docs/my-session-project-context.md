# MySession — project architecture and continuation context

Updated: 2026-09-28. This is a project-wide navigation/architecture handoff based on
the checked-out source, not a claim that every module or production service was
audited. Never put secret values, tokens, user exports or private logs in this file.

## Checkout and safe working rules

- Repository: Lukasso7788/my-session. Deployment branch is main (not necessarily
  the remote default branch). Do not force-push or rewrite shared history.
- Active implementation checkout:
  C:\Users\misha\.codex\worktrees\monthly-attendance\my-session.
  Local branch: codex/session-milestone-tree-badges. Its name is historical; reuse
  it rather than create another checkout purely for naming.
- Base for the current Free Flow badge change: 98faee10d7f1ba863fbb18f88b37efe1752ea0a6,
  matching origin/main when work began. Recent commits: de9715b (OAuth refresh
  storm fix), 98faee1 (remove session-card music indicator). Earlier: 6e8f04a (Plunk direct
  transport/admin preview), ab831cf (Tasks warm reopening), 68acc34
  (reliable chat names/avatars), b376843 (room performance).
- C:\projects\my-session is a different old/dirty checkout with nested work.
  Do not reset, delete or overwrite it. This active checkout is outside current
  writable roots, so commands/patches require approved filesystem escalation.
- User requests full project architectural/technical context in a file for every
  code task. Keep this file and feature-specific handoffs current and link them.
- Latest explicit restriction: do NOT change video behavior during performance
  work. This includes tab/background handling, capture/send/receive quality,
  subscriptions, attachment/recovery, fullscreen and PiP. Discuss any proposed
  video optimization with the user BEFORE implementing it.

## Product/runtime architecture

MySession is a React 18 + TypeScript SPA built by Vite (installed Vite 7.3.2),
React Router 7 and Tailwind. It offers scheduled/infinite group focus rooms,
one-on-one sessions, chat/DM, tasks/focus plans, profiles, subscriptions, admin,
referrals and public SEO/blog content. Supabase supplies identity, data, Realtime
and storage; LiveKit supplies room audio/video/data and SFU transport. The app is
not Next.js. Avoid adding a second routing, SEO or caching framework casually.

Entry:
src/main.tsx -> InAppBrowserMediaGate -> BrowserRouter -> AuthProvider ->
AnalyticsProvider/ProfileCompletionGate -> App -> CreateSessionModalProvider ->
AppBootstrapGate -> routed page. StrictMode is enabled. Gate/auth changes are
high risk: previously reported device-specific login loops and WebView media
problems require preserving current recovery/permission flows.

src/App.tsx owns routes. AppLayout is shared for normal pages; media-heavy routes
and private/admin pages use React.lazy. Main routes include /, /sessions,
/room-livekit/:id, /profile, /settings, /settings/email, /tasks-related focus plan
pages, /admin and /admin/daily-schedule-email. Inspect exact route spelling in App
before adding links. One-on-one hostname handling also lives there. Room entry
clears obsolete mobile recovery leases and gates prejoin for a layout pass.

Directories:
- src/pages: product routes, SEO pages and production RoomPageLiveKit.tsx.
- src/pages/livekit: video tiles, prejoin, bottom/right controls, settings,
  sizing, screen-share helpers, PiP, backgrounds and media processors.
- src/components: shared UI, ChatPanel, TasksPanel, creation/timeline dialogs,
  AI host and moderation/reporting panels.
- src/context: AuthContext and CreateSessionModalContext.
- src/lib: Supabase client, sessions, admission/room policies, placement,
  entitlements/paywall/billing, bans, tasks/focus plans, caches, analytics,
  notifications, referrals, timezones, audio/effect and SEO utilities.
- src/hooks, src/config, src/data, src/types, src/tests: supporting modules.
- public: static images/icons/media, crawl assets and service-worker assets.

## Server/data boundaries

Vercel-style TypeScript endpoints live in api/; Vite alone does not execute them.
vercel.json has filesystem-first routing followed by an SPA index fallback.
Never treat a local Vite-only UI success as live endpoint verification.

- api/livekit/token.ts: validates identity/access/admission and server placement,
  then issues LiveKit grants/token. Independent checks are already parallelized.
- api/livekit/admin.ts: authenticated room moderation/control, room media upload,
  selected session operations, direct invitation/daily email and email admin.
  Server-side Supabase getUser plus admin_users checks protect admin email actions.
- api/sessions.ts, api/sessionById.ts, api/sessions/[id].ts and api/templates.ts:
  session/template access. Inspect each handler before changing persistence.
- api/billing/{create,confirm}-checkout-session.ts and api/stripe/webhook.ts:
  Stripe checkout/confirmation/webhook boundary. Never trust client entitlement.
- api/push: Web Push dispatch boundary; private VAPID/dispatch keys stay server-side.
- api/_lib/sender.ts: Sender lifecycle event integration and outbox processing.
- api/_lib/plunk.ts: direct email transport, separate from Sender lifecycle.

Supabase project ref supplied by user: cxqgzcjsjyszcbcbdusp. Verify actual deployed
schema/environment before DB work. SQL history/tests are in supabase/migrations
and supabase/tests. Relevant data families include profiles/admin_users, sessions,
bookings, attendance and daily attendance history, infinite_room_host_leases,
chat messages/reactions, intentions/panel tasks/focus plans, notifications,
email preferences/send ledgers and email_event_outbox. Current migrations are the
schema authority, not this overview. RLS/admission must not be weakened. Never
authorize against editable user_metadata. No schema changes in the current panel pass.

Presence/host behavior: attendance heartbeat and crash detection are separate
from UI timers; the user has a 90-second alive-window requirement historically.
Infinite-room leases have ownership, heartbeat, expiry, takeover and realtime
reconciliation. Day/month attendance history must not be overwritten by a later
visit. See docs/infinite-daily-attendance.md and migration/tests before changing.
Do not disable these heartbeats to save browser work or globally raise work_mem.

## Other services and companion projects

- cloudflare-worker: Discord schedule/reminder/infinite-room presence notifications
  and push dispatch. Root README documents this worker, not the entire web app.
  It uses dedupe records and secret-protected invocations. Do not run live delivery
  as a performance test. Old README www-host examples are not canonical authority.
- mysession-daily-email-cron: separate daily mail scheduling integration; inspect
  package/config before changing its deployment.
- packages/voice-control: shared voice-related code; room voice command behavior
  is also in RoomPageLiveKit.tsx.
- focusshield/desktop and focusshield/extension: companion blocking application.
  User previously requested extension-based operation and local-only builds/no
  commits for FocusShield. This room task does not authorize changing it.
- jitsi-meet, ai-assistant-suite-repo and nested my-session directories coexist;
  legacy Jitsi iframe routes/utilities remain. Do not assume they are disposable.
- Analytics/Sentry/Stripe/OpenAI-related features already exist. Discover existing
  endpoint and environment conventions before adding providers or packages.

## Email architecture (latest shipped integration)

6e8f04a migrated only admin.ts direct friend-invite/daily-schedule sends to Plunk:
admin.ts -> api/_lib/plunk.ts -> self-hosted POST /v1/send -> SES -> recipient.
PLUNK_API_URL=https://mail-api.mysession.club; server-only PLUNK_SECRET_KEY,
PLUNK_FROM_EMAIL=hello@updates.mysession.club, PLUNK_FROM_NAME=MySession.
Do not create VITE_PLUNK secrets. Stable Idempotency-Key, HTTP OK AND success:true,
sanitized errors; legacy resendId/resend_id fields retained for compatibility.
Admin has a fixed-recipient test to lukasus7788@gmail.com with HTML preview, SHA256
stale-preview check and retry-stable UUID. It does not alter daily audience/ledger.
Sender lifecycle/outbox and Supabase Auth emails remain untouched. No live inbox
delivery was verified in that task. See docs/plunk-phase1-handoff.md for details.

## Public HTML/build architecture

npm run build generates SEO assets, runs Vite, prerenders blog/public SEO routes,
then verifies batch 1 raw HTML. Public canonical host is https://mysession.club.
src/data/seoRouteManifest, src/pages/seo, src/lib/pageSeo/seoStructuredData and
scripts/{generate-seo-assets,prerender-blog,prerender-seo,verify-seo-batch1}.mjs
are relevant. Preserve page-specific raw HTML, titles, canonicals, H1, links,
structured data, sitemap and robots; browser-rendered UI alone is insufficient.

## Production room flow and existing optimizations

RoomPageLiveKit.tsx is the large room orchestrator (over 20k source lines), with
prejoin/identity/admission -> token -> Room connection -> prepared media publish
-> tile rebuild -> controls/panels. src/pages/livekit/VideoTileLiveKit.tsx wraps
VideoTileLiveKitLegacy.tsx: despite the Legacy name, this is the production tile.
Stable callback wrappers and content comparisons preserve memoization.

Existing safeguards: token request dedupe, connection/reconnect/background-tab
recovery, moderator actions, prepared camera reuse, lazy FX/panels, selective
task subscriptions and stale-read protection. Camera receive dimensions are
capped 1280x720 for <=2 participants, 854x480 for <=4, 640x360 for larger rooms.
LiveKit adaptiveStream pixelDensity=1 and dynacast are enabled. pauseVideoInBackground
is deliberately false; do not flip it globally without PiP/recovery testing.
Screen share has intermediate 360p/720p simulcast layers and adaptive tile sizing;
fullscreen/pinning must retain readable detail. Video detach already pauses and
clears srcObject; don't claim it is missing.

RoomAudioRenderer owns playback independently of tile visualization. PiP uses a
portal and/or mobile collage/capture fallback; don't mute audio or duplicate chat
channels when moving UI between windows. Mobile cached frames use WeakMap and
already scale down to the 960x540 collage instead of retaining full 4K canvases.
Published correction uses processor canvases and deferred effect SDK imports.

ChatPanel: load 50 latest, older keyset pages, 300-message memory/render window,
four account/view caches with five-minute TTL. Names/avatars hydrate through
deduplicated confirmed profile reads with transient retry/manual recovery; a host
placeholder cannot suppress hydration. Keep this reliability requirement.
Healthy Realtime doesn't poll; degraded fallback is conditional. Optimistic sends,
read/reaction bookkeeping and stale event/read protection already exist.

TasksPanel: four account/room snapshots with five-minute reuse TTL, cached tasks
paint on reopen while backend revalidates. Channels cleaned when closed. Reads
are bounded (120 personal, 80 session tasks, 40 plans/120 plan items); renders
are bounded (50 team/40 plan items). Public task reconciliation waits for validated
personal state. Do not regain empty spinners just to lower memory.

RoomSoundscapeEngine creates HTMLAudio only after Play, retains two elements for
seamless loops, metadata preload, cancels superseded loading and releases sources
on Stop/disconnect. Pause preserves position. Music progress ticks only for active
playback and visible selected music UI. Don't propose Play-only loading as missing.

See docs/room-performance-2026-09-26.md for exact prior changes and test results.

## Previous task: restore microphone indicator

User wants the real original LiveKit indicator including blue idle bar whenever
the microphone is enabled. They also request investigation/concepts FIRST for
further memory/startup optimizations, not another blanket implementation pass.

Root cause: b376843 changed MicBadgeWithBarVisualizer's mount condition from
!micMuted && !!audioTrack to speaking && !!audioTrack. The original minHeight:16
idle bar vanished and speaking transitions remounted the analyser.
Fix: restore the original condition only; keep BarVisualizer, one bar, colors,
16/100 heights and speaking frame/label behavior. Muting/removing the track still
unmounts LiveKit and cleans its analyser. This restores some per-open-mic analysis
cost intentionally; do not claim this fix reduces overall memory.

Changed product file: src/pages/livekit/VideoTileLiveKitLegacy.tsx.
New isolated fixture: scripts/speaking-indicator-browser.mjs and
scripts/fixtures/speaking-indicator-browser-check.js. Actual VideoTile + LiveKit,
synthetic local audio track on local/dark and remote/light presentation, no mic
permission or Supabase/LiveKit server. This verifies rendering/analyser behavior,
not a real remote SFU call. Browser passed 25 assertions: idle bar, speech response,
speech-end persistence, mute/unmute, replacement, five mount/unmount cycles,
track removal and zero uncaught errors. All audio contexts closed at test end.

Verification commands from active checkout:
node --test scripts/tasks-panel-cache.test.mjs scripts/chat-profile-loader.test.mjs scripts/room-performance.test.mjs
node scripts/verify-room-performance-types.mjs
node scripts/verify-room-performance-lint.mjs
npm run build
git diff --check

Browser reproduction (isolated, no production data):
1. node scripts/speaking-indicator-browser.mjs
2. npx --no-install agent-browser --session speaking-indicator open http://127.0.0.1:4193/
3. Click Start synthetic speech once to unlock audio, then Silence and wait for idle.
4. Get-Content -Raw scripts/fixtures/speaking-indicator-browser-check.js | npx --no-install agent-browser --session speaking-indicator eval --stdin
5. Close the owned browser session and stop the fixture server.
An eval-only AudioContext.resume can hang without the initial real button gesture.
Do not misdiagnose browser autoplay restrictions as a production indicator bug.

Final verification: 22/22 existing room/chat/profile/cache unit tests passed;
25/25 actual-component browser assertions passed. npm run build including public
SEO prerender/5-route verification passed; git diff --check passed. App TypeScript
HEAD=251 diagnostics, working=251, new=0. Focused ESLint HEAD=709 errors,
working=709, new errors/warnings=0. Existing bundle-size, browser-data and eslint
ignore compatibility warnings remain. This is not a globally clean typecheck/lint.
No real multiuser SFU or production-memory benchmark was performed. The owned
browser/server were closed; screenshot is in Windows temp, not the repo.
The initial restoration was local only. The user subsequently authorized room
optimization implementation and commit/push to main; the continuation below
includes the restored indicator in the same focused release.

## Continuation: bounded PiP cache and lightweight room updates

Scope implemented on 2026-09-27 (no DB/API/infrastructure changes):
- src/lib/pipAvatarCache.ts: bounded 64-entry LRU of image/failure records.
  Loading requests for the same URL reuse one image. Eviction/clear detach handlers
  and remove src; late errors cannot recreate entries or clear newer same-URL
  images. Room disconnect clears the cache after PiP close. No additional polling,
  forced avatar placeholders, full-size canvas copies or network telemetry added.
  This bounds references/count, not decoded bytes for each individual image;
  browser HTTP/image caches are outside this application's direct control.
- src/lib/roomSpeakingState.ts and RoomPageLiveKit.tsx: ActiveSpeakersChanged
  patches only changed unmuted camera tiles and reuses unchanged objects/arrays.
  The SDK list maps localParticipant to the local tile and remote SIDs to their
  existing tiles. Screen tiles keep prior semantics. No publication traversal,
  metadata parsing, volume resetting or screen subscription work on speech alone.
  Track/mute/participant/reconnect events still own full RAF-coalesced rebuilds.
  Listener and deferred functional updater both verify current Room and connection
  attempt, preventing an old connection from changing a new room. Existing
  removeAllListeners/disconnect cleanup is retained.
- src/lib/participantClock.ts and ParticipantTimeLabel.tsx: one shared 30-second
  interval while clock labels are mounted, removed with the last subscriber.
  useSyncExternalStore makes a clock tick rerender the memoized label, not its
  VideoTile or room parent. New mounts resume with current time. Main and PiP
  presentations share this store. Timezone formatting/styles are unchanged.
- Restored LiveKit idle BarVisualizer remains active for every open microphone.
  Do not reintroduce speaking-only mounting to claim reduced memory usage.

New test coverage: scripts/room-memory.test.mjs tests the actual production
speaker listener extracted through the TS AST (including delayed execution guards),
unchanged/muted/screen state, cache capacity/load/error/late eviction/rejoin and
100 clock subscribers using one timer. Extended synthetic VideoTile browser tests
instrument render counts only inside the test Vite fixture. Clock time advance
checks the rendered label changes without rerendering the media tile.

Validation: 28/28 unit tests passed; TypeScript remains 251 baseline diagnostics
with 0 new; focused lint remains 709 baseline errors with 0 new errors/warnings.
Production build, SEO prerender and five-route raw-HTML checks passed. 40/40 actual
tile browser assertions passed, including zero media-tile renders on clock ticks,
one clock timer and analyser/timer teardown. All owned test processes were closed.
Final push identity is recorded in git log and the completion response; this file
belongs to the same commit. Commit message:
"Bound room media caches and isolate speaking and clock updates".
No claims of measured production RAM or join-speed percentage. Real multiuser
SFU/mobile PiP and long-duration tab-memory benchmarks remain follow-up checks.
Other candidate optimizations below remain design work unless explicitly listed
in the next continuation.

## Current continuation: lazy optional controls and expiring panel snapshots

User authorized continued optimization of panels/imported modules, with an
explicit prohibition on changing video behavior. Scope implemented 2026-09-28:

- src/lib/roomTimelineModel.ts: 24 existing pure declarations extracted from
  RoomTimelineEditor.tsx. Schedule parsing/serialization, infinite anchor, block
  colors/defaults, Free Flow presets/names and generated IDs retain their bodies.
  Verified all declarations against the preceding commit's TS AST: identical
  except export modifiers/line endings. No schedule/admission/host changes.
- src/components/RoomTimelineEditor.tsx retains the original UI, hooks and old
  public re-export API for legacy callers. RoomPageLiveKit and FreeFlowIntroModal
  import the pure model directly rather than dragging editor UI into startup.
- RoomPageLiveKit loads RoomTimelineEditor and RoomSoundscapePanel through
  module-scope React.lazy only when opened, with LOCAL Suspense boundaries.
  Loading a control must not suspend/remount the entire room or its audio/video.
  Music fallback can close the drawer; timeline fallback can cancel the modal.
  The music engine, progress logic, playback/sharing/seek callbacks remain intact.
- src/lib/panelSnapshotCache.ts: shared bounded snapshot utility for Chat/Tasks.
  Default four entries, five-minute TTL, access-time sweep of ALL expired entries
  even when reading a missing key or writing another room. No periodic sweep,
  timers, DB reads, subscription changes or persistence added. Expired references
  are released at the NEXT cache access, not guaranteed at the exact TTL instant.
  Reads don't extend TTL; updating a key refreshes write order and expiry.
- tasksPanelCache.ts preserves its wrapper, scope key and stale-read reconciler.
  ChatPanel replaces only its Map/TTL plumbing. Account/room/DM keys, author
  hydration, confirmed profiles, avatar URLs, reactions, request guards, optimistic
  messages and all Realtime handling are unchanged. Warm reopening still renders
  the snapshot while normal background validation proceeds. The confirmed author
  loader Map itself remains a separate potential optimization (not changed).

Product files changed: src/pages/RoomPageLiveKit.tsx,
src/components/{ChatPanel,FreeFlowIntroModal,RoomTimelineEditor}.tsx,
src/lib/{panelSnapshotCache,roomTimelineModel,tasksPanelCache}.ts.
Verification files: scripts/{panel-snapshot-cache.test,room-timeline-model.test,
room-performance-browser,verify-room-performance-bundle,
verify-room-performance-lint}.mjs and
scripts/fixtures/lazy-room-panels-browser-check.js, plus this context file.
No API, DB migration, infrastructure, media-track/tile/background or email changes.

Verification from this checkout:
node --test scripts/panel-snapshot-cache.test.mjs scripts/room-timeline-model.test.mjs scripts/tasks-panel-cache.test.mjs scripts/chat-profile-loader.test.mjs scripts/room-memory.test.mjs scripts/room-performance.test.mjs
node scripts/verify-room-performance-types.mjs
node scripts/verify-room-performance-lint.mjs
npm run build
node scripts/verify-room-performance-bundle.mjs
git diff --check

Results: 37/37 unit tests; App TS baseline=251, current=251, new=0. Focused lint
baseline/current=729, new errors/warnings=0 (expanded coverage includes timeline
editor and optional controls; this is not an increase over its same-scope base).
Lint compares the mechanically moved editor/model as ONE logical unit; other
files still compare independently and new cache code gets no baseline exemption.
Production build and public raw-HTML five-route SEO verification passed.
Actual build import traversal confirms both optional UI chunks absent from the
room's static dependency graph: editor 26,226 bytes (7,226 gzip), music 11,035
bytes (3,729 gzip), combined 37,261 bytes raw / 10,955 gzip deferred. This is a
startup loading reduction, not a measured RAM/join-speed percentage.

Browser test: node scripts/room-performance-browser.mjs (127.0.0.1:4192).
The fixture imports actual ChatPanel/TasksPanel and lazy editor/music UI, but uses
an isolated mock Supabase client and callbacks: NO production data/credentials,
real SFU or actual shared audio session. Open a fresh browser page for each suite:
Get-Content -Raw scripts/fixtures/chat-profile-browser-check.js | npx --no-install agent-browser --session room-panels eval --stdin
Get-Content -Raw scripts/fixtures/tasks-panel-cache-browser-check.js | npx --no-install agent-browser --session room-panels eval --stdin
Get-Content -Raw scripts/fixtures/lazy-room-panels-browser-check.js | npx --no-install agent-browser --session room-panels eval --stdin
First two suites may run sequentially on one fresh page; reload before the lazy
suite so optional-resource assertions aren't affected by a previous opening.
55/55 browser assertions passed (17 author/realtime, 18 task cache, 20 lazy UI):
warm reopen, failed refresh, stale reads, scope isolation, real names/avatar URLs,
cleanup, modules not fetched before opening/not fetched again on reopen,
timeline edit/save/cancel/anchor, music select/play/pause/close/state persistence,
and zero uncaught runtime errors. Music callbacks are mock actions, not a claim
of real audible playback; unchanged audio engine regression tests also passed.
Windows temp screenshots are local verification artifacts, not repository assets.

Deploy the scoped frontend commit through the existing main deployment pipeline;
no new environment variables or migrations. New optional chunks must be served
with the matching build assets. Real-device, slow-network, multiuser SFU and long
heap/native-media retention benchmarks remain follow-up measurement work.
Git log/completion response record the final commit/push identity for this pass.

## Current continuation: remove session-card music indicator

The session-card shared-music badge added in commit 858092f was removed at the
user's request. This removal includes the badge and CSS, the `musicPlaying`
SessionCard prop, room-side Realtime Presence publisher, listing-side Presence
listener/hash mapping/state, and dedicated helper/test/browser fixture files.
The SessionsPage `sessions-active-hosts` channel still subscribes to
`infinite_room_host_leases` Postgres changes and calls `supabase.removeChannel`
on cleanup. Room soundscape and shared-tab music playback/transport remain
unchanged. No database migration, authorization change or new environment
variable is involved. The former implementation remains recoverable from
Git history but should not be treated as active architecture.

Validation: the changed production source files match pre-indicator commit
b8145fe exactly (`git diff b8145fe --` on those paths is empty); the remaining
63 script tests pass, including independent music-permission and soundscape
tests; `npm run build` and all five SEO HTML checks pass; `git diff --check`
passes. App TypeScript still reports the same 251 pre-existing diagnostics.
The Supabase skill's read-only SQL check confirmed the existing
`public.infinite_room_host_leases` table remains present; no schema was changed.
No authenticated two-person live-room/music test was run. After deployment,
verify card rendering without a music badge, host-lease updates in Sessions,
and room music playback. Deleting music-indicator-specific tests is not a
regression in the independent soundscape/audio tests.

## Current continuation: laptop-specific Discord OAuth refresh storm

Issue reported by Dory: Discord login works on her phone but the laptop briefly
shows a signed-in avatar, then returns to an anonymous header or the callback's
"Sign-in needs another try" UI. The provided dated screenshots show the login
form, timezone gate, anonymous /sessions page and callback error, not browser
network/console details. The older timezone screenshot is not evidence that the
timezone gate still blocks the account today.

Read-only production evidence from the September 21 attempt (about 16:27 Kyiv):
Discord OAuth completed and /user returned HTTP 200, followed by 44 auth /token
refresh calls in roughly one minute (most in only a few seconds) and two HTTP
429 responses. The auth account and saved timezone exist. This demonstrates a
refresh storm and rate limiting after a successful identity exchange; it does
not by itself prove why that particular laptop began refreshing. A skewed
Windows clock, browser storage state or tab interplay remain possible triggers.
No private account IDs, emails, tokens, IPs or raw logs are stored here.

Auth flow: src/lib/supabase.ts constructs one browser Supabase client with
storageKey "mysession-auth", persistent localStorage, PKCE/redirect detection and
automatic refresh. src/pages/LoginPage.tsx starts Discord OAuth. Supabase
exchanges the redirect before src/pages/AuthCallback.tsx calls getSession,
adopts the session through src/context/AuthContext.tsx and navigates to /sessions;
profile hydration/referral are best-effort background work. AuthContext also
handles INITIAL_SESSION/SIGNED_IN/SIGNED_OUT/TOKEN_REFRESHED and reads the
profiles row. src/components/AppBootstrapGate.tsx suppresses its own auth read
on callback routes but checks access control elsewhere. ProfileCompletionGate
may then ask for required timezone/real name and sync profile metadata.

The installed @supabase/auth-js checks the absolute expires_at against device
Date.now() (with a 90-second margin) when loading a session. A laptop clock
far ahead can therefore make a fresh server token look expired and make every
getSession refresh again. Previously src/lib/supabase.ts also performed a
recurring-task auth getSession on every TOKEN_REFRESHED event, and AuthContext
reloaded the profile on every such event. Both amplified a refresh storm and
could lead to rate limiting and the callback error. No auth settings, provider,
database RLS, profile schema, or authentication server were changed.

Implementation:
- New src/lib/authSessionStorage.ts wraps ONLY the Supabase auth storage key.
  If server absolute expiry and local receipt time + expires_in differ by more
  than 30 seconds, it stores a locally scheduled expiry with a bounded early
  refresh margin (up to 60 seconds). Access token, refresh token, JWT claims and
  server authorization remain untouched. Same-token re-save preserves the prior
  local expiry, so metadata updates cannot prolong a token. Correct clocks,
  PKCE code-verifier keys, malformed values and non-session storage retain the
  SDK's normal behavior. This guards against skew in either direction but is
  not a replacement for a correct system clock.
- src/lib/supabase.ts now retains the user ID from auth events and materializes
  recurring tasks after INITIAL_SESSION/SIGNED_IN, plus the existing visible,
  focus and hourly checks. TOKEN_REFRESHED no longer issues getSession or a
  new materialization attempt. The per-user/day marker and in-flight guard
  remain. SIGNED_OUT clears the remembered user ID.
- src/context/AuthContext.tsx now updates the session token on same-user
  TOKEN_REFRESHED without another profiles SELECT. New account/other auth
  events, explicit profile reload, metadata/profile updates and sign-out
  reconciliation keep their established behavior. The avatar/name fallback
  remains immediate on login. Reducing same-user profile reload also avoids
  needlessly retriggering ProfileCompletionGate via changed user metadata
  object identity.
- Regression tests: scripts/auth-session-storage.test.mjs covers normal clock,
  both directions of skew, same-token re-save, malformed storage/PKCE, and a
  fake-network test against the installed GoTrueClient proving ten getSession
  calls require only one refresh. scripts/test-auth-races.mjs covers 40
  TOKEN_REFRESHED events without profile/auth reads and recurring-task boot,
  focus and logout behavior.

Validation at this stage: 20 focused auth tests and 68 tests across scripts
passed; production npm run build including SEO checks passed. The global app
TypeScript check and focused ESLint retain pre-existing diagnostics outside
the changed logic; see the task's final verification for exact counts. No DB
migration or environment variable is needed. The live laptop/browser outcome
cannot be confirmed until the matching frontend deploy is live and Dory retries.
After deploy, verify Discord OAuth on the affected laptop, repeat on a normal
clock/browser, reload, open another tab, revisit after one token lifetime, and
watch /auth/v1/token rate, 429s, signed-in header, timezone gate and profile.
If still failing, collect redacted browser time/clock-offset, /token status
sequence and callback console/network failures; do not ask the user for tokens.

## Current continuation: Free Flow badge on session cards

SessionCard previously chose "Custom session" whenever `is_custom`, studio
format, or `created_via=studio` was present. Free Flow infinite rooms can carry
that custom marker, so they showed a generic badge. Free Flow is instead
identified by persisted `schedule.variant="free_flow"` or
`schedule.free_flow=true`, the same markers used by SessionsPage and
RoomPageLiveKit. Room titles are user-editable, so title text is not reliable.

src/components/SessionCard.tsx parses the schedule with its existing
`tryParseJson` helper (including legacy JSON strings), before resolving the
card type. An infinite session whose parsed schedule matches
src/lib/freeFlowSession.ts gets `resolvedType="Free Flow"` before the ordinary
custom check. The new typeMap/hover entries reuse the exact Custom session
purple colors and `/icons/custom.svg`; only the visible type text changes.
The parsed schedule variable is reused later for timeline rendering, avoiding
a second parse. Non-Free-Flow custom and preset cards retain their prior type.
No room/audio/video/booking logic, Supabase query, schema or permissions change.
scripts/free-flow-session.test.mjs covers both persisted markers and ordinary
custom/preset negatives. Verification: 65/65 script tests pass, including the
two new classifier cases; `npm run build` and all five SEO HTML checks pass;
the app TypeScript check still reports the same 251 pre-existing diagnostics;
focused lint on the new helper/test passes and `git diff --check` is clean.
No live authenticated card was inspected. After deploy, visually inspect a
Free Flow infinite card and an ordinary custom card.

## Optimization backlog (implemented items noted; remaining items are concepts)

Prioritize measurement before changing semantics. Heap is only part of Chrome tab
memory: video decode buffers, GPU/canvas surfaces and native WebRTC/audio allocations
can dominate. No production RAM percentage or join-latency improvement is measured.

1. Implemented: bounded mobile PiP avatar LRU and late-load guards. Optional decoded
   avatar pixel-size budgeting remains measurement/design work.
2. Implemented: separate active-speaker flag updates from full tile rebuilding.
   Track/participant updates still fully reconcile media and metadata.
3. Implemented: one shared coarse timer and isolated memoized clock labels. This
   principally reduces CPU/allocation churn rather than large video buffers.
4. Evict chat profiles no longer referenced. createChatProfileLoader confirmed Map
   has no per-author capacity while message windows are bounded. Pin authors in
   visible/cached messages and active participants, keep confirmed names, dedupe
   pending requests and guard late results. TTLs are reuse rules, not guarantees
   of immediate expired-entry memory reclamation; clean stale chat/task cache
   entries opportunistically without constant polling. Snapshot expiry sweep is
   now implemented on cache access; confirmed-profile pruning remains a concept.
5. Avoid simultaneous unnecessary video presentations. Main grid, pinned/fullscreen
   and PiP can attach the same track to multiple elements. Measure attached-element
   count and decoded frame sizes; detach obscured duplicate views when safe. More
   elements need not mean independent decoders, so don't promise a linear saving.
6. Visibility-aware gallery window for large rooms. Mount only visible tile media
   plus overscan, preserving layout/name/tasks/audio/pinned/fullscreen/PiP. CSS
   content-visibility by itself is not proof of stopped decoding. Avoid unsubscribing
   audio or breaking screen-share subscription recovery. Existing adaptive behavior
   needs measurement before layering custom subscription rules on it.
7. Frame-rate/processor budgets by rendered need and device. Camera send preset
   currently follows device tier; receiving caps exist. Investigate temporal caps,
   effect resolution and adaptive capture with hysteresis, not repeated getUserMedia
   restarts. Do not reduce fullscreen screen text detail or force a codec without
   browser/mobile compatibility data. Capture/send/receive are different budgets.
8. PiP/effects release audit. Check only-active canvas loops, buffers after Off/PiP
   close, ended tracks and native audio sources. Canvas frame cache already scales
   frames and uses WeakMap; don't repeat completed optimization as a new defect.
9. Split room subscription/state ownership into bounded memoized UI islands so
   countdowns/music/task ticks don't traverse the whole room. Keep room connection
   and async race guards stable. Splitting a 20k-line file alone is not a RAM fix.
10. Chat DOM virtualization for the 300-row window, preserving variable heights,
    anchored older-page scroll, reactions, editing and accessibility. Message limits
    already exist; don't hide names/avatars or erase history to optimize.
11. Tasks granular updates/virtualization and snapshot pruning. Preserve warm reopen,
    timer persistence, drag/drop order and public task consistency. Offscreen content
    visibility and existing fetch/render bounds are already in place.
12. Timeline editor and music UI deferral are now implemented. Remaining splitting:
    measure PiP/mobile recovery and room command grammar as optional modules.
    Several settings/FX/panels are already
    lazy; imports that affect permission/connection must not cause new waterfalls.
13. Startup critical-path traces: measure auth/bootstrap/token, DNS/TLS/SFU, first
    audio/video separately; preload room code on deliberate join intent, start only
    independent operations in parallel. No speculative microphone permission prompts.
14. Audit one-shot UI sound buffers and pause-vs-stop retained media before lowering
    music preloads. Preserve seamless looping/shared-tab audio and resume semantics.
15. Server/SFU/TURN/region/network hypotheses require separate read-only telemetry.
    Inspect ICE/reconnect stats and allocation before infrastructure changes. A
    frontend screenshot cannot prove server fault or stable client network.

Suggested benchmark: same browser/device/scenario, 2/6/12 participants, effects
off/on, gallery/pinned/fullscreen/PiP, repeated panel/room openings, background
return, 30-60 minutes. Record join p50/p95 and first media, JS retained heap after
GC, DOM/video/audio/context counts, getStats frames/bytes/quality limitation,
Chrome total tab memory and CPU. Require stable retention after repeated teardown.
Do not ship always-on database telemetry or load test production with fake users.
Preserve admission/grace, host leases, crash detection, camera/mic, all music,
screen share, PiP, tasks/chat reliability and authentication throughout.

## 2026-09-29 — Room timeline block identity after renaming

Architecture: `src/components/RoomTimelineEditor.tsx` edits `RoomTimelineBlock`
records (`kind` is the semantic identity, `title` is user-facing text). The
serializer in `src/lib/roomTimelineModel.ts` persists both `kind` and `type`
alongside the title/name for scheduled arrays and infinite/free-flow phases.
`src/pages/RoomPageLiveKit.tsx` reads those schedules into room `Stage` objects,
which feed `src/components/RoomTopBar.tsx` -> `SessionStageBar.tsx` and the room
stage-transition sound timer. `SessionStageBar` already prefers `stage.kind`
over the display name when it is present; check-in maps to the intentions color
and its sound uses the intentions category. Legacy schedules without a typed
block continue to infer from title.

Root cause: both scheduled-array loaders ignored persisted `kind` and used only
`type`/`category`; both infinite-phase loaders called a normalizer that discarded
`kind`, then inferred stage type from `name`. The normalizers also replaced
custom phase titles with generic labels. Once a name no longer contained a
recognizable keyword, fallback was focus, causing the wrong state-bar color and
focus gong. A renamed break could also lose break-end audio behavior.

Fix: room stage construction now prefers stored `kind`, preserves it on `Stage`
for the bar, and uses it for sound category. Infinite-phase normalization retains
`kind`, `color`, and `name` separately; the original title remains visible.
No database schema, video behavior, polling, or subscription changes. Regression
test `scripts/room-timeline-model.test.mjs` covers check-in, break, and focus
renames in both scheduled and infinite payload round trips. Production `npx vite
build` and `git diff --check` passed. File-wide ESLint has a large pre-existing
error baseline in `RoomPageLiveKit.tsx`; no full lint cleanup attempted.

Follow-up, 2026-09-29: `RoomTopBar.tsx` rendered the current-stage chip from
raw `currentStage.color`, whereas the timeline rendered through
`SessionStageBar.resolveStageVisual()`. That resolver intentionally forces
check-in to the intentions light-blue color even if an old schedule stores a
wrong blue. The chip now uses the same resolver, so its background matches the
timeline for typed check-in blocks and does not diverge on legacy colors.
