# MySession — project architecture and continuation context

Updated: 2026-10-05. This is a project-wide navigation/architecture handoff based on
the checked-out source, not a claim that every module or production service was
audited. Never put secret values, tokens, user exports or private logs in this file.

## Checkout and safe working rules

- Repository: Lukasso7788/my-session. Deployment branch is main (not necessarily
  the remote default branch). Do not force-push or rewrite shared history.
- Active implementation checkout:
  C:\Users\misha\.codex\worktrees\tasks-pip-accent\my-session.
  This managed worktree is at a detached HEAD; commit this feature here and
  push HEAD:main only after checking origin/main for new commits.
- Current task: refine the four always-visible background effect choices in
  the production LiveKit pre-join row to use larger icon-only buttons. The
  final section records implementation and verification.
  Earlier Plunk work and operational runbook remain documented in
  docs/plunk-email-rollout.md. No mass campaign is authorized by this task.
- C:\projects\my-session is a different old/dirty checkout with nested work.
  Do not reset, delete or overwrite it. Inspect active worktree status before
  staging; never stage unrelated generated files.
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
- api/_lib/sender.ts: legacy Sender lifecycle transport retained for audit/rollback;
  its event names/sanitizer/test fixtures are reused by the Plunk cutover module.
- api/_lib/plunk.ts: direct transactional email transport via self-hosted Plunk.
- api/_lib/plunkLifecycle.ts: staged lifecycle event/consent sync through Plunk.

Supabase project ref supplied by user: cxqgzcjsjyszcbcbdusp. Verify actual deployed
schema/environment before DB work. SQL history/tests are in supabase/migrations
and supabase/tests. Relevant data families include profiles/admin_users, sessions,
bookings, attendance and daily attendance history, infinite_room_host_leases,
chat messages/reactions, intentions/panel tasks/focus plans, notifications,
email preferences/send ledgers and email_event_outbox. Current migrations are the
schema authority, not this overview. RLS/admission must not be weakened. Never
authorize against editable user_metadata.

Presence/host behavior: attendance heartbeat and crash detection are separate
from UI timers; the user has a 90-second alive-window requirement historically.
Infinite-room leases have ownership, heartbeat, expiry, takeover and realtime
reconciliation. Day/month attendance history must not be overwritten by a later
visit. See docs/infinite-daily-attendance.md and migration/tests before changing.
Do not disable these heartbeats to save browser work or globally raise work_mem.
The 2026-10-03 Plunk task adds a new migration; application deployment does not
automatically apply SQL migrations.

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

## Email architecture and staged lifecycle migration

6e8f04a migrated only admin.ts direct friend-invite/daily-schedule sends to Plunk:
admin.ts -> api/_lib/plunk.ts -> self-hosted POST /v1/send -> SES -> recipient.
PLUNK_API_URL=https://mail-api.mysession.club; server-only PLUNK_SECRET_KEY,
PLUNK_FROM_EMAIL=hello@updates.mysession.club, PLUNK_FROM_NAME=MySession.
Do not create VITE_PLUNK secrets. Stable Idempotency-Key, HTTP OK AND success:true,
sanitized errors; legacy resendId/resend_id fields retained for compatibility.
Admin has a fixed-recipient test to lukasus7788@gmail.com with HTML preview, SHA256
stale-preview check and retry-stable UUID. It does not alter daily audience/ledger.
The 2026-10-03 continuation replaces the admin.ts lifecycle delivery calls with
api/_lib/plunkLifecycle.ts, but delivery remains OFF unless
PLUNK_LIFECYCLE_ENABLED=true, SENDER_INTEGRATION_ENABLED=false, all Plunk keys
are present, and a UTC PLUNK_LIFECYCLE_CUTOVER_AT has passed. The existing
email_event_outbox and event names are retained. The new SQL claim RPC sees
only post-cutover rows; old Sender backlog is never replayed. A separate
cutover-aware evaluator avoids historical inactivity/stalled-signup blasts.
The Cloudflare cron retains legacy `senderAction`/SENDER_LIFECYCLE_URL names but
calls the new Plunk handler; evaluate is further gated by
PLUNK_LIFECYCLE_EVALUATOR_ENABLED=true. Event acceptance by `/v1/track` is not
proof of a delivered email: enabled Plunk workflows and SES must be checked.

