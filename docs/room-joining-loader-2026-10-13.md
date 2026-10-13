# Joining room loader — 2026-10-13

Replaces the visible "Joining room…" text in the LiveKit video zone
(`RoomPageLiveKit.tsx`, the `roomReadyText` block) with
`src/components/RoomJoiningIndicator.tsx`. The display condition
(`connected` / `prejoinOpen` / `joinRequested`) and the error surface are
unchanged; no join, reconnect, token or media code was touched.

## Design

- Ripple loader requested by the owner from a Pinterest reference (third row,
  second from the left of a loader-icon sheet): a centre dot swells into a disc,
  opens into a ring, the ring widens and thins out; a new ring every 0.5s.
- Geometry comes from frame measurements of that reference (30 fps). Ring
  radii and timing follow it; strokes are about two thirds of its weight at
  the owner's request.
- Flat brand colours only, matching the rest of MySession: `#F5F5F6` on the
  dark room, `#2F2F2F` on the light room. No gradients or shadows. 48px.
- Earlier rejected directions: four-portrait room scene, network bars, dots,
  bottom line, ring spinner, logo wave, sliding tiles.

## Implementation

- Two `<circle>`s animate `r` and `stroke-width` with SMIL (`dur=1s`, begins
  `0s` and `-0.5s`), keyTimes shared in `KEY_TIMES`.
- `role="status"` / `aria-live="polite"` with the label kept screen-reader only;
  the artwork is `aria-hidden`.
- `prefers-reduced-motion: reduce` swaps to a still ring.

## Verification

Preview: `tests/browser/room-joining.html` (`?theme=light` for light).
Tests: `node --test tests/roomJoiningIndicator.test.mjs`.
