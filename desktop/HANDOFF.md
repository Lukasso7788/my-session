# MySession Desktop for Windows

## Current state — sign-in stays inside the desktop app (2026-11-19)

Source of truth for this work is `main` at `d5402825fea41a702349afd6af1410c443ef682f` (“Add MySession Desktop with GitHub release updates”), plus the in-app login change on this branch. The published GitHub Actions run `44457729224` built `MySession-Setup-0.3.1.exe`, its blockmap, and `latest.yml` on `desktop-latest`. That installer still sends provider sign-in out of the app. electron-updater 6.8.9 from a 0.3.0 install found and checksum-verified 0.3.1; installation and restart were still unverified. The next `desktop-release` run after this change is on `main` publishes a newer `0.3.<run>` installer.

The sections below this one are the earlier handoff history, from the 0.1.0 prototype through the 0.3.0 updater. Where they disagree with this section, this section wins. In particular, do not send login or registration to the system browser.

### What the desktop is

`desktop/` is its own npm package. It does not import the root React app and it does not bundle the website. `main.cjs` opens one sandboxed Electron window on the persistent partition `persist:mysession`, with Node integration off, context isolation on, and no preload for the remote page. The window loads `https://mysession.club/sessions`. `https://mysession.club` and `https://www.mysession.club` are the only remote origins allowed in the main window. Website deploys change the screens. Native shell changes require a new Windows installer.

Already in the 0.3.0 shell, and left in place:

- Camera and microphone use Electron’s permission request and an in-memory grant for that window. The prompt is native. Denial stays denial.
- `screen-picker.cjs` serves the display-media request from a local modal. The remote page never receives the source list or an IPC channel.
- `context-menu.cjs` adds Refresh, refresh without cache, history, edit actions, safe link copy/open, zoom, and fullscreen. Clipboard access stays in the main process.
- Closing the window hides it to the tray. Quit is explicit from the tray or the menu. `before-quit` sets `quitting`, so the hide handler does not swallow the real quit.
- `updater.cjs` owns electron-updater 6.8.9 and a local banner window. The remote page has no updater preload. “Restart to update” calls `prepareQuit()` before `quitAndInstall`, which sets `quitting` first.
- `.github/workflows/desktop-release.yml` builds Windows on changes under `desktop/` on `main` and uploads `latest.yml`, the NSIS exe, and the blockmap to the `desktop-latest` release. The feed URL is `https://github.com/Lukasso7788/my-session/releases/download/desktop-latest/`.

### Login and registration

Email and password login, and account registration, are the existing website forms. They stay in the main window. The app menu and the tray both have Log in and Create account. Those commands call `accountUrl` and load `/login` or `/register` on the MySession origin already open in the window (`www` stays on `www`; an unexpected origin falls back to `https://mysession.club`). They do not call `shell.openExternal`. The website header buttons that navigate to `/login` and `/register` are same-origin, so they also stay in the window. The website routes themselves are unchanged.

Google, Discord, and Facebook still start through the website’s `startOAuthRedirect`. That navigation leaves MySession for Supabase and the provider. The shell used to cancel it and offer the system browser, which left the desktop partition signed out. The shell now opens that provider URL in a modal BrowserWindow owned by the app:

- The modal uses the same `persist:mysession` partition, so the PKCE verifier stored by the main window is the one that completes `/auth/callback`. No browser profile is copied and no session token is put in a deep link.
- Its user agent is `AUTH_WINDOW_USER_AGENT`, a Chrome string without `Electron`, because Google rejects the default Electron identifier. The main window’s identity is unchanged.
- `authWindowDecision` allows MySession URLs and the Google, Discord, Facebook, and Supabase authorize hosts. Every other URL in the modal is blocked.
- When the provider returns to a MySession URL, the modal closes and the main window loads that URL. The normal website callback then stores the session in the shared partition.
- A second navigation to the same provider URL within 1.5 seconds focuses the modal instead of opening another one.
- Closing the main window closes the modal. Hiding the main window to the tray does not sign the user out.

