# Design QA — My Tasks plus states

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
