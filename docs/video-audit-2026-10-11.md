# Video audit — 2026-10-11

Read-only audit of camera capture, effects (blur / virtual background / colour correction), remote rendering, screen sharing, media policies, PiP and mobile video in the LiveKit room (`src/pages/RoomPageLiveKit.tsx` and `src/pages/livekit/*`). No video code was changed. Items fixed by the earlier room audit (`docs/room-disconnect-audit-2026-10-11.md`) are not repeated.

"Confirmed" means verified by reading the code (and, for LiveKit internals, `node_modules`). "Code reading" means found in code but not reproduced on a device.

## Production evidence (last 30 days, aggregates only)

| Signal | Count | People | Notes |
| --- | --- | --- | --- |
| `camera_start_attempt_failed` | 367 | 22 | NotAllowedError 225 (join 119, toggle 106), NotReadableError 97, NotFoundError 30. Bursts up to 25 failures per minute for one person. |
| `camera.start_failed.selected` / `default_constrained` / `default_unconstrained` | 80 / 77 / 75 | 22 / 19 / 19 | Almost every failure runs all three attempts, including permission denials. |
| `camera_track_ended` | 42 | 12 | Windows Chrome 29 (5 people). 24 of those fired with the tab hidden, 20 after more than a minute hidden. |
| `screen_share_failed` | 38 of 241 attempts | 17 | 31 are "Permission denied by user" (picker cancelled); 6 are "not allowed by the user agent or the platform" (5 macOS, where it usually means the system Screen Recording permission, and 1 Linux); 1 publish timeout during reconnect. |
| `room_join` | 1,379 | 114 | By browser and device (a person can appear in several rows): Chrome desktop 70, Edge 17, Chrome mobile 16, Chrome tablet 8, Safari 17 (desktop 5, mobile 7, tablet 5), Firefox 7. |
| Device tier inputs | — | — | About a third of desktop joiners report ≤4 CPU threads or ≤4 GB memory, i.e. the "weak" capture tier. |
| Rooms with `camera_required` | 2 | — | The 24/7 cameras-on room and the silent room. |

## High severity

### 1. Raw camera is published while blur or a virtual background is selected — confirmed
- The effect mode is restored from `localStorage` (`RoomPageLiveKit.tsx` 8661-8670), so it is usually already "blur" or "bg".
- Joining with the camera off and turning it on later goes through `toggleCam` → `enableLocalCameraWithRecovery` → `setCameraEnabled(true, options)` (12336, 15222), which creates and publishes a new track **without a processor**. `LocalTrackPublished` only rebuilds tiles (14461), and the effect that re-applies FX (17833-17868) does not depend on the camera, so it never runs for the new track. Others see the real room while the UI still says "Virtual background".
- Join fallback (when there is no prepared prejoin track): the camera is published first and FX is applied afterwards (14662-14709), so the raw image is visible until the model loads; if FX fails, it stays raw (`console.warn` only, 14624-14626, 14706-14708). Device switch has the same swallow (14109-14120).
- Muting and unmuting an existing publication is safe: LiveKit restarts the processor before `replaceTrack` (`livekit-client.esm.mjs` 18039-18058).
- Fix: pass the processor into the first publish (or publish only after `setProcessor` succeeds); if FX fails while a mode is selected, keep the camera off and show `fxError`.

### 2. A camera that dies in the background is not restored, and the warning is cleared — confirmed
- `bindLocalCameraEndedListener` sets `camOn=false` on an unexpected `ended` (12210-12238).
- On return, if the room is still connected, `markVisible` rebuilds tiles and **clears** `mediaWarning` without re-enabling the camera (12926-12942), although the hide handler stored the intended state in the lease (12908-12911).
- Production: 24 of 42 `camera_track_ended` fired with the tab hidden on Windows Chrome (screen lock on a break, or another app taking the camera).
- Fix: on visible, if the camera was intended on and the publication is missing, ended or muted, run `enableLocalCameraWithRecovery` once and keep a message if it fails.