Marketing consent lives in public.email_automation_preferences and defaults to
false. An explicit toggle enqueues a preference event; the handler updates a
Plunk contact's `subscribed` bit only for such a transition. Other lifecycle
events first ensure a missing contact is unsubscribed, because `/v1/track`
otherwise auto-subscribes new contacts. Plunk hosted unsubscribe can sync back
through a secret-authenticated webhook and service-role-only SQL function.
Campaigns must use a marketing/opted-in segment, never transactional `ALL`.
At inspection there were zero explicit opt-ins and 648 pending historical
outbox events; these numbers are a point-in-time observation, not live state.
Supabase Auth/security mail stays outside Plunk. See
docs/plunk-phase1-handoff.md and docs/plunk-email-rollout.md.

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

## 2026-10-04 — Session-card signals and session-type occupancy badges

User-provided design references: `7 Focus Hub — список комнат.png` for compact
room-policy pills and a rotating music disc; `session format switcher.png` for
LIVE counts. Supplied `Frame 259.svg`, `music indicator.svg`, and `music.svg`
were copied as project assets under `public/icons/session-*.svg`; the existing
bottom-control camera/screen-share SVGs are CSS-masked to match each card type.

Data and rendering architecture:

- `src/pages/SessionsPage.tsx` loads base sessions, then optional
  `camera_required`, `screen_share_required`, and `public_chat_disabled`
  enrichment. The persisted `schedule.room_policies` remains the fallback and
  also contains `camera_or_screen_share_required`. No new policy query was
  added. `src/lib/roomPolicies.ts` is the single policy reader.
- `src/components/SessionCard.tsx` renders
  `SessionRoomPolicyIndicator` after the title. `src/lib/sessionCardIndicators.ts`
  derives and labels the icon state; it draws only enabled flags:
  camera, screen share, and public chat off. The alternative camera-or-screen
  rule is explicitly labelled `or`; hard requirements supersede contradictory
  legacy alternative data. 0 flags means no pill. The existing card type
  palette is reused: Deep Work blue, Pomodoro red, Short Sprints green,
  Custom/Free Flow indigo. No session settings are changed by the indicator.
- Shared music is room-local LiveKit state, not a session DB column.
  `RoomPageLiveKit.tsx` advertises on `sessions-active-hosts` Supabase
  Realtime Presence only while connected and actually publishing a shared
  room soundtrack (host/moderator) or tab music. Personal music and passive
  listeners do not publish. The publisher removes its channel on stop,
  disconnect or unmount. Reconnect retracks after SUBSCRIBED. The public key
  is SHA-256 of the normalized session UUID, not the UUID itself.
- `SessionsPage.tsx` listens to Presence on its existing host-lease Realtime
  channel; it creates no extra listing channel, DB row, read, or timer. It
  maps only current session IDs to opaque keys and passes a boolean to each
  `SessionCard`. On Presence sync, cards add/remove `SessionMusicIndicator`.
  The disc spins and type-colored notes from the supplied asset fade/float;
  reduced-motion
  users get a static disc. Presence is best-effort; a network failure hides
  the cosmetic badge but does not affect audio.
- `SessionsPage.tsx` already fetches `get_live_counts` for the listed sessions
  initially and approximately every 90 seconds while visible. New
  `switcherLiveCounts` sums positive `live_count` over active sessions after
  the existing privacy/hidden filter, by `resolveSessionType`. This counts
  people in visible Group/Infinite rooms regardless of the selected tab/date;
  it does not disclose hidden/private occupancy to unauthorized visitors.
  `SessionTypeSwitcher.tsx` renders a green Group or red Infinite badge only
  when its total is greater than zero, with a white 1px border. The red badge
  uses white icon/text, green uses dark icon/text. One-on-one is unchanged.
  The count is only as fresh as existing live counts; no new polling/read.

No schema migration, server endpoint, video pipeline, room admission,
task/chat/music playback, or auth behavior changed. Tests for Presence state,
publisher cleanup/reconnect, opaque keys and non-publisher cases are in
`scripts/room-music-presence.test.mjs`; 0–3 policy combinations/OR semantics
are covered by `scripts/session-card-indicators.test.mjs`. Run
`node --experimental-strip-types --test scripts/room-music-presence.test.mjs
scripts/session-card-indicators.test.mjs`, `npm run build`, focused ESLint,
and `git diff --check`. Browser QA: open `http://127.0.0.1:4173/sessions` with
the local Vite server; it uses production Supabase for read-only data. Do not
edit room settings or join rooms solely for QA. A live shared-music playback
and 2/3-policy card must still be confirmed after deployment because neither
scenario existed in the read-only preview at verification time.

## 2026-10-04 — OR badge separator refinement

