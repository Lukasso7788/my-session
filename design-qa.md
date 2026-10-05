# Previous design QA — My Tasks plus states

**Source visual truth**

- `C:\Users\misha\OneDrive\Рабочий стол\7700.png` — Tasks panel reference, 412 × 570 px, showing the default My Tasks plus control.
- User-specified hover state: container fill `#2F2F2F` and white plus icon.

**Implementation evidence**

- Local URL: `http://127.0.0.1:4173/`.
- Implementation screenshot: unavailable.
- Intended viewport/state: desktop Tasks drawer, default and pointer-hover states of the My Tasks plus.
- CSS viewport and device scale factor: unavailable because the in-app Browser process exited before opening the local app.
- Density normalization: not performed because no implementation capture was available.

**Full-view comparison evidence**

- Blocked. Two in-app Browser startup attempts ended with `trusted Node process exited unexpectedly`, so the rendered Tasks drawer could not be captured.

**Focused region comparison evidence**

- Blocked for the same reason. The 18 × 17 px control could not be captured in its default and hover states for side-by-side comparison.

**Findings**

- [P1] Browser-rendered visual evidence is missing.
  - Location: My Tasks heading action.
  - Evidence: production build succeeds, but browser capture fails before the room UI opens.
  - Impact: optical centering and hover rendering cannot be certified from pixels.
  - Fix: capture the default and hover states when the in-app Browser runtime is available.

**Required fidelity surfaces**

- Fonts and typography: no text glyph is used for the icon; the plus comes from the installed vector icon library.
- Spacing and layout rhythm: code retains the specified 18 × 17 px footprint and 8 px radius.
- Colors and visual tokens: default is white with one `#2F2F2F` border and a `#2F2F2F` plus; hover is `#2F2F2F` with a white plus.
- Image quality and asset fidelity: the standard plus is a vector library icon; no raster or handcrafted asset was introduced.
- Copy and content: accessible label remains `Add tasks from Tasks page`.

**Comparison history**

- Iteration 1: removed the filled default state and implemented the reference default/hover pair; production build passed, but browser capture remained unavailable.

**Implementation checklist**

- [x] Use a single outlined white control in the default state.
- [x] Keep the plus black in the default state.
- [x] Fill the container with `#2F2F2F` on hover.
- [x] Turn the plus white on hover.
- [ ] Capture both rendered states when browser automation is available.

**Follow-up polish**

- Recheck the 12 px plus icon's optical centering after a browser capture becomes available.

final result: blocked

---

# Session indicators — design QA

Status: passed for available read-only states; unobserved live states noted below.

Reference: `C:\Users\misha\OneDrive\Рабочий стол\7 Focus Hub — список комнат.png`
and `C:\Users\misha\OneDrive\Рабочий стол\session format switcher.png`.
Implementation preview: `C:\Users\misha\AppData\Local\Temp\mysession-session-indicators-1920.png`
and `C:\Users\misha\AppData\Local\Temp\mysession-switcher-live-1920.png`
at `http://127.0.0.1:4173/sessions` (1920×947, unauthenticated, read-only).
Mobile capture: `C:\Users\misha\AppData\Local\Temp\mysession-switcher-live-mobile.png`
at 375×812, with Group selected and Infinite still showing its live count.

1. Composition: policy pill sits immediately after the card title; LIVE pill
   overlaps the switcher's top edge as in the references. No other card layout
   was changed. The existing switcher remains compact rather than scaling to
   the large isolated reference crop.
2. Color: card policy pills reuse existing session badge palettes; group LIVE
   is green/dark, infinite LIVE is Pomodoro red/white, both with white 1px
   border. The observed Short Sprints camera pill is correctly green.
3. Iconography: camera and screen-share reuse bottom-control SVG shapes; no
   chat and music disc/notes use the three user-supplied SVGs. All icons have
   accessible context through pill/button labels.
4. Behavior: no policy gives no pill; 1–3 enabled policies yield 1–3 icons;
   zero live participants yields no LIVE badge. Existing live count data showed
   Infinite populated and Group empty, and only Infinite showed a badge.
5. Motion/responsiveness: disc rotation and two staggered fading note sprites
   run only when the live music badge is mounted. `prefers-reduced-motion`
   makes the disc static and hides notes. The existing mobile tab label rules
   remain unchanged. No new DB polling or video changes.

Remaining production check: a read-only preview could not demonstrate an
actually playing shared-music room or a card with all three policy flags. The
presence logic and cleanup are covered by focused tests; the exact live
multi-icon/music visual should be confirmed with a real room after deploy.

final result: passed for the observed desktop/mobile states; live music and
three-policy combinations are covered by logic tests but await production
visual confirmation.

---

# 2026-10-04 — OR badge separator visual QA

Source visual truth: `C:\Users\misha\OneDrive\Рабочий стол\or.png`
(158×52px indigo capsule) plus user specification: slash in Inter Bold 16,
indigo. The screenshot contains no slash; typography is specified in text.
Implementation screenshot:
`C:\Users\misha\AppData\Local\Temp\mysession-or-slash-20261004.png`
(375×812 CSS viewport, browser density 1). The actual component was rendered
temporarily in existing `/ui-playground`; the fixture was then removed.

