# MySession Desktop for Windows

## Current state

The 0.1.0 prototype lives in C:/projects/mysession-desktop/desktop on branch codex/mysession-desktop, created from origin/main at 1cb07dc. The desktop package is independent of the root npm package. Changes live in this worktree. The installed Focus Shield and the main MySession working copy use separate directories and profiles.

## MySession system

- The production site is https://mysession.club. The React and Vite frontend lives in the root src directory. The router and page components own the public sessions directory, login, account and room flows. Start with src/App.tsx, src/pages and src/components when tracing a website behavior.
- Supabase supplies identity and application data. The client and auth callback helpers are in src/lib and the identity provider is in src/context. Database changes belong under supabase/migrations. The website calls server endpoints under api for privileged operations, including billing and room credentials.
- MySession rooms use LiveKit for realtime audio and video. The room component in src/pages/RoomPageLiveKit.tsx owns meeting UI and browser capability handling. Tokens and administrative LiveKit operations belong on the server. Stripe subscriptions and entitlement updates follow the existing server billing paths. The desktop shell does not carry service or payment secrets.
- The standalone Focus Shield local Windows source is C:/projects/my-session/.local-focusshield/focusshield/desktop. Its FOCUS-COACH-HANDOFF.md describes local task coaching, Windows audio, window capture, the localhost LM Studio integration and build lineage. Keep that native functionality in a trusted desktop process if it is integrated later.

## Desktop implementation

main.cjs creates one sandboxed Electron window with a dedicated persistent Chromium partition. It loads the production sessions page, so the web deployment supplies the current screens without a desktop rebuild. Remote web content has no preload, Node integration or desktop IPC. Navigation is restricted to the two HTTPS MySession origins. Camera and microphone requests from a top-level MySession page have an explicit native prompt. The media grant is in memory for that window. Screen sharing and provider login are outside this prototype. The native menu can open the MySession website in the system browser.

The immediate dependency for real signed-in trials is a system-browser sign-in flow with a short-lived, single-use callback exchange bound to the desktop instance. Preserve the existing web sign-in path. Do not pass credentials in a deep link or copy browser storage into Electron. After auth, verify a room join with two real accounts, camera and microphone granting and denial, reconnect, and the screen-sharing picker before release. Local AI can be integrated later through a separately packaged trusted UI. Keep capture, model inference, local permissions and audio outside the remote renderer.

Run npm.cmd ci then npm.cmd run dist:win in the desktop directory. The x64 per-user NSIS artifact is dist/MySession-Setup-0.1.0.exe and the unpacked executable is dist/win-unpacked/MySession.exe. npm.cmd start runs the development shell. The package is a local prototype and has no public updater or configured signing certificate.

The unpacked Windows shell was tested against the live /sessions route with a temporary profile. The public room directory rendered, the page had no Node require, and the browser media API was present. Real device prompts and signed-in room flows remain for integration testing.

## 0.2.0 desktop continuation — 2026-11-19

The existing desktop shell is now packaged as 0.2.0 with an owned screen/window
picker, tray behavior, zoom controls, and wake protection during media playback.
main.cjs retains the production URL and sandboxed persistent browser partition.
screen-picker.cjs checks the requesting top-level MySession frame and a user
gesture before enumerating sources. A local modal loads picker.html, picker.js,
picker.css and picker-preload.cjs. Its IPC channel is specific to that window and
validates the sender and selected source. It returns a single chosen source.
Computer loopback audio is off by default and requires an explicit checkbox.
Closing the picker cancels the request. Closing the main window hides it to tray.
The tray and native menu provide explicit Quit, which terminates the process.

The unpacked development app was run with an isolated temporary user-data path.
The production sessions page rendered with media and display-media APIs present
and no renderer require. This does not verify room membership, Google auth,
actual mic/camera or remote screen-share reception. Account/password login uses
the existing live website form. Provider OAuth still requires a system-browser
callback integration and remains a product limitation in this build.
Signing and automatic app updates require release configuration.

Source is C:/projects/mysession-desktop/desktop, an independent npm package in
the MySession worktree codex/mysession-desktop. It loads the current production
frontend, so website deployments update the experience. Native shell changes
require rebuilding the installer. The root site code is older in this worktree;
use C:/projects/mysession-chat-radius to inspect current main source. The shell
does not package that stale frontend. The current desktop source is uncommitted.

Installer: dist/MySession-Setup-0.2.0.exe
Run npm ci, npm run dist:win in desktop. smoke-local.cjs exercises the production
page with a temporary profile when launched with Electron. The installed Focus
Shield repository is a separate product and uses different application IDs and
user data. Future native AI needs a trusted local process and deliberate IPC.

## 0.2.1 · Native context menu

context-menu.cjs attaches Electron's context-menu event to the main website
window. It builds Refresh and Refresh without cache, Back and Forward with
live history availability, contextual Undo/Redo/Cut/Copy/Paste/Select All for
editable fields, selection copying, safe HTTP(S) link copying and opening in
the system browser, zoom controls and fullscreen. Clipboard access lives in
the main process and requires selecting a menu action. Remote web content
keeps its existing sandboxed renderer.

The module is included in package.build.files. The main window now applies
its dark background and auto-hidden application menu at construction. Those
two properties had been misplaced in the earlier load-error dialog options.

Verified action dispatch, disabled history/edit state and unsafe link filtering
with a simulated Electron menu. Syntax checks pass. The existing running
unpacked app locked the default build output, so the new installer is built
in dist-0.2.1/MySession-Setup-0.2.1.exe. Build with
npm run dist:win -- --config.directories.output=dist-0.2.1.
Run the installer to update the local app. Previous live room and OAuth
verification limitations still apply.

## 0.3.0 · Desktop updates

updater.cjs owns electron-updater 6.8.9 and a local child BrowserWindow banner.
The remote MySession renderer gets no updater preload or IPC access. The local
banner alone can request the download and restart, validated by webContents.
The app checks ten seconds after startup and every fifteen minutes, with a
manual native-menu check. It shows Click to update for a released version and
Restart to update after the verified download. Installation is explicitly
requested. PrepareQuit bypasses the tray-close handler for the restart.

The update feed is the public desktop-latest GitHub release under
Lukasso7788/my-session. .github/workflows/desktop-release.yml builds Windows
on main changes to desktop files. Versions are 0.3.GITHUB_RUN_NUMBER so each
run produces a newer installer. It publishes latest.yml, EXE and blockmap.
Website deployment is separate from native desktop updates.

Canonical committed source is now the desktop directory in my-session/main.
C:/projects/mysession-desktop/desktop is the local build source and
C:/projects/mysession-desktop-release is the clean publication checkout.
The latter avoided corrupted checkpoint refs in the former parent worktree.
The first manual installer is dist-0.3.0/MySession-Setup-0.3.0.exe. Once that
is installed, the app can consume future desktop-latest updates. Versions
0.2.0 and 0.2.1 need this one manual upgrade.