The `camera_or_screen_share_required` policy still keeps its accessible
"Camera or screen share required" label and two existing media icons. Only
the visible separator in `src/components/SessionRoomPolicyIndicator.tsx`
changed from tiny `or` to `/`, using the existing Tailwind Inter font family,
700 weight, 16px size, and indigo `#6366F1`. No data, policy, LiveKit,
Presence, or session-switcher behavior changed. The user-supplied `or.png`
is an indigo pill color/shape reference, not a source of extra UI assets.
Visual QA used a temporary instance of the actual component in the existing
`/ui-playground` route; that fixture was removed afterward. Browser computed
styles confirmed `Inter, system-ui, sans-serif`, `16px`, `700`, and
`rgb(99, 102, 241)`. Screenshot evidence is in `design-qa.md`.

## 2026-10-04 — LIVE badge alignment and immediate policy tooltips

`src/components/SessionTypeSwitcher.tsx` now anchors each nonzero Group or
Infinite `LIVE` pill with `right-0` at the top of its own button, rather than
centering it. Existing occupancy data, colors, zero-hiding, button labels,
click targets, and room-type switching are unchanged. Desktop and 375px
mobile previews confirm the pill remains inside the switcher.

`src/components/SessionRoomPolicyIndicator.tsx` replaces the pill's delayed
native `title` with an individual CSS-only tooltip per camera, screen-share,
and no-chat icon. The visible tooltip appears immediately on hover or keyboard
focus; each icon has its own accessible label. In an OR policy, labels say the
camera and screen-share icons are alternatives, not two hard requirements.
The parent pill retains its group-level accessible summary. No timers,
database reads, session settings, or LiveKit behavior were changed. Browser
QA confirmed a camera tooltip on hover and `display: block` on keyboard
focus; screenshots/remaining context are in `design-qa.md`.

## 2026-10-04 — Deduplicated LIVE people and restored music presence

This supersedes the earlier description that the session-type LIVE badges sum
card `live_count` values. That sum counted a single user in multiple rooms
multiple times (production read-only aggregate showed six room attendances but
only three unique people in public infinite rooms at one observation).

`supabase/migrations/20261003213654_unique_live_switcher_counts.sql` adds
`public.get_live_counts_with_unique(uuid[], uuid[], integer)`. It uses the
same `session_attendance.last_seen_at > now() - 90 seconds` definition as the
existing `get_live_counts` RPC. In one call it returns JSON with per-room
counts for cards and `count(distinct user_id)` for the visible Group and
Infinite room sets. No attendance schema, heartbeat cadence, or old RPC is
changed. The function returns only aggregates, not individual IDs, and is
executable by `anon` and `authenticated` like the old count RPC. Its ttl is
bounded. Applied to production Supabase project `cxqgzcjsjyszcbcbdusp`
before the frontend push; migration history version is `20261003213654`.
Read-only verification returned three unique Infinite users across six live
room attendances, matching an independent `count(distinct user_id)` query.
Supabase Security Advisor flags this public `SECURITY DEFINER` aggregate RPC
for both `anon` and `authenticated`, as it does the pre-existing
`get_live_counts` RPC. This is intentional for public occupancy counts and
does not expose user IDs or rows; changing it to invoker would hide all
anonymous attendance under current RLS. Review if public count visibility
requirements change: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable .

`src/pages/SessionsPage.tsx` collects room IDs only after its active and
privacy/hidden filters, then calls this RPC once on initial list render,
every 90 seconds while visible, and on return from a hidden tab. Thus it
replaces the old count read rather than adding another read. The per-card
counts remain room-specific; the switcher now shows unique people per type.
An incrementing generation ref discards stale overlapping count responses.
No identity data is exposed to the browser. Room list, auth and admission
flows are unchanged.

`src/lib/roomMusicPresence.ts` now sets `config.presence.enabled=true`
on the shared-music advertiser. The installed `realtime-js` subscribes with
Presence disabled by default when a channel has no Presence event handler;
the previous explicit `false` prevented `track({playing:true})` from
publishing a usable signal. The advertiser still runs only
while a connected shared room soundtrack or tab audio is actually playing;
it cleans up on stop/unmount and retracks after reconnect. The existing
Sessions page channel and `SessionMusicIndicator` animation are unchanged.
`scripts/room-music-presence.test.mjs` now guards against disabling Presence
again. A live room with shared audio is still needed for end-to-end visual
confirmation; the read-only listing preview cannot start someone else's
music. No DB music writes or new music channels were added.

