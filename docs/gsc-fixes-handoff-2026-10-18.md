# MySession Google indexing repairs — 18 October 2026

## Architecture and boundaries

Repository Lukasso7788/my-session. React 18, TypeScript, React Router, Vite SPA; Vercel serverless APIs under api/, Supabase authentication/database, LiveKit rooms and media, Plunk email and Cloudflare email scheduling. Billing/room/email logic is outside these changes. Main checkout is dirty; isolated worktree C:/projects/my-session/.codex-safe-gsc-oct18, branch codex/gsc-indexing-oct18, baseline origin/main 937281d. Production at inspection was 97e4082, Vercel project prj_DBd5YBg9YtKBhlhPoaQKXo1SX5cx, team team_4Dvl33owNJ0TlIqwLeNmmWFs, apex https://mysession.club. Main has one subsequent existing room-effects fix which must be preserved.

Editorial articles: src/content/blog Markdown + blog-editorial-manifest.json; Vite raw glob imports populate browser content. scripts/prerender-blog.mjs emits static articles. scripts/prerender-seo.mjs emits landing/public HTML. scripts/generate-seo-assets.mjs emits root index and three child sitemaps. Vercel serves filesystem before SPA index.html fallback. The existing handoff script clears prerender content before React mounts; this change preserves that convention. Source pages are still React-rendered client-side.

## Evidence

GSC Page indexing data last updated 12 October: 20 indexed, 49 excluded. Many exclusions are stale or intentional. www now correctly redirects 308 to apex. Canonical alternate: www/body-doubling. Duplicate without canonical: www/sessions. Five redirect exclusions are HTTP/www variants; private profile is intentionally blocked by robots. No unlocking of private routes is authorized or needed.

Real remaining defects: raw HTML for /rules, /group-focus-sessions, /silent-coworking, /adhd-productivity inherited home canonical/content. /contact had metadata but no raw body. /focus-sessions and other Navigate aliases returned home HTML with 200 until JavaScript. Missing /status and /help also fell through to home HTML. Five noindex articles were already restored and have validation running since October 16. Crawled/discovered checks already started October 17. Root sitemap still shows Couldn't fetch despite XML HTTP 200 and successful child maps; do not claim a proven crawler fetch cause.

## Changes

- scripts/prerender-existing-public.mjs renders actual existing React components for five public routes, with route-specific metadata and one H1; no duplicate rewritten article content. Registered in build after prior prerender.
- Four existing public pages added to sitemap (52 total URLs).
- Server-side 308 rules for eight aliases, including /help to /faq and /focus-sessions to /group-focus-sessions. Specific rules precede filesystem and SPA fallback.
- Retired /status returns HTTP 404 with static noindex page; app/auth/media routes retain their fallback.
- tests/seo-server-routes.test.mjs checks destination HTML, no redirect chains, ordering and preservation of app routing.

## Verification and continuation

Complete build including follow-up metadata changes passed all SEO suites (52 sitemap URLs, 19 bundled articles, 16 data-driven React pages). Both tests in tests/seo-server-routes.test.mjs pass after build. Local dependency install required npm ci; no secrets printed or copied. npm run typecheck is blocked by existing TS6306/TS6310 project-reference configuration in tsconfig.node.json, not a passing check. New concurrent main commits through 28d61a4 change Tasks only and must be preserved before release. Release, production verification, new indexing and additional Validate Fix results must be recorded after they occur; none are implied by this document.

Existing accepted index requests: C:/Users/misha/.codex/visualizations/2026/09/08/01a08286-eb98-7cf2-b791-de2d118d1093/mysession-indexing/ledger.json. Queue completed October 17 and automation deleted. Do not resubmit unchanged accepted URLs blindly. New requests needed for newly repaired public destinations after verified publication; do not request redirects, private profiles or retired status page. Validate Fix only for actual remediated causes; intentional exclusions remain expected. Google validation completion is asynchronous and cannot be promised.
