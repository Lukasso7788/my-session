# Editorial photo covers

Five current bundled SEO articles use reproducible, 1200 × 630 JPEG covers
composed in HTML/CSS and captured with local headless Chrome. This directory
contains the Pexels source metadata and page links (`sources.json`), downloaded
source photos (`photos/`), the shared HTML template, and generated standalone
compositions (`compositions/`). Published screenshots live under
`public/blog/editorial/<slug>-cover.jpg`.

To revise one, edit its copy, theme, or Pexels photo in `sources.json` and
optionally change `cover-template.html`. Run `npm run covers:photos` only when
the original photo changes, then `npm run covers:render`. Chrome defaults to
`C:\Program Files\Google\Chrome\Application\chrome.exe`; set `CHROME_PATH`
for another location. Run `npm run build` afterward: the editorial verifier
checks dimensions, file size, attribution, alt text and social metadata.

Do not replace photo-page URLs with a search-result URL. Confirm the source
photo and the current [Pexels license](https://www.pexels.com/license/) before
changing a source, and keep the photographer credit. The photos are editorial
illustrations, not photographs of MySession members or testimonials.