Validation: `node --experimental-strip-types --test
scripts/room-music-presence.test.mjs scripts/session-card-indicators.test.mjs`
passed 7/7, `npm run build` passed, `git diff --check` passed. Focused ESLint
has 29 pre-existing `SessionsPage.tsx` errors (`any` and unused state), with
no new warnings; `npm run typecheck` remains blocked by baseline TS6306/TS6310
project-reference configuration in `tsconfig.json` / `tsconfig.node.json`.

## 2026-10-04 — Type-colored OR slash and white Group LIVE label

`src/components/SessionRoomPolicyIndicator.tsx` renders camera/screen-share
requirements through `getSessionCardPolicyState` and the parent card's theme
palette (`color`/`background`). For the alternative camera-or-screen-share
rule, the visible `/` now uses `color` instead of hard-coded indigo and the
three elements sit in a 2px-gap sub-group. Its Inter 16px bold typography,
accessible group/icon labels and hover/focus tooltips remain unchanged.
Non-alternative camera/screen/chat indicators retain their old spacing.

`src/components/SessionTypeSwitcher.tsx` keeps Group LIVE's green background,
white 1px border, right-edge placement and positive-count visibility, but
renders its icon and label white like the Infinite badge. This is purely
presentational: attendance, counting, session policies, Realtime music, and
room behavior are unchanged. The source assets are the already-shipped camera,
screen-share and group SVG masks. The user's small indigo pill screenshot is
a spacing/color reference; it does not replace the existing type-themed pill.
Validation: focused indicator tests passed 2/2, focused component ESLint passed,
production Vite build passed, and the Group LIVE badge was visually checked in
the local `/sessions?tab=infinite` browser preview. No music code was changed.

## 2026-10-04 — Community attendance counts and temporary header visibility

`src/components/Header.tsx` no longer renders Hosts and Leaderboard links in
desktop or mobile navigation. The `/hosts` and `/leaderboard` routes in
`src/App.tsx`, page-to-page links, and their pages remain intact for direct
access while the community views are being refined.

The source of truth for lifetime **attended** sessions is
`profiles.attended_sessions_count`, maintained by the recount triggers in
`supabase/migrations/20260920161100_repair_infinite_daily_attendance_count.sql`.
That counter equals distinct regular sessions plus one
`infinite_room_daily_attendance` row per room/user/local day. The original
`community_user_leaderboard` RPC counted distinct `session_id` values from
`attendance_visit_history`, collapsing repeated infinite-room days. In
production on 2026-10-04, the same profile showed 608 canonical attended
sessions (407 regular + 201 infinite daily visits) but only 431 in the old
leaderboard. The new RPC ranks by the maintained profile count and keeps
`attendance_visit_history` for focus hours and last-seen timestamps. It also
includes people with a canonical count whose visits predate the history table.

`community_hosts` still measures **public sessions hosted**, not attendance;
these metrics are intentionally distinct. It excludes hidden/private/infinite
rooms as before. The new return column `attended_sessions` supplies the same
profile counter for host cards, which now label both numbers separately. The
RPC return shape change is transactional in
`supabase/migrations/20261003233259_align_community_session_counts.sql`; it
drops/recreates `community_hosts(integer)` after a production dependency check
showed no database dependents, then re-grants the same public RPC access.
No attendance rows or room behavior are changed. The header links can be
restored later without re-enabling any data collection.
The migration was applied to production under version `20261003233259`;
subsequent read-only checks showed both community RPCs and the profile counter
equal at the time of the query, while the public hosted-room count remained a
separate smaller metric. The active lifetime counter can change as attendance
records are edited/deleted, so example totals are observations, not fixtures.
The frontend still requires its normal Vercel deployment after the push.

## 2026-10-04 — Missing Music Panel vector artwork

`src/lib/roomSoundscapes.ts` is the single playlist catalog used by
`src/pages/livekit/RoomSoundscapePanel.tsx` for track labels, audio paths,
icons, durations, and the large illustrated player background. Brown Noise
and Downtown Flow previously reused `flow-relax.svg` and `ambient-focus.svg`
respectively. They now point to dedicated 480×150 SVG assets in
`public/images/room-music/`: `brown-noise.svg` (warm layered sound waves) and
`downtown-flow.svg` (muted city skyline and forward road). The assets follow
the existing pastel, simple-shape cover style and require no extra runtime
library or image download. The audio paths, playback engine, room music
sharing, playlist order, and track controls are unchanged. Browser checks
rendered both SVGs; `scripts/room-soundscape-artwork.test.mjs` guards unique,
available 480×150 artwork for every built-in track. Music regression tests
passed 6/6 and the production build passed. The three existing `no-empty`
lint errors in `roomSoundscapes.ts` are unrelated empty catch blocks.

