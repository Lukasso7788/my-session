# Focus Shield development handoff

Repository: Lukasso7788/my-session. Branch: codex/focus-shield-edit.
For the application architecture and operational context, see [MySession project context](my-session-project-context.md).

This branch targets the Windows Electron app. The Chrome extension and its downloadable archive match the base revision.

The Electron desktop app lives in focusshield/desktop. Its renderer uses preload IPC to save lists through electron/main.cjs. Policy normalization and desktop/cloud synchronization live under electron/. Run node --test focusshield/desktop/test/*.test.cjs from the repository root.

The Windows app provides a separate Edit action. The editor loads the selected list and saves with its original ID. Cancel edit exits update mode and leaves the current draft available as a new list. Saving a list does not apply it to a running block.

Manual acceptance: create a list, edit the name and entries, save, reopen it, and verify there is one list with the updated entries. Check cancel and loading separately. Confirm that editing a cross-device list retains website exceptions. Run npm ci and npm run dist:win in focusshield/desktop to build the Windows installer.
