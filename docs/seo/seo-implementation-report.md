# Semantic SEO implementation report — 2026-10-11

## Outcome and page ownership

| URL | Primary topic | Role / intent | Action |
| --- | --- | --- | --- |
| `/` | Live focus sessions | Broad product entry | Preserved; no competing app keyword added. |
| `/body-doubling` | Online body doubling | Introductory hub | Sharper title/description, links to distinct app page. |
| `/body-doubling-app` | Body doubling app | Browser-based product / commercial | New substantive page. |
| `/guides/what-is-body-doubling` | What is body doubling | Definition / guide | Added inline editorial illustration and app link. |
| `/virtual-coworking` | Virtual coworking rooms | Room-format explainer | Reworked copy, Q&A, contextual links and editorial cover. |
| `/virtual-coworking-for-remote-workers` | Virtual coworking for remote workers | Remote-work use case | Reworked copy, privacy guidance, FAQ, and editorial cover. |
| `/blog/remote-work-accountability-without-meetings` | Remote work accountability | Practical routine | Added illustration and remote-room links. |

The app page has a distinct reason to exist: the existing body-doubling hub helps visitors choose a room or guide; the new page explains the **browser product**, live group participation, task/timeline tools, and why it is different from a prerecorded video or solo timer. The coworking guide owns general room-format questions, while the remote-worker page owns workday boundaries and confidentiality. No keyword-variant page was created for the other 74 candidate phrases.

## Existing architecture and issues found

- React Router loads data-driven SEO routes from `src/data/seo-route-manifest.json`; `src/data/seo-pages.json` owns their metadata, copy, related links, and sitemap eligibility. `src/pages/seo/DataDrivenSeoPage.tsx` renders the pages; `src/lib/pageSeo.ts` updates client-side canonical/social metadata.
- `scripts/generate-seo-assets.mjs` generates the sitemap index and page/guide/comparison sitemaps. `public/robots.txt` permits these public routes and names the sitemaps. The three target pages were already public/indexable; the app page was missing.
- `scripts/prerender-seo.mjs` writes route-specific HTML into `dist/<route>/index.html`. This is useful for crawlers and non-JavaScript clients: Google can render JavaScript, but Google’s own [JavaScript SEO documentation](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) says prerendered HTML can be faster and more broadly accessible. The former generic prerender did not expose landing-page images or social images.
- The older coworking pages had brief content that did not directly answer likely room-format and remote-work privacy questions. Non-hub data-driven pages had no matching editorial image. Existing use-case pages were emitted as `SoftwareApplication` in client JSON-LD even when they were explanatory WebPages; this is now restricted to the dedicated browser app page (`WebApplication`).
- The homepage's client-side animated H1 differs from the static prerendered H1. That preexisting product/SEO mismatch is a separate follow-up; this task did not redesign the homepage. Search Console indexing/canonical selection could not be checked because the connected GSC Wizard returned `payment_required`.

## Changes made

