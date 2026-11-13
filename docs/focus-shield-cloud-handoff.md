# Focus Shield development handoff

Repository: Lukasso7788/my-session. Branch: codex/focus-shield-edit.
For the application architecture and operational context, see [MySession project context](my-session-project-context.md).

The Chrome MV3 extension lives in focusshield/extension. Its popup sends SAVE_LIST to the service worker, which stores policy in chrome.storage.local and syncs with the desktop companion. Load the directory as an unpacked extension in a test profile. The repository also tracks a downloadable zip in public/downloads.

The Electron desktop app lives in focusshield/desktop. Its renderer uses preload IPC to save lists through electron/main.cjs. Policy normalization and desktop/cloud synchronization live under electron/. Run node --test focusshield/desktop/test/*.test.cjs from the repository root.

Both clients provide a separate Edit action. The editor loads the selected list and saves with its original ID. Cancel edit exits update mode and leaves the current draft available as a new list. Chrome preserves desktop apps and exceptions when editing sites. Saving a list does not apply it to a running block.

Manual acceptance: create a list, edit the name and entries, save, reopen it, and verify there is one list with the updated entries. Check cancel and Load separately. Confirm that editing a cross-device list retains rules the editor does not expose. The downloadable zip is rebuilt from focusshield/extension with the same directory layout as before. Publishing the Chrome Web Store and Electron releases is a separate step.
