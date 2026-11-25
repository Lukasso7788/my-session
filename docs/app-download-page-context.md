# MySession app download page — 2026-11-25

User explicitly requested a dedicated app download page, with the header announcement and avatar-dropdown app tiles always navigating there instead of starting a direct installer download. Commit/push to main authorized.

Working checkout C:/projects/mysession-chat-reply, branch codex/app-download-page, base origin/main 82022b85af4f53cfc54a649ea91ba779adf1ed1b. Separate Desktop local-AI changes and original dirty music worktree remain untouched.

Project: React 18/Vite/TypeScript, React Router; AppLayout provides Header/Outlet/Footer, Supabase manages accounts/data and LiveKit handles room media. This change is public navigation/content only; no auth, billing, database, API, release feed or desktop runtime changes. src/App.tsx lazy-loads DownloadAppPage under AppLayout at /download-app, accessible without sign-in. Header uses shared APP_DOWNLOAD_PAGE_PATH for both desktop/mobile avatar app tiles and the under-header notice; menu-close callback remains. Android tile links to the page's Android section, which honestly states it is in development. Hide the announcement on the destination page to avoid a self-referential download banner.

src/lib/appDownloads.ts is the single published Windows installer metadata source. Verified GitHub release tag desktop-latest via official API: MySession-Setup-0.4.5.exe exists, size121670439 bytes (~116 MiB). The previously built local 0.5.0 installer has NOT been uploaded/published, so do not link it or claim local AI is shipped in the public release. Update the manifest only after an actual release upload. No model download or executable is started by visiting /download-app; only the explicit “Download for Windows” link starts the existing GitHub-hosted installer download.

Page includes Windows version/platform/size, existing-account guidance, install steps, Android availability, browser fallback, keyboard focus styles and responsive cards. Published route uses the existing Vercel SPA fallback; no routing configuration mutation required. Stage files by name, fetch main before push, and verify remote SHA. Git push is distinct from verified Vercel production publication.

## Verification

Vite production build passed. Browser inspection of the actual /download-app route confirmed page title, Windows metadata, Android status and download CTA. Browser navigation /sessions → header “Download app” returned to /download-app without starting a download; the header notice is hidden on the destination. The avatar menus share AppDownloadOptions, so both use the same new route and close callback. No live account, auth settings or release assets were modified.