1. Added `/body-doubling-app` to the SEO route manifest and registry data, with a unique title, description, H1, real-feature explanations, FAQ, contextual links, canonical and sitemap inclusion. The page explicitly says MySession runs in a browser; it does **not** claim a native mobile download.
2. Updated the body-doubling hub’s metadata and linked to the app page while retaining its existing URL, hero photo, brief explainer, and guide navigation.
3. Expanded the coworking and remote-worker pages around user questions and concrete product behavior. Introduced natural internal links between the hub, app page, coworking guide, remote-work use case, session formats and current room list. No mechanical keyword block is rendered.
4. Added five local HTML/CSS photo compositions: three landing-page covers and two inline article illustrations. Sources, photographers, original Pexels photo pages and captions are recorded in `scripts/editorial-covers/sources.json`. HTML compositions and 1200 × 630 JPEG screenshots are reproducible with the existing cover renderer. [Pexels’ license](https://www.pexels.com/license/) permits website use and modifications; stock subjects are illustrative and do not endorse MySession.
5. Added concise, descriptive `alt` text based on the *visible crop* and meaningful headline, not a keyword list. Static HTML, React-rendered images, Open Graph and Twitter image-alt metadata use the same descriptions. The two article illustrations use Markdown images with photo credits and become crawler-visible in prerendered HTML.
6. Corrected structured data: the product page identifies the browser application; other use-case pages remain WebPages. Added the new image to relevant structured data and social metadata. The pages retain unique self-canonicals.
7. Added `scripts/verify-seo-semantic-clusters.mjs` to the build: route/canonical/title/H1/schema, 200+ raw-HTML words, sitemap URL, image/alt/social tags, 1200 × 630 JPEG dimensions, file size, provenance, links and duplicate title/description checks.

## Files and ownership

| Area | Files |
| --- | --- |
| Route/copy/metadata | `src/data/seo-pages.json`, `src/data/seo-route-manifest.json`, `src/data/seoPageRegistry.ts`, `src/pages/seo/DataDrivenSeoPage.tsx`, `src/lib/seoStructuredData.ts` |
| Prerender/sitemap/checks | `scripts/prerender-seo.mjs`, `scripts/verify-seo-semantic-clusters.mjs`, `scripts/seo-visual-check.mjs`, `package.json`, `public/sitemap-pages.xml`, `public/sitemap-guides.xml` |
| Article bodies | `src/content/blog/what-is-body-doubling.md`, `src/content/blog/remote-work-accountability-without-meetings.md` |
| Image pipeline | `scripts/editorial-covers/{sources.json,cover-template.html,render.mjs,download-photos.mjs,README.md}`, five new local source JPGs, five HTML compositions and five published JPEGs |
| Handoff/research | `docs/seo/keyword-research.md`, this report, `docs/my-session-project-context.md` |

`public/sitemap-pages.xml` includes the new app URL and updated remote-worker timestamp. `public/sitemap-guides.xml` updates the coworking guide timestamp because its content changed. The unrelated line-ending-only change in `public/sitemap.xml` remains excluded from the SEO commit.

## Validation and limits

- `npm run build` runs Vite, blog and SEO prerenders, sitemap/public-route checks, editorial checks, React-route render checks, and the new semantic-cluster checker.
- The production build and its integrated semantic SEO checks passed. Focused ESLint on edited TypeScript/JavaScript files passed. Full-repository `npm run lint` still reports 2,686 errors and 109 warnings in preexisting unrelated files. `npm run typecheck` still reports TS6306/TS6310 project-reference configuration errors; direct app `tsc --noEmit` also encounters existing room/chat errors. These repository-wide failures are not represented as a clean TypeScript/lint pass.
- The optional Chrome-based `scripts/seo-visual-check.mjs` captured the three landing pages at mobile/desktop sizes from a local production preview. All four tested viewports showed loaded images with `alt` and no horizontal overflow. The preview was run separately from Chrome in a network-accessible local process; an earlier restricted preview connection timed out and was not a page failure.
- Source images are local and do not depend on Pexels at runtime. Generated JPEGs are 1200 × 630 and under 220 KB each. Descriptive `alt` is for access and context, not a ranking guarantee. Google’s [image SEO guidance](https://developers.google.com/search/docs/appearance/google-images) recommends standard `<img src>`, descriptive filenames/alt and avoiding stuffing.
- No Search Console or keyword-tool demand numbers were available, so the 75-candidate map is intentionally qualitative. There is no claim that Google has indexed or ranked the new route merely because the build and local prerender pass.
- The five new stock compositions are illustrative. Verify any future source change against its current license and avoid implying that photographed people use MySession.

## Next iteration

Restore Search Console access, inspect the four central URLs plus both updated articles, and record query/page impressions, clicks, selected canonical, indexability, country and device. After enough settled data, compare CTR and query overlap, improve the highest-value passages, and consolidate pages if the evidence shows cannibalization. Separately check the homepage static/client H1 parity and production image loading after deployment; a Git push alone is not proof that production is updated.