## 2026-10-04 — Downtown Flow skyline refinement

`public/images/room-music/downtown-flow.svg` now uses a New York-inspired
Manhattan silhouette instead of the earlier generic two-sided streetscape:
layered buildings, two stepped/tapered towers with spires, a dusk sun and
subtle movement lines at street level. It keeps the same 480×150 viewBox,
rounded clipping, asset path and pastel palette. The playlist catalog and
audio playback are unchanged. The SVG was visually rendered in the local
browser before commit; the existing artwork regression test guards its path.

## 2026-10-04 — Personal dark theme for LiveKit room side panels

The active room route (`src/pages/RoomPageLiveKit.tsx`) owns the right-side
People, Chat, Tasks and Music tabs. The video canvas still uses the existing
independent `room_theme` preference. Side panels now use a second, personal
`RoomTheme` state, initialized as light for backwards compatibility and stored
under `mysession_room_side_panel_theme_v1` in browser `localStorage`. The
setting is not written to Supabase, room metadata, LiveKit or Realtime; one
participant cannot change another participant's view. Changing the toggle
updates the mounted panel without changing its key, cache or subscriptions.

`src/pages/livekit/RoomSettingsModalLiveKit.tsx` shows the single "Dark side
panels" ToggleRow first in Settings, above host-only policies and video layout.
`RoomPageLiveKit.tsx` passes the preference into the side-panel wrapper and
into ChatPanel, TasksPanel and RoomSoundscapePanel. The People tab has explicit
dark surfaces, text and inverted monochrome action icons. Music has explicit
dark artwork controls, playlist surfaces, icons and slider colors. Chat and
Tasks have theme-aware main controls and icons plus a scoped neutral-palette
remap in `src/pages/livekit/roomSidePanelTheme.css` for remaining legacy light
utilities. The remap applies only beneath the dark room side-panel Chat/Tasks
sections; bright status/action colors, avatars and music artwork are excluded.
PiP chat remains light, as it is outside the right-side panel.

Visual QA used a temporary local Vite fixture (removed before commit) with
the real ChatPanel, TasksPanel, RoomSoundscapePanel and Settings modal. Dark
and light desktop states, dark populated Chat/Tasks samples, the music panel
at 430px viewport, and toggle propagation to all four tabs were checked.
`scripts/room-side-panel-contrast.test.mjs` asserts WCAG AA 4.5:1 minimum for
the dark palette's key text/icon combinations. No Supabase query, policy,
schema or subscription changes were made for this feature.

## 2026-10-05 — Tasks panel PiP green and dark header icon regression

The production room route is `src/pages/RoomPageLiveKit.tsx`; its right-side
Tasks header uses `/icons/tasks-light.svg` for light theme and previously
requested `/icons/tasks-dark.svg` for dark theme. The latter file does not
exist in `public/icons`, so the browser renders a broken/empty icon. The
existing `/icons/tasks.svg` is the same Tasks target artwork filled white and
is suitable for the dark `#232323` header. Both production references in
RoomPageLiveKit now use `/icons/tasks.svg` in dark mode, including the shared
task icon for accountability wall. The stale
`src/components/RoomPageLiveKit.updated-chat-dm-dropdown.tsx` still contains
an old path; it is not the routed production room component and was not
modified in this focused patch.

`src/components/TasksPanel.tsx` renders the inner Tasks panel header. Its
video Picture-in-Picture control calls the existing
`onOpenPictureInPicture` callback supplied by RoomPageLiveKit. Commit
`9deb6ee` had recolored its border, translucent background, hover state,
text and icon mask tint from the Short Sprints green `#81DB86` to blue
`#5286F6` as part of a broad accent update. This patch restores `#81DB86`
only for that PiP button and its icon in both side-panel themes. The adjacent
Sync with Tasks button and all other blue accents remain untouched. No PiP,
LiveKit, Supabase, task data, or right-tab behavior changes are made.

`scripts/tasks-panel-visual-regression.test.mjs` guards the PiP green and
ensures the referenced Tasks icon assets exist with visible fills. Validate
with `node --test scripts/tasks-panel-visual-regression.test.mjs`,
`npx vite build`, and `git diff --check`. If future UI design changes the
markup, adjust the static regression test to assert the new intentional
contract rather than deleting it silently. A signed-in room screenshot in
both themes remains valuable but is not required to establish the missing
asset root cause. Commit and push to `main` after checking origin/main;
verify the remote SHA afterward. This context file is intentionally broad
so the next chat can resume without relying on conversation history.