Links that are neither MySession nor a sign-in provider still use the existing dialog. That dialog opens the sessions page in the system browser only when the person explicitly chooses it. It is not the login path.

No new server secret, database table, or website route is required. Provider configuration stays the existing Supabase `/auth/v1/callback`. The desktop package still must not contain the service role key.

### Checks

Done on Linux, without a Windows install or a second account:

- `node --check` on `main.cjs` and `oauth-protocol.cjs`.
- `node --test desktop/oauth-protocol.test.mjs`: login and register URLs stay on the current MySession origin, provider URLs are classified for the in-app window, other sites are blocked, and the auth-window user agent does not contain Electron.

Still required on Windows with the rebuilt installer, two real accounts, and the live site:

- Menu and tray Log in and Create account open `/login` and `/register` inside the app and do not open Chrome or Edge.
- Email/password login and registration complete in the main window.
- Google sign-in opens the modal, returns to the main window already signed in, and does not open the system browser. Repeat for Discord and Facebook if those buttons stay on the form.
- If Google shows a “browser not secure” or `disallowed_useragent` page inside the modal, stop and report it. Do not paper over that by sending the person to the system browser.
- Two accounts join the same LiveKit room. Allow and deny camera. Allow and deny microphone. Share a window through the native picker and confirm the other account receives it. Disconnect the network and reconnect.
- Close the window and confirm it hides to the tray. Quit from the tray exits. “Restart to update” still sets `quitting` before the installer runs.
- The published 0.3.1 installer does not contain this behavior. Verify it on the installer built after this change reaches `main`.

### Commands

```text
node --test desktop/oauth-protocol.test.mjs

# Windows shell, from desktop/
npm ci
npm start
npm run dist:win
```

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

## Local continuation — 0.3.2 (Codex, 2026-11-19)
Owner requested development and repository management here, not in Cursor.
Active checkout C:/projects/mysession-desktop-release, branch codex/desktop-in-app-auth
starts from the existing PR #14 and adds local fixes. Older sections below/above
are historical where they conflict with this section.

Login and registration use production /login and /register inside the main
sandboxed window. Provider OAuth uses a sandboxed child window sharing
persist:mysession; its return to MySession navigates the main window. The allowed
Supabase authorization/callback host is now restricted to the actual production
project cxqgzcjsjyszcbcbdusp.supabase.co. The prior implementation blocked the
provider callback and accepted arbitrary Supabase hosts; both are corrected.
Removed the fixed Chrome user-agent override. Do not disguise Electron or bypass
provider restrictions: Google embedded-browser acceptance is NOT guaranteed.
Email/password login remains available inside the application.

Native app menu and tray now include Log out, with a confirmation that it leaves
any active room. logout.cjs unloads the remote page to about:blank first, closes
the provider window, clears this app partition's cookies/localstorage/IndexedDB/
service workers/cache storage and HTTP auth cache, then loads /login. Main-window
navigation permits about:blank only while this logout is in progress. This is a
local desktop sign-out, not server-wide token revocation, browser logout, or an
account change. Existing website signOut remains available in its profile menu.
No server keys, credentials, DB migrations or production authentication settings
were added/changed. Remote pages still have no Node or preload access.

Build: npm ci; node --test oauth-protocol.test.mjs logout.test.mjs (4 passing);
node --check main.cjs; npm run dist:win. Windows installer generated at
C:/projects/mysession-desktop-release/desktop/dist/MySession-Setup-0.3.2.exe.
Build is unsigned. Local installer started, waiting for Windows UAC approval.
Before update, registry reports all-users MySession 0.2.1 in C:/Program Files/MySession.
Observed real packaged 0.3.2 rendering the production login email/password form
and opening Google's identifier page in a child app window. No credentials were
entered: successful credential authentication, refresh persistence, authenticated
logout and post-login room/camera/microphone flow remain to be user-verified.
Installer registration/relaunch must still be checked after UAC approval.
This version was built locally; no merge to main or GitHub release claimed.
