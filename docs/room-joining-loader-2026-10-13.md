# Joining room loader — 2026-10-13

Replaces the visible "Joining room…" text in the LiveKit video zone
(`RoomPageLiveKit.tsx`, the `roomReadyText` block) with
`src/components/RoomJoiningIndicator.tsx`. The display condition
(`connected` / `prejoinOpen` / `joinRequested`) and the error surface are
unchanged; no join, reconnect, token or media code was touched. While an
in-place connect retry runs, its "The connection is slow. Trying again…" text
is shown as a caption under the loader.

## Design

- Dots + word, chosen by the owner from a Pinterest loader-icon sheet (first
  row, fifth from the left): every 0.5s two outer dots close in on a small
  middle dot, absorb it, touch, and spring back while it reappears.
- Geometry comes from frame measurements of that reference (30 fps).
- Next to it a 16px "Loading" word; a soft dimming wave runs across the letters.
- Flat colours only: `#FFFFFF` on the dark room, `#2F2F2F` on the light room.
  No gradients or shadows. Dots icon is 20x10px so the dots read at the weight
  of 16px text.
- Earlier tries the owner turned down: four-portrait room scene, ring spinner,
  logo wave, sliding tiles, a 48px ripple (third row, second from the left).

## Implementation

- Three `<circle>`s; the outer ones animate `cx`, the middle one `r`, with SMIL
  (`dur=0.5s`, spline easing), shared `KEY_TIMES`.
- `role="status"` / `aria-live="polite"` with the label kept screen-reader only;
  the dots and the visible word are `aria-hidden`.
- `prefers-reduced-motion: reduce` swaps to still dots and a still word.

## Verification

Preview: `tests/browser/room-joining.html` (`?theme=light` for light).
Tests: `node --test tests/roomJoiningIndicator.test.mjs`.