## 2026-10-05 — Scheduled-room gate accents and stage tooltip placement

The screenshot in this task shows the booked/early-arrival screen for a
scheduled room. `src/components/JoinGateModal.tsx` renders this gate; the
production LiveKit room page supplies its current theme and navigation and
booking callbacks. Three green remnants were present on the dark/light gate:
the calendar icon, the disabled/confirmed “You're booked” CTA text, and the
“Browse sessions” link. A theme-aware blue `accentText` now colors only those
elements (`#2451AB` in light theme, `#AFC6FF` in dark theme), keeping handlers,
booking timing, text, border/background, and the existing MySession blue intact.
The green strokes on the user screenshot are not a reason to alter the room's
Short Sprints accent or the Tasks panel PiP green; those are separate contracts.

`src/components/SessionStageBar.tsx` is shared by the in-room
`src/components/RoomTopBar.tsx` and listing/detail
`src/components/SessionCard.tsx`. Its progress/stage identity logic is
unchanged. An optional `tooltipPlacement: "top" | "bottom"` prop defaults to
`"top"`, preserving card tooltips above the timeline. RoomTopBar passes
`tooltipPlacement="bottom"` at both desktop and mobile stage bar call sites,
putting stage name/duration below the room timeline. The tooltip arrow flips
with the placement. No video, media, LiveKit, Supabase, or session state
behavior changes were made.

`scripts/room-stage-tooltip-placement.test.mjs` guards the room/card placement
contract and the removal of the three green gate accents. Validate with
`node --test scripts/room-stage-tooltip-placement.test.mjs`, `npx vite build`,
and `git diff --check`. The implementation was also visually checked in a
temporary Vite fixture (removed afterward): desktop room tooltip below,
session-card tooltip above, light and dark join gates, and mobile room tooltip
below without clipping; browser errors were empty. The screenshot fixture is
not part of the production diff. `npm run typecheck` is blocked by the
repository's existing tsconfig project-reference configuration (TS6306/TS6310).
`npx tsc -p tsconfig.app.json --noEmit` also reports numerous pre-existing
app-wide diagnostics; a targeted check of the edited files found only an
unused React import in JoinGateModal, which was removed. Focused ESLint still
reports existing `no-explicit-any` errors in RoomTopBar and SessionStageBar;
these unrelated typing refactors were left untouched. This task was left local without a commit or
push in the implementation turn. The user subsequently requested commit and
push; `origin/main` was fetched and confirmed equal to the starting HEAD
`d9dbb7b` before staging. Stage only the five intentional task files, push the
new commit to `main`, and verify the remote SHA. No database migration is
required.

## 2026-10-05 — Pre-join redesign and room tooltip stacking fix

The production room imports `PreJoinModal` from
`src/pages/livekit/PreJoinModalLiveKit.tsx` (not the older
`src/components/PreJoinModal.tsx`). `src/pages/RoomPageLiveKit.tsx` owns
device enumeration, prepared preview tracks, video effect application,
join/cancel, audio gesture, and persistent media preferences, then passes
values and callbacks into this modal. Do not change LiveKit video behavior or
the pre-join preview track lifecycle during future visual revisions.

The pre-join now uses a clearer two-column desktop layout: large live camera
preview on the left with microphone/camera toggles directly below it, and
display name plus microphone/camera/speaker selection on the right. Speaker
test and device refresh stay visible. Audio processing and background effects
are native keyboard-accessible disclosures; all prior controls, callbacks,
presets, upload/reset/reapply, status and error text remain available. Presets
must stay available when FX mode is off: users need to choose an image before
the room's `applyPrejoinVideoFx("bg", url)` can succeed. Mobile collapses to
one column; the footer CTA remains visible. Both light and dark themes use
MySession blue `#5286F6` for active media toggles and the Join button, with
blue hover and icon/text colors instead of the old green tokens. The component
has dialog semantics and explicit labels for name and device selects.

The user screenshot of a room showed a stage tooltip being covered by the
video grid even though the tooltip itself had `z-[9999]`. `RoomTopBar` had an
isolated stacking context at auto z-index; the following video grid was
painted on top of it. Its root now has `relative isolate z-[60]`, while the
following grid in RoomPageLiveKit has `relative isolate z-0`. This elevates
the whole bar and its below-bar tooltip above videos/side panels without
raising it above fixed room UI overlays at z-80/90+. Keep the existing
`tooltipPlacement="bottom"` in both room bars and top default for session
cards. Do not solve this by increasing only the tooltip child's z-index.

