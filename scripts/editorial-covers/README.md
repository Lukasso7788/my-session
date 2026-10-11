# Editorial photo compositions

Fifteen bundled SEO articles, three SEO landing pages, and two inline article
illustrations use reproducible, 1200 × 630 JPEG compositions
composed in HTML/CSS and captured with local headless Chrome. This directory
contains the Pexels source metadata and page links (`sources.json`), downloaded
source photos (`photos/`), the shared HTML template, and generated standalone
compositions (`compositions/`). Published screenshots live under
`public/blog/editorial/<slug>-cover.jpg`. The SEO landing pages refer to
their images through `imagePath` and `imageAlt` in `src/data/seo-pages.json`;
the two inline article images are referenced in bundled Markdown.

To revise one, edit its copy, theme, or Pexels photo in `sources.json` and
optionally change `cover-template.html`. An optional `photoPosition` (CSS
`object-position`, e.g. `"100% 100%"`) overrides the theme's default crop
when the subject would otherwise be cut off. Run `npm run covers:photos` to fetch
missing photos or `npm run covers:photos -- <slug>` to replace one photo after
changing its `photoId`, then `npm run covers:render` (all covers) or
`npm run covers:render -- <slug> [<slug> ...]` to re-render only the named
covers and leave the other published JPEGs untouched. Chrome defaults to
`C:\Program Files\Google\Chrome\Application\chrome.exe`; set `CHROME_PATH`
for another location. Run `npm run build` afterward: the editorial verifier
checks dimensions, file size, provenance, alt text, social metadata and
prerendered article/landing-page images. Keep the visible subject in each
`alt` accurate to the rendered crop; include any short headline that adds
meaning, but do not stuff a keyword list into alt text.

Do not replace photo-page URLs with a search-result URL. Confirm the source
photo and the current [Pexels license](https://www.pexels.com/license/) before
changing a source, and keep the photographer credit. The photos are editorial
illustrations, not photographs of MySession members or testimonials.
