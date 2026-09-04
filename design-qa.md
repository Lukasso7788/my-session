# Design QA — in-panel task picker

**Source visual truth**

- `C:\Users\misha\AppData\Local\Temp\codex-clipboard-4cfc439e-26de-410e-8447-3c47f47840a1.png` — Figma reference for the 18 × 17 px My Tasks plus control and its placement.
- `C:\Users\misha\AppData\Local\Temp\codex-clipboard-b119e296-2364-48a8-aaf6-8f1368ef4987.png` — current desktop task-picker state and content hierarchy.
- `C:\Users\misha\OneDrive\Рабочий стол\plus-symbol-button.svg` — supplied vector target; the referenced local file was no longer present when implementation started.

**Implementation evidence**

- Local URL: `http://127.0.0.1:4173/`.
- Implementation screenshot: unavailable.
- Intended viewport/state: authenticated desktop room, Tasks drawer open, then My Tasks plus clicked to show the in-panel `Add from Tasks` view; search checked collapsed, hovered, focused, and filtering.
- CSS viewport and device scale factor: unavailable because the requested Chrome browser surface did not start.
- Density normalization: not performed because no implementation capture was available.

**Full-view comparison evidence**

- Blocked. Chrome automation failed during startup with `windows sandbox failed: helper_unknown_error: apply deny-read ACLs`, before the local app could be opened.

**Focused region comparison evidence**

- Blocked for the same reason. The 18 × 17 px plus control, in-panel header, selector/search row, and scrollable task list could not be captured together in their interactive states.

**Findings**

- [P1] Browser-rendered visual and interaction evidence is missing.
  - Location: Tasks drawer, My Tasks plus, and in-panel Add from Tasks view.
  - Evidence: production build succeeds, but no browser screenshot or interaction capture could be produced.
  - Impact: exact optical alignment, hover expansion, focus behavior, and narrow-panel overflow cannot be certified visually.
  - Fix: rerun the authenticated desktop room flow when the Chrome automation ACL issue is resolved and compare collapsed, hovered, focused, and filtered states with the references.
- [P2] The supplied plus SVG could not be read from its referenced path.
  - Location: My Tasks heading action.
  - Evidence: the source path no longer exists on disk; the implementation uses the closest matching installed vector icon (`PlusCircle`) at the specified 18 × 17 px size.
  - Impact: the control is structurally faithful but exact path geometry cannot be certified against the supplied export.
  - Fix: replace the library icon with the supplied SVG when the file is attached at a readable path.

**Required fidelity surfaces**

- Fonts and typography: Inter remains the panel font; the picker title is 16 px semibold and descriptive copy is 11 px. Visual confirmation is blocked.
- Spacing and layout rhythm: the picker now occupies the panel rather than a centered overlay; header, selector/search row, and task list share the panel's 16 px rhythm. Visual confirmation is blocked.
- Colors and visual tokens: the implementation reuses the Tasks drawer's `#F3F1F1`, `#F7F5F5`, `#D8D0D0`, and `#2F2F2F` tokens. Visual confirmation is blocked.
- Image quality and asset fidelity: no raster assets were introduced. The supplied SVG path was unavailable, so a library vector fallback is used and recorded as P2.
- Copy and content: the top title is `Add from Tasks`; `Go to Tasks`, `Refresh`, the inner `Add from Tasks`, and `Task list` headings are removed; row actions remain `+ Add`/`Added`.

**Comparison history**

- Iteration 1: the task picker was moved into the Tasks drawer and production build passed; Chrome capture failed before visual comparison, so no evidence-based visual iteration could be completed.

**Implementation checklist**

- [x] Replace the centered overlay with an in-panel task-picker state.
- [x] Move `Add from Tasks` to the picker header.
- [x] Remove `Go to Tasks`, `Refresh`, and duplicated inner headings.
- [x] Keep list selection and compact expandable search in one row.
- [x] Use a real vector plus icon at 18 × 17 px rather than a text glyph.
- [ ] Replace the fallback icon with the exact supplied SVG when its file is available.
- [ ] Capture and compare the rendered interactive states when browser automation is available.

**Follow-up polish**

- Recheck the plus icon's optical centering and the expanded search width at the drawer's narrowest desktop width.

final result: blocked