### 3. Cameras-required rooms disconnect people for failures they did not choose — confirmed
- The policy effect watches only `camOn` (15286-15375): reminders at 20 s and 90 s, disconnect at 120 s. Any cause counts: an ended track (item 2), a failed enable (15268-15273, NotReadableError/NotAllowedError), or the host's "turn off camera" action (14493-14497).
- The removal notice always says "The host enabled cameras-only mode" (15324-15329), and the first reminder says "within two minutes of joining" even when the host enables the policy mid-session (15339-15340).
- Policy removals are not logged anywhere, so their frequency is unknown.
- Fix: start the removal timer only after an intentional camera-off; treat device and permission failures and host-forced off as "unable" (no auto-kick, clear copy); log `camera_policy_removed`.

### 4. The prejoin camera keeps running when prejoin is closed by a gate — confirmed
- `onJoinGate` closes prejoin for a closed session, a ban or a signed-out visitor (21111-21134) without `cleanupPrejoinPreparedVideoTrack()`. Cleanup only runs on Cancel, unmount, or while prejoin is open with video off (9953-9959, 14940, 21317). The camera light stays on with no preview.
- Fix: clean up on every non-join close of prejoin.

### 5. Everyone sees everyone mirrored by default — confirmed
- `previewMirrored` defaults to `true` (6724-6731) and is published as `cameraMirrored` in participant metadata (9241-9266). Remote tiles read it (13891-13894) and apply `scaleX(-1)` (`VideoTileLiveKitLegacy.tsx` 683-696). Text on shirts, books and whiteboards appears reversed to the room.
- Fix (product decision): keep mirroring as a self-view preference only; show remote cameras unmirrored.

## Camera reliability (medium)

### 6. Permission and missing-device errors are retried three times, every time — confirmed
- `enableLocalCameraWithRecovery` (12273-12397) always tries selected → default constrained → default unconstrained, with releases and settle delays between, even for NotAllowedError or NotFoundError where retrying cannot help. Each try logs two diagnostics. Production shows 225 NotAllowedError failures with bursts of up to 25 per minute.
- Fix: stop after the first NotAllowedError/SecurityError/NotFoundError and show specific guidance (site permission, no camera found).

**Why access is denied (checked 2026-10-11).**
- **Not in-app browsers.** None of the failures, room joins (115 people) or sign-ins in `auth.sessions` (116 people) in 30 days had an in-app browser or WebView user agent: Instagram, Facebook, TikTok, Telegram, LINE, LinkedIn, Snapchat, X, the Google app, Discord, Android `; wv)`, or iOS WebKit without `Safari/`.
- **The browser remembers a per-site decision:**
  - Chrome/Edge "Permission denied": 121 logged attempts, 8 people; one of them on 5 different days.
  - Safari/Firefox "The request is not allowed by the user agent or the platform…": 101 attempts, 4 people; one iPad user logged 63 in a day.
  - "Permission dismissed": 3.
  - OS-level "Permission denied by system": none.
- **Real scale.** 76 real tries (225 logged) from 12 of 115 active people.
- **Likely trigger.** Prejoin defaults to `videoEnabled: true` (6264-6266) and starts the preview as soon as it opens (9953-9969). The browser prompt therefore appears before the person has chosen to use the camera, and Chrome keeps a reflexive "Block" for the site until it is changed in site settings.
- **The message does not help.** NotAllowedError maps to "A camera or microphone permission step failed." (1295-1297), and Safari's technical message is shown as is. Nothing checks `navigator.permissions`.
- **Invisible failures.** Prejoin preview failures are not logged, so people who fail before joining don't appear in this data.
- **Fix:**
  - Ask for the camera only after a click in prejoin.
  - Check the permission state first and show per-browser steps when it is denied.
  - Log prejoin preview failures.

### 7. The app can open the camera twice — code reading, supported by data
- The bottom bar's private preview opens its own camera track; only the bottom-bar toggle stops it, while voice, PiP and policy-reminder "Camera on" call `toggleCam` directly (code reading).
- Join can race an in-flight prejoin FX init that recreates the prepared track (9796-9851, 14611-14649; code reading).
- Windows and Android usually allow one capture per camera, which matches 97 NotReadableError failures (Windows and macOS Chrome).
- Fix: one camera-operation lock; stop every private preview inside the enable path.

