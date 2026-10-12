# Room settings motion — 2026-10-12

## Project and checkout

Full architecture/continuation file: `docs/my-session-project-context.md`.
Worktree: `C:\projects\my-session\.codex-safe-billing-session-notice`.
Branch: `codex/billing-session-notice`. Base `c06901c` verified equal to
origin/main before release. User requested the same subtle motion as pre-join
for in-room settings, then commit and non-force push. Do not stage existing
generated sitemap EOL/timestamp changes, touch the old dirty root checkout,
merge the video-audit worktree or change memberships as part of this task.

## UI and data architecture

`RoomPageLiveKit.tsx` lazily imports `RoomSettingsModalLiveKit.tsx` and mounts it
when settingsOpen is true. The room owns device enumeration, capture, LiveKit
publication, layout preferences, room policies, sound preferences, image upload,
background processors and color correction. Existing handler props remain the
boundary: the modal is a controlled presentation layer plus its existing local
preview/sound-test helpers and queued/debounced effect application.

Only presentation changed. No new package dependency, API, migration, Supabase,
Stripe or production configuration. AST source comparison (normalizing Windows
EOLs) verified `VideoPreviewBox`, `SoundTestSection`, `safeApplyMode` and
`scheduleBlurChange` bodies unchanged from the base commit.

## Changed files and contracts

- `src/pages/livekit/RoomSettingsModalLiveKit.tsx`: all six SelectField controls
  (Layout preset, People columns, Focus rows, Microphone, Camera, Speakers) now
  reuse the existing `PreJoinDeviceSelect`; exact options, string/number adapters
  and async handler invocations remain. Labels use unique IDs, sliders are
  explicitly labelled and toggles have accessible names. Named dialog/header
  provide the existing shared dropdown's portal and positioning context.
- `src/pages/livekit/RoomSettingsMotion.tsx`: lazy RoomSettingsDisclosure wraps
  the existing animated/inert PreJoinDisclosure. Rarely used backgrounds,
  correction and preview controls do not mount/load until first opened. After
  that, content is retained for exit motion but inert while closed. Camera
  preview passes `track={previewOpen ? previewTrack : null}`, so close promptly
  detaches/removes its video element rather than retaining capture for an animation.
  SoundTestSection keeps its original always-mounted lifecycle inside a
  disclosure (native details previously also kept it mounted); no automatic test
  is started. Existing stopped/started test behavior is not rewritten.
- `src/pages/livekit/room-settings-motion.css`: scoped 160ms hover/focus/color/
  border/shadow/press feedback for all buttons, inputs, selects, textareas and
  upload; 200ms switch thumb; shared 160ms dropdown/200ms chevron/220ms disclosure.
  Sliders respond immediately: never transition position, value or fill width.
  Preserve 40px settings select height, room surfaces and 16px chevron inset.
  Card/guide/section entry uses opacity only, because transformed ancestors break
  fixed portal coordinates. Closed disclosures add no space-y gaps. Reduced
  motion disables scoped motion and makes settings navigation scroll instantly.
- `tests/browser/room-settings-motion.html` / `.tsx`: actual production settings
  with synthetic device options and controlled local state; mock preview track
  attach/detach counters, no media stream, no permission request, no server calls.
  Sound test controls are real, so do not click Start mic test unless explicitly
  testing hardware permissions. HMR unmount cleanup prevents duplicate roots.
- `tests/roomSettingsMotion.test.mjs`: seven regressions for syntax, six menu
  contracts, immediate preview cleanup, lazy/inert disclosures, scoped/reduced
  motion, accessible controls and preservation of supplied icons.

Pre-join presenter/CSS and its existing behavior are not edited. Reuse is
intentional, avoiding a second keyboard/navigation implementation.

## Local verification

Run dev server in this worktree: `npm.cmd run dev -- --host 127.0.0.1 --port
4203 --strictPort`. Open `http://127.0.0.1:4203/tests/browser/room-settings-motion.html`;
append `?theme=light` for light theme. The fixture calls parent callbacks locally,
not a live room. It is dev-only, not a new production route.

Verified in browser:

- Dark desktop and light desktop screenshot inspection: existing room palettes
  and icons retained; lists/readable text and blue focus feedback visible.
- Six selectors: pointer/keyboard chose layout `three`, columns 6, rows 1,
  microphone mic-2, camera cam-2, output sp-1; parent state confirmed each value.
- Escape closed output list without closing settings. Noise suppression toggled
  false; keyboard ArrowLeft changed stage volume 100 → 99 immediately. Computed
  control transition duration 160ms, chevron inset 16px and sound disclosure 220ms.
- Sound test opened/closed without starting capture; closed section inert.
- Mock camera preview counters 0/0 → 1/0 on open → 1/1 on close; closed preview
  inert and zero video elements. Color correction enabled, Brightness 100 → 101;
  Blur and Background image modes revealed the relevant controls.
- Actual 320px CSS viewport: document width 320px, no horizontal overflow. Speaker
  list bounded horizontally (~28–287px) and below header; keyboard names retained.
  Viewport reset and earlier pre-join preview restored after testing.

Checks:

```
node --test --test-reporter=spec tests/roomSettingsMotion.test.mjs tests/prejoinMenus.test.mjs tests/headerPlanBadge.test.mjs tests/billingSessionNotice.test.mjs
node scripts/check-billing-types.mjs
npm.cmd run build
npm.cmd run typecheck
npx.cmd eslint src/pages/livekit/RoomSettingsMotion.tsx
```

39 tests passed. Full production/SEO build passed. TypeScript comparison against
HEAD: 44 existing errors, 44 current, zero introduced. Repository typecheck
remains blocked by old TS6306/TS6310 project references. Modal ESLint still has
the same 18 pre-existing empty-catch/unused-isDesktopFx errors as the base
(verified from git-show stdin); new helper lint passed. Fixture has only the
usual non-exported React entrypoint Fast Refresh warning. Do not modify media
logic or repository configs just to hide those unrelated baselines.

Push does not prove production deployment. No manual deployment promotion here.
