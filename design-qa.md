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