Full-view comparison: the existing card pill remains rounded and compact;
no adjacent card UI changed. Focused region comparison: inside the pale
indigo pill the camera and screen-share icons remain flanking a visible `/`.
Browser computed typography/color: `Inter, system-ui, sans-serif`, `16px`,
`700`, `rgb(99, 102, 241)` (#6366F1). The reference's solid-indigo fill is
treated as a color cue; preserving the existing pale type-colored card pill
avoids an unrelated design change.

Fidelity surfaces: typography matches the explicit specification; spacing
and layout keep the existing capsule and icon rhythm; slash color is the
requested indigo; no image asset was replaced or degraded; the accessible
copy remains "Camera or screen share required" while visible copy is `/`.
No actionable P0/P1/P2 mismatch was found. The only prior iteration was the
8px `or` implementation, replaced with the 16px slash and recaptured.

final result: passed

---

# 2026-10-04 — LIVE corner placement and policy tooltips QA

Source: user's previous `session format switcher.png` and the follow-up
instruction to anchor LIVE at each button's upper-right edge; existing
session-card indicator design from `7 Focus Hub — список комнат.png`.
Implementation: `C:\Users\misha\AppData\Local\Temp\mysession-live-corner-tooltip-desktop.png`
at 1920×947 and `C:\Users\misha\AppData\Local\Temp\mysession-live-corner-mobile.png`
at 375×812 (CSS pixels, browser density 1), from local `/sessions` preview.

Full-view comparison: the red LIVE pill touches the right edge of the
Infinite button at both sizes. It remains inside the switcher and does not
hide the tab label/icon. Focused comparison: the camera-required tooltip
appears above its green icon without covering the card title. An icon
receiving keyboard focus shows its tooltip immediately (`display: block`).

Required fidelity surfaces: Inter typography and existing switcher sizes
are preserved; alignment changes only the pill anchor; prior green/red
tokens and 1px white LIVE border remain; no source icons or raster assets
changed; the three tooltip labels describe the specific rule, with
alternative camera/screen-share phrased accurately. No actionable P0/P1/P2
issue remains. These are the first captures after the requested change;
no visual rework iteration was needed.

final result: passed

---

# Pre-join background effects — design QA

Source visual truth: `C:\Users\misha\AppData\Local\Temp\codex-clipboard-ab1509d5-f988-4d35-a7fd-1e986f04c010.png` (user screenshot). It shows the existing dark pre-join modal with a compact Background effects row; the new four-button state was specified in conversation rather than depicted in the screenshot.

Implementation captures: `prejoin-background-final-qa.png` (default), `prejoin-background-inline-custom-qa.png` (Custom image expanded), `prejoin-background-light-qa.png` (light theme), and `prejoin-background-mobile-qa.png` (narrow view). Full-view side-by-side evidence: `prejoin-background-final-comparison-qa.png`. Focused region: the Background effects row and saved-slot grid in the desktop captures; no separate crop was needed because these controls are legible at the captured size.

Viewport and normalization: source 1919×944 pixels; final dark default captured with Chrome `--window-size=1919,945`, yielding 1919×944 pixels. The comparison placed both at original pixel density with no resize; mock preview lacks the source's real camera video, account name and device labels, so those content differences are excluded from this scoped comparison. Additional desktop states were captured at 1440×900 CSS pixels, and the narrow state at 500×900. Device scale factor is 1.

State: Background effects options visible immediately; only the extra controls for Blur, Image or Custom image appear after selection. The custom capture uses one mock saved slot; production slots are loaded from the room's IndexedDB store.

## Findings

No actionable P0/P1/P2 visual differences remain for the requested Background effects control. The revised row stays compact, matches the existing dark MySession modal style and keeps all four supplied icons and labels visible. The Image and Custom image areas expand below the row without covering the Join footer; the modal body scrolls. Light-theme icons and text remain legible, and the four controls fit the 500px layout without horizontal overflow.

Fonts/typography: existing Inter hierarchy remains; 11px compact button labels are readable in desktop and narrow captures. Spacing/layout: background row aligns with the preview card and adjacent setup panel; only selected effect details add height. Colors/tokens: existing blue active/focus treatment works in dark and light themes. Image/asset fidelity: the four user SVGs are reused unchanged as CSS masks, preserving source shapes with theme-appropriate foreground colors; the live camera in the source cannot be reproduced by the mock preview. Copy/content: requested labels are exactly No backgrounds, Blur, Image, Custom image.

Comparison history: The first implementation placed four buttons inside a collapsed disclosure. The user clarified they must be visible in the Background effects row; that P1 mismatch was fixed by moving them into the always-visible row. The final dark, light, custom-expanded and 500px captures above show the correction. No further visual fix was required.

Interaction checks: the local fixture selects Custom image, shows a saved thumbnail and selected state, and exposes upload/replace/clear controls. The real camera processor and IndexedDB persistence cannot be exercised by this mock capture; they are wired through the production room callbacks and require a manual authenticated room smoke test. No browser console inspection was available in this headless visual pass.

final result: passed

---

# Icon-only Background effects follow-up

Source: the user's follow-up request to remove visible button captions and enlarge the same four supplied SVGs. Rendered evidence: `prejoin-background-icon-only-qa.png` (default dark row) and `prejoin-background-icon-only-custom-qa.png` (Custom selected with saved slots expanded), both captured at 1440×900 in the local preview with device scale factor 1. The earlier screenshot is a previous iteration, not the final button treatment.

Findings: no P0/P1/P2 differences in the requested region. The four 24px vector icons remain in one compact row; the blue active treatment clearly identifies the selected effect. Captions are no longer rendered. Names remain available through button `aria-label` and hover `title`, while Custom reveals saved slots below. The modal footer stays visible and expanded content scrolls behind it. Inter typography, dark palette, spacing rhythm and unchanged camera mock are consistent with the preceding QA pass. No new image asset was introduced.

The local preview cannot prove actual camera processing or IndexedDB persistence; production keeps the established callbacks and store. No real-room visual or console check was performed in this pass.

final result: passed