### 8. No lock around camera toggles — code reading
`toggleCam` (15182-15281) has no in-flight guard, so a double tap or a voice command plus a click can run two enables at once.

### 9. In-room camera switch ignores the low-power preset and has no lock — confirmed
`syncLiveVideoInput` stops and unpublishes the old track, then captures with the desktop tier preset (14090-14124) instead of the 320×180@8 mobile options used at join (12281-12287); tablets in the "normal" tier jump to 640×360@15.

## Video quality: why people look blurry or choppy

### 10. Low capture presets — confirmed, product trade-off
- Phones and tablets in `lowPowerMobileMode`: 320×180 at 8 fps, and simulcast off (12281-12287, 11741, 14263). Viewers get a single tiny layer.
- Desktop "weak" tier (≤4 threads or ≤4 GB; about a third of desktop joiners): 320×180 at 10 fps. Normal: 640×360 at 15. Strong: 960×540 at 24 (1838-1881).

### 11. Subscribers are capped at 640×360 in rooms with more than four people — confirmed
`setVideoDimensions` by room size (13359-13377) is a ceiling in LiveKit: adaptive stream may only choose something smaller (`livekit-client.esm.mjs` 25202-25210). A pinned or full-screen speaker in a 12-person room still arrives at 360p.

### 12. `pixelDensity: 1` — confirmed
`adaptiveStream: { pixelDensity: 1 }` (11736, 14258) requests layers by CSS pixels, so video is softer on HiDPI and Retina screens than the SDK default.

### 13. Screen shares are optimised for motion, not text — confirmed
- No `contentHint: "detail"` on screen video (the only hint is `"music"` for tab audio, 11138).
- Simulcast layers are 360p/15 and 720p/15 (146-149).
- Shares are not featured unless pinned (`setScreenSharePinned(false)` when shares appear, 18919/18929).
- The camera "fill" framing preference is also applied to screen tiles (18759 → `object-fit: cover`), cropping slides.
- The tablet manual path publishes with `simulcast: false` (17309-17313).

## Screen sharing bugs

### 14. Stopping a screen share kills shared tab music — confirmed
Tab music is published as `ScreenShareAudio` (11102-11206). `setScreenShareEnabled(false)` unpublishes **any** `ScreenShareAudio` publication along with the share (`livekit-client.esm.mjs` 23739-23745).

### 15. A failed tablet publish leaves the capture running — confirmed
`publishManualTabletScreenShare` (17290-17333) stores `manualScreenShareRef` only after `publishTrack` succeeds. If publishing throws, the captured stream is never stopped and the browser's "sharing" indicator stays on.

### 16. The room tab can be shared into itself — confirmed
The screen-share path does not pass `selfBrowserSurface: "exclude"` (only tab music does, 11116-11118), so choosing the MySession tab creates an infinite mirror.

### 17. Shares are lost on controlled reconnect or page reload — code reading
Controlled reconnect (`connectRoom({ forceReconnect })`) and same-tab resume restore camera and microphone only. In screen-share-required rooms the 2-minute policy then applies again without a clear "share again" prompt.

### 18. Smaller screen-share issues — code reading
- The share button stays enabled on browsers without `getDisplayMedia`.
- The room soundtrack and tab music can play at the same time.
- When `suppressLocalAudioPlayback` is unsupported, the presenter hears tab audio locally.
- For the macOS system-permission failure the message does not mention System Settings → Screen Recording.

## Background effects (blur, virtual background, colour correction)

### 19. Effects freeze for others when Safari or Firefox users switch tabs — confirmed
`@livekit/track-processors` uses insertable streams only when window-level `MediaStreamTrackProcessor` and `MediaStreamTrackGenerator` exist (Chromium). Otherwise it falls back to a `requestAnimationFrame` render loop (`node_modules/@livekit/track-processors/src/ProcessorWrapper.ts` 44-48, 115, 247-357). `requestAnimationFrame` stops in hidden tabs, so outgoing video with an effect freezes, which is common in body-doubling sessions. About 17 Safari and 7 Firefox users joined in 30 days.