`scripts/prejoin-and-stage-layering.test.mjs` guards the production import,
unique media toggles, blue hover contract, and stacking layers. Run it with
`scripts/room-stage-tooltip-placement.test.mjs`, then run Vite build and
`git diff --check`. The app-wide typecheck and component ESLint still have
pre-existing diagnostics described above; do not treat them as caused by
this layout change. `prejoin-preview.html` and `src/prejoin-preview.tsx` are
local-only Vite preview fixtures with mock devices and no real room join;
they are intentionally not included in the production commit. While the
local server is running, `/prejoin-preview.html` shows dark mode and
`?theme=light` shows light mode. Headless Chrome screenshots were used to
visually check both desktop themes and a 500px narrow view. The latest user
explicitly requested commit and push for the production fixes; fetch and
verify `origin/main` before pushing, and stage only production files, the
test, and this handoff. No schema or deployment secret changes are needed.

## Pre-join background choice follow-up (2026-10-05)

The user corrected the first interpretation: the four effect buttons must
be visible directly in the compact Background effects row, not hidden behind
the disclosure. The row now contains icon-and-label controls for No
backgrounds, Blur, Image, and Custom image. Clicking Off or Blur applies
immediately. Clicking Image opens built-in presets and applies the previously
selected preset or first available preset; clicking Custom opens the saved
slot grid and applies the selected/first saved slot if one exists. If no
custom image exists, the grid offers Upload without passing an empty URL to
the processor. Only the additional slider/preset/slot controls expand below
the row. The room preview/media lifecycle and join handlers are unchanged.

`PreJoinModalLiveKit.tsx` owns this presentation and accepts the existing
`customBackgroundSlots` state from `RoomPageLiveKit.tsx`. That page owns
`applyPrejoinVideoFx`, the 8 MB validation and FileReader conversion, and
the shared `setCustomBackgroundSlots` state. Its existing load/save effects
read and write three `CustomBackgroundSlot` entries to IndexedDB database
`mysession-room-backgrounds`, object store `settings`, key
`custom-background-slots-v1`. In-room background selection uses the same
state; do not create a parallel pre-join localStorage list. The icon assets
are copied unchanged from the user's SVGs into `public/icons/` as
`prejoin-background-{none,blur,image,custom}.svg`, rendered as currentColor
CSS masks for theme contrast. Mobile/tablet still hide background FX via
`hideBackgroundFx`; this change does not alter that policy.

Regression guard: `scripts/prejoin-and-stage-layering.test.mjs`. The local
preview fixture (untracked) accepts `?backgrounds=Custom%20image` to show
the expanded saved-slot state, but is not production code and must not be
staged. Source reference screenshot is the user-provided
`codex-clipboard-ab1509d5-f988-4d35-a7fd-1e986f04c010.png` and visual QA
details are in `design-qa.md`. Build passes; app-wide `npm run typecheck`
fails on existing tsconfig project-reference configuration and direct app
typecheck/lint have existing unrelated diagnostics. Check exact output before
attributing failures to this feature. No migration, Supabase write, email,
video capture policy or deployment environment change is required.

## Icon-only pre-join follow-up (2026-10-05)

The user requested no visible captions on the four Background effects
buttons and larger icons. Keep the order None, Blur, Image, Custom and keep
the row visible without opening a disclosure. `BackgroundChoiceIcon` now
renders the supplied SVG mask at 24×24 px inside 40×40 px buttons (44×44 on
desktop). The category names remain on `aria-label` and native `title` for
accessibility and hover, while the active state remains visible through the
blue button styling. The current effect status is screen-reader-only; errors
and selected effect controls still expand below the row. Clicking Custom
reveals the same three persisted local slots and applies a previously saved
image when one exists. Do not create a separate custom-image store.

The only production component changed in this follow-up is
`src/pages/livekit/PreJoinModalLiveKit.tsx`; the matching static regression
assertions are in `scripts/prejoin-and-stage-layering.test.mjs`. The prior
room callbacks, IndexedDB storage, image size limit, and media track behavior
remain unchanged. The untracked `prejoin-preview.html` and
`src/prejoin-preview.tsx` files are local preview fixtures and must not be
included in the commit. The user's request explicitly includes commit and
push to `main`; check `origin/main` before pushing, do not commit unrelated
generated sitemap XML files or local screenshots. No schema change is needed.

