# Design QA — Tasks import popup

**Source visual truth**

- `C:\Users\misha\AppData\Local\Temp\codex-clipboard-62a2952d-3b24-4255-bfff-baa177754a2f.png` — current desktop popup state, 1920 × 946 px.
- `C:\Users\misha\AppData\Local\Temp\codex-clipboard-d70996b0-15c8-43cf-ac52-e385d08488a2.png` — Figma container specification, 1229 × 997 px.
- `C:\Users\misha\AppData\Local\Temp\codex-clipboard-13f5efe3-0b6a-4da4-9d75-7dd333de8821.png` — Figma plus typography specification, 1228 × 995 px.

**Implementation evidence**

- Local URL: `http://127.0.0.1:4173/`.
- Implementation screenshot: unavailable.
- Intended viewport/state: desktop room, Tasks drawer open, Tasks import popup open; search checked collapsed, hovered/expanded, focused, and filtering.
- CSS viewport and device scale factor: unavailable because the browser did not start.
- Density normalization: not performed because no implementation capture was available.

**Full-view comparison evidence**

- Blocked. The Codex in-app Browser failed during startup with a Windows sandbox ACL error before opening the local app.
- The fallback `agent-browser` executable was unavailable, and its temporary installation failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

**Focused region comparison evidence**

- Blocked for the same reason. The My Tasks plus and task-list/search row could not be captured in their interactive states.

**Findings**

- [P1] Browser-rendered visual and interaction evidence is missing.
  - Location: My Tasks plus and Tasks import popup.
  - Evidence: production build succeeds, but no browser screenshot or interaction capture could be produced.
  - Impact: exact alignment, hover expansion, focus behavior, and Figma-level optical centering cannot be certified visually in this environment.
  - Fix: rerun the desktop room flow after the in-app Browser ACL issue is resolved, capture collapsed/hovered/focused states, and compare them with the three source screenshots.

**Required fidelity surfaces**

- Fonts and typography: code specifies Inter Bold 17 px for the text plus; visual confirmation blocked.
- Spacing and layout rhythm: code specifies an 18 × 17 px plus container with 2 px padding, 8 px radius, and 1 px border; visual confirmation blocked.
- Colors and visual tokens: code specifies white fill and `#2F2F2F` border; visual confirmation blocked.
- Image quality and asset fidelity: no new raster or custom image assets are required for this change.
- Copy and content: `Save current todo list` is removed; `Attach`/`Attached` are changed to `+ Add`/`Added`; build verification passed.

**Comparison history**

- Iteration 1: implementation completed and production build passed; browser capture failed before comparison, so no evidence-based visual fixes were made.

**Implementation checklist**

- [x] Remove Save current todo list.
- [x] Put task-list selector and compact search in one row.
- [x] Expand search on hover and focus it on click.
- [x] Replace Attach with + Add.
- [x] Apply the provided Figma dimensions and typography to the My Tasks plus.
- [ ] Capture and compare the rendered interactive states when browser automation is available.

**Follow-up polish**

- Recheck the plus glyph's optical vertical centering in the actual Inter webfont after capture becomes available.

final result: blocked
