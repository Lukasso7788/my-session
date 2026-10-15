# MySession SEO indexability repair — 2026-10-15

Work in progress. This document records the architecture, evidence, changes,
verification, and release status for continuing the task in another chat.

## Scope and baseline

- Repository: `lukasso7788/my-session`, React 18 + TypeScript + Vite 7.
- Production baseline: `d4962d394bcb18adc79b44f02cca348b809b6dec`.
- Vercel project: `my-session` / `prj_DBd5YBg9YtKBhlhPoaQKXo1SX5cx`.
- Team: `team_4Dvl33owNJ0TlIqwLeNmmWFs`.
- Public origin: `https://mysession.club`.
- This isolated checkout contains only SEO repairs; preserve unrelated room,
  video, email and animation worktrees.

## Confirmed cause

The 14 editorial articles from commits `1757adf` and `3c09479` are present in
the saved `cursor/room-disconnect-audit-7ef6` history, but absent from current
`origin/main`. Their Markdown, covers, manifest entries and browser imports
must be restored together. Merely removing `noindex` from the missing-article
screen would publish an empty search result.

The Vercel project domain `www.mysession.club` redirects to the apex with
307. Google selected the www pricing URL while the declared canonical is
the apex. The redirect should be permanent, with path and query preserved.

## Architecture

Public articles use `src/data/blog-editorial-manifest.json`, Markdown under
`src/content/blog`, and `src/data/blogEditorial.ts`. The React `BlogPost` and
`BlogIndex` screens merge bundled articles with published Supabase records.
Database articles may override bundled content. Public static HTML is emitted
by `scripts/prerender-blog.mjs`; `scripts/prerender-seo.mjs` handles landing
pages and public routes. `scripts/generate-seo-assets.mjs` generates a root
sitemap index and three child sitemaps. `npm run build` runs all generators,
Vite, prerendering, and SEO verifiers.

No database schema or permissions change is needed to restore bundled articles.
## Application boundaries

The browser is a React SPA with React Router. App-level authentication and
account bootstrap use Supabase; room media uses LiveKit (legacy Daily code also
exists). Billing, daily email, room controls and account data are outside this
repair. Do not merge the complete video-audit branch to recover editorial files.
Only its article content, cover assets and source compositions were recovered.
Vercel serves generated static HTML before its SPA fallback in `vercel.json`.
The canonical public origin remains the non-www HTTPS domain.

## Implemented changes

- Restored 14 Markdown articles, cover JPGs, HTML compositions and source photos
  from saved editorial history; preserved newer main cover metadata.
- Restored related internal links in four existing articles.
- Replaced manual Markdown imports with Vite raw glob discovery; the editorial
  manifest remains the publication authority, not the presence of a Markdown file.
- Added `tests/published-editorial-routes.json` and assertions in
  `scripts/verify-seo-react-render.mjs` protecting 19 published editorial routes,
  browser/prerender Markdown parity and self-canonical URLs.
- Disabled unnecessary dependency discovery in the prerender Vite server.
- Converted the homepage hero to one responsive picture element with WebP and
  PNG fallback. Desktop WebP is 160834 bytes, mobile WebP 57758 bytes; original
  PNGs are retained. Explicit dimensions reserve image space.
- Reserved the maximum rotating-heading height and cleaned up its timeout;
  reduced-motion users get a stationary heading. No room UI changes.

## Verification and current status — 16 October 2026 Kyiv

- Fresh `npm run build` passed all checks: 48 sitemap URLs across 3 children,
  19 editorial articles, 16 data-driven React routes and semantic cluster checks.
- Build used only existing public `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` process environment values; no environment file or
  credentials were copied into tracked files.
- Local preview: `http://127.0.0.1:4215/blog/group-pomodoro-sessions`.
  Browser rendered the full article instead of Article not found; confirmed
  article H1, correct title, self-canonical and index/follow after React loaded.
- Standard `npm run typecheck` remains blocked by existing TS6306/TS6310 in
  project references: tsconfig.node.json lacks composite and disables emit.
  Both tsconfig files are unchanged by this repair. Build passing is not a claim
  that full-project typecheck passes.
- Field LCP/CLS improvements are not yet measured; Search Console field metrics
  will not immediately reflect local image/layout changes.
- Browser access to Vercel timed out twice at the permission approval gate.
  Do not bypass that gate. User interaction/approval is needed before retrying.
- The www 307-to-308 domain setting has NOT been changed or verified.
- No new production deployment or new indexing request is confirmed in this
  continuation. Earlier production check still had 34 URLs and missing articles.

## Git delivery — 16 October 2026

SEO changes committed as `a6e660c`. Integrated the current origin/main into
the isolated branch with merge `485474d`; this preserved concurrent room,
header and free-session-notice changes. Branch was pushed successfully to
`origin/codex/seo-indexability-repair`. Production main was not pushed or
deployed. The merged branch passed the full build and all SEO checks again.
Local browser checks also confirmed the task-paralysis article renders and
the homepage selects the loaded desktop WebP without horizontal overflow.
Proof screenshot is saved beside the indexing ledger as
`seo-restored-article-2026-10-16.png`.

## Safe continuation

Worktree: `C:/Users/misha/.codex/worktrees/seo-indexability-repair/my-session`.
Branch: `codex/seo-indexability-repair`, initially based on d4962d3.
On 16 October, fetched origin/main was a3e118e (one separate room fix newer).
Preserve it when integrating; never reset the dirty primary checkout.

Finish local browser checks, review and commit only this SEO diff, integrate
the latest main without overwriting other work, then verify the intended Vercel
team/project/commit before a production release. Verify all restored URLs on
production (200, real article, no noindex, self-canonical) before indexing.
The www redirect is a project domain setting, not a DNS-record change.

Indexing state is in
`C:/Users/misha/.codex/visualizations/2026/09/08/01a08286-eb98-7cf2-b791-de2d118d1093/mysession-indexing/ledger.json`.
Read it fresh: 27 URLs were previously accepted and 14 await publication.
Do not resubmit accepted URLs. In Search Console skip already-indexed pages;
record each explicit Indexing requested confirmation immediately. Stop at quota
or CAPTCHA. Do not treat a live test as acceptance. The daily seo-mysession
automation remains active until its queue is fully processed.