### 20. Segmentation blocks the main thread on every frame — confirmed
`segmentForVideo` is synchronous; the library itself notes it "blocks the event loop for tens to ~100 ms" (`BackgroundTransformer.ts` ~186-196). It runs per frame at capture resolution (up to 960×540 at 24 fps on strong desktops). Colour correction adds a full 2D pass before it (`PersonColorCorrectionProcessor.ts` 200-206). The result is UI jank in a large room page.

### 21. Effect assets come from third-party CDNs — confirmed
No `assetPaths` are passed, so WASM loads from cdn.jsdelivr.net and the model from storage.googleapis.com (`BackgroundTransformer.ts` 62-71). Slow or blocked networks delay or break the first effect apply, which combines badly with item 1. Each camera off→on restarts the processor (destroy and init).

### 22. Previews differ from what others see — code reading
- Settings preview applies the colour-correction CSS filter on top of the processed track (`RoomSettingsModalLiveKit.tsx` 1396, 449-452), so it looks stronger than what the room sees.
- The prejoin preview is never mirrored (`PreJoinModalLiveKit.tsx`).

## Rendering, PiP and mobile

### 23. Accountability wall keeps every video decoding — confirmed
The wall is an overlay on mounted video tiles (18765; `VideoTileLiveKitLegacy.tsx` 986-990). Adaptive stream ignores occlusion, so all cameras keep downloading behind it.

### 24. No pagination — code reading
All 20–30 camera tiles are mounted with a `<video>` and a per-tile `BarVisualizer` for unmuted mics (`VideoTileLiveKitLegacy.tsx` 257-337).

### 25. `pauseVideoInBackground: false` — confirmed, trade-off
Remote video keeps downloading while the tab is hidden (11736, 14258). It is needed for Document PiP, but it is also on when no PiP is open, which costs mobile data and battery.

### 26. PiP is advertised everywhere — confirmed
`pipSupported = typeof window !== "undefined"` (13337), so Safari and Firefox get a popup window instead of Picture-in-Picture.

### 27. Mobile layout issues — code reading
- The room shell (`h-[100dvh]`, 21408) has no top safe-area inset, so the top bar can sit under the iPhone notch.
- The chat overlay is not sized from `visualViewport`, so the keyboard may cover the input (hypothesis).

## Other

- **Microphone lock.** The token enforces `microphone_locked` server-side (`api/livekit/token.ts` 39-56, 473-481), but the mic button stays active (click → 403 error) and joining with the mic on shows a Firefox-specific hint (14748-14759). The client `isSilentRoom` heuristic (7017-7040) is broader than the server rule; production data is currently consistent.
- **Joining camera-required rooms.** People can join with the camera off, and the countdown starts right away.
- **Diagnostics.** `connection_diagnostics.details` for `camera.start_failed.*` has no error name, and policy removals are not logged.

## Checked and fine

- The happy-path join reuses the prejoin track.
- Leave stops local tracks (`room.disconnect()`).
- Intentional camera-off does not trigger the "ended" warning.
- Tile attach and detach are careful: iOS `playsInline`/`muted`/`autoplay` with play retries, stable keys, a memoised tile.
- The default framing is `contain`.
- Gallery Document PiP blanks the main stage instead of double-attaching.
- `dynacast` is on.
- Browser "Stop sharing" is handled on both share paths.
- Screen-share video is published without audio.
- FX operations are serialised per track, and background switches happen in place without a raw flash.

## Suggested order

1. Privacy and removals: item 1, item 4, item 3 (with item 2's auto-restore).
2. Visible to everyone: item 5 (mirror), item 14 (tab music), item 16 (self-share mirror), item 15 (capture leak).
3. Camera reliability: items 6-9.
4. Quality: items 10-13. These are trade-offs; decide targets first, e.g. 360p at 15 fps for phones with two simulcast layers, no 360p ceiling for pinned tiles, and `contentHint: "detail"` for shares.
5. Effects: item 19 (warn or disable effects on fallback browsers when hidden), items 20-22.
6. Rendering and PiP: items 23-27.
