# MySession — project architecture and continuation context

Updated: 2026-09-27. This is a project-wide navigation/architecture handoff based on
the checked-out source, not a claim that every module or production service was
audited. Never put secret values, tokens, user exports or private logs in this file.

## Checkout and safe working rules

- Repository: Lukasso7788/my-session. Deployment branch is main (not necessarily
  the remote default branch). Do not force-push or rewrite shared history.
- Active implementation checkout:
  C:\Users\misha\.codex\worktrees\monthly-attendance\my-session.
  Local branch: codex/session-milestone-tree-badges. Its name is historical; reuse
  it rather than create another checkout purely for naming.
- Base for this change: 6e8f04a1c158313bcaa27020b9c4cab5e55e8e0c, previously pushed
  to main. Earlier relevant commits: ab831cf (Tasks warm reopening), 68acc34
  (reliable chat names/avatars), b376843 (room performance).
- C:\projects\my-session is a different old/dirty checkout with nested work.
  Do not reset, delete or overwrite it. This active checkout is outside current
  writable roots, so commands/patches require approved filesystem escalation.
- User requests full project architectural/technical context in a file for every
  code task. Keep this file and feature-specific handoffs current and link them.

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
authorize against editable user_metadata. No schema changes in this indicator task.

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

## Current task: restore microphone indicator

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
Other candidate optimizations below remain design work, not shipped features.

## Optimization backlog (1–3 implemented above; remaining items are concepts)

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
   entries opportunistically on navigation/account change without constant polling.
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
12. Remaining bundle splitting: measure timeline editors, PiP/mobile recovery and
    room command grammar as optional modules. Several settings/FX/panels are already
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