## Instant background-choice hover feedback (2026-10-05)

Follow-up to the icon-only pre-join design: the four `Background effects`
buttons now show an immediate custom tooltip on pointer hover and keyboard
focus-visible. At rest the row remains icons-only; each button retains its accessible
`aria-label` and active `aria-pressed` state. The delayed browser-native
`title` was removed. The tooltip shows the effect name, or the existing
blocked reason when video effects are unavailable, and has no animation
delay. Idle buttons also get an immediate blue hover treatment in light and
dark themes. Pointer clicks do not leave a focus-only tooltip behind after
the pointer moves away. This changes presentation only: click behavior, saved custom
image slots, media processing, camera lifecycle, and join flow are unchanged.

Production file: `src/pages/livekit/PreJoinModalLiveKit.tsx`; static regression
guard: `scripts/prejoin-and-stage-layering.test.mjs`. Local-only preview
fixture `src/prejoin-preview.tsx` accepts `?focus=Blur` to show the keyboard
tooltip during visual QA and remains untracked. Keep unrelated generated
sitemap XML files and preview screenshots out of the commit. The user added
instant hovers to the preceding pre-join task, which included commit and
push. The production build and five focused tests pass. App-wide typecheck
still fails on pre-existing tsconfig project references (TS6306/TS6310),
and direct lint reports 14 existing issues on unchanged lines of the
component. Dark- and light-theme preview screenshots with focused buttons
confirmed tooltip placement, contrast, and no clipping. Recheck remote
status before pushing this follow-up to `main`.

## Neutral pre-join shell, compact room controls, and long room titles (2026-10-05)

The production pre-join is `src/pages/livekit/PreJoinModalLiveKit.tsx`, mounted
only by `src/pages/RoomPageLiveKit.tsx` (not the older component in
`src/components/PreJoinModal.tsx`). Its previous redesign tinted the entire
surface navy/blue. This follow-up makes the modal follow the room's neutral
palette: light `#F3F1F1`, dark `#1B1B1B`, neutral gray cards/inputs/footer and
borders. Blue `#5286F6` remains for active/hover/focus states, camera/mic on
states, and Join. Background-effect behavior and media capture are unchanged.

The room shell is orchestrated by `RoomPageLiveKit.tsx`. It passes a
`bottomBarBg` surface to `src/pages/livekit/LiveKitBottomBar.tsx`, which wraps
`LiveKitBottomBarLegacy.tsx`. The visible bar layout is in the legacy file.
Its outer border, heavy shadow, rounded container and backdrop blur were
removed, but individual controls retain their 40px/44px hit targets. The
outer bar is now 60px mobile and 64px desktop, plus 4px and safe-area inset
at the bottom. The room content reserves 68px mobile/72px desktop, down from
80px/90px, so video tiles and side panels gain vertical space. Keep the
reserved room height in sync with the fixed bar height and safe-area padding.

`src/components/RoomTopBar.tsx` owns room-only session title and timeline
layout; session cards use a separate component. Long room titles are now
bounded to 280px on desktop and flex within the available header width at
smaller widths. A `ResizeObserver` measures actual ellipsis overflow and is
cleaned up; a resize listener is only a fallback. Only truncated titles show
a CSS-only, no-delay tooltip with the complete name on hover or keyboard
focus. Header wrappers use `min-w-0` to prevent intrinsic title width from
stretching the entire room; below the `lg` breakpoint, timer/host/theme
controls move to the existing second row, keeping the title and participant
badge inside the viewport. The top row has a raised stacking context so its
tooltip is above those controls and the timeline. This does not change stage
timing, media behavior, or room data flow.

The regression file is `scripts/prejoin-and-stage-layering.test.mjs`. A local
untracked `room-shell-preview.html`/`src/room-shell-preview.tsx` QA fixture
renders the real top/bottom controls with mock room data; do not stage it.
The pre-existing `prejoin-preview.html`/`src/prejoin-preview.tsx` remain local
QA fixtures. Source comparison is the user-provided room screenshot
`codex-clipboard-564fa91f-86a5-486d-9b4c-f331db11146f.png`; neutral modal
and long-title screenshots were checked at desktop and narrow widths. There
are no database, Supabase, LiveKit track, or deployment-configuration changes.
Preserve existing generated sitemap XML diffs and older untracked screenshots;
they are not part of this change. Commit/push only production files, test,
and this context document after verification.
