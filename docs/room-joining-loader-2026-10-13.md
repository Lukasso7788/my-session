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
  row, fifth from the left): every 0.5s two dots swap places. The one moving
  right passes in front at full size; the other passes behind, shrinking to
  ~78% and dimming to ~0.72. Both hesitate before and after they cross, then
  snap past each other. A small dim middle dot hides under the front dot.
- Every value is tracked from the reference frame by frame (30 fps, 15 frames
  per loop, linear between frames).
- Next to it a 16px "Loading" word in the full ink colour; a softer band of the
  same ink sweeps across it (shimmer, 1.8s). The only gradient in the loader.
- Flat colours only: `#FFFFFF` on the dark room, `#2F2F2F` on the light room.
  No gradients or shadows. Dots icon is 20x10px so the dots read at the weight
  of 16px text.
- Earlier tries the owner turned down: four-portrait room scene, ring spinner,
  logo wave, sliding tiles, a 48px ripple (third row, second from the left).

## Implementation

- Three `<circle>`s painted back to front; SMIL animates `cx` (all), plus `r`
  and `opacity` of the back dot (`dur=0.5s`, 16 key frames).
- `role="status"` / `aria-live="polite"` with the label kept screen-reader only;
  the dots and the visible word are `aria-hidden`.
- `prefers-reduced-motion: reduce` swaps to still dots and a still word.

## Verification

Preview: `tests/browser/room-joining.html` (`?theme=light` for light). Since
2026-10-13 the joining screen is `RoomJoiningTip` (a productivity tip from
`src/data/productivityTips.ts` above this loader).
Tests: `node --test tests/roomJoiningIndicator.test.mjs tests/productivityTips.test.mjs`.
