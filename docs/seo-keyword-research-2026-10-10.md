# MySession editorial keyword map — 2026-10-10

This is a search-intent map for the five bundled editorial articles and the
`/body-doubling` topic hub. It is **not** a report of measured search volume
or keyword difficulty for these exact phrases.

## Research and limits

- [Semrush's public Focusmate overview](https://www.semrush.com/website/focusmate.com/overview/) shows related search interest: `focusmate virtual coworking` (US monthly volume 720), `focusmate virtual body doubling` (320), and `focusmate body doubling` (210) in its August 2026 snapshot. These are **branded competitor phrases**, not the target keywords below; do not transfer their volume figures to MySession's phrases.
- [Semrush's public Study Together overview](https://www.semrush.com/website/studytogether.com/overview/) shows interest in study-room searches, but the broad phrase does not establish volume for the article's body-doubling study routine query.
- Ahrefs' free keyword generator presented a human-verification challenge, so it yielded no trustworthy phrase-level results. Google Keyword Planner was not connected. Exact volume, difficulty and country distribution for the selected long-tail phrases remain **unverified**.
- Google's [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) informs descriptive titles, useful content, links and image descriptions; its [mobile-first indexing guide](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) informs responsive verification. The under-60-character title **and** meta-description limits here are the user's editorial constraints, not a Google ranking rule.

## One primary phrase per page

| URL | Primary phrase | Search intent and relationship |
| --- | --- | --- |
| `/body-doubling` | body doubling sessions | Parent hub: find a room or choose a guide. |
| `/guides/what-is-body-doubling` | what is body doubling | Foundational definition and first-session guide; linked prominently from the hub. |
| `/blog/how-to-start-a-focus-session-when-stuck` | how to start a focus session | Actionable starting routine for people blocked before a session. |
| `/blog/body-doubling-study-session-routine` | body doubling study routine | Study-specific session workflow. |
| `/blog/remote-work-accountability-without-meetings` | remote work accountability | Independent remote-work routine without status meetings. |
| `/blog/choose-25-50-or-90-minute-focus-session` | focus session length | Comparison/selection of work-block durations. |

Each article has one `focusKeyword` in `src/data/blog-editorial-manifest.json`.
`scripts/verify-blog-editorial.mjs` checks that the keyword appears in its SEO
title, that the slug overlaps it, that title/description each stay under 60
characters, and that the article has contextual internal links and descriptive
cover alt text. This validates implementation, not search ranking or CTR.

## Next measurement step

After release, inspect Search Console URL Inspection and Performance for each
canonical URL; record impressions, queries, click-through rate and indexing
status. If a connected Keyword Planner, Semrush or Ahrefs account becomes
available, collect country-specific volume and difficulty for the exact six
phrases and revise this map based on evidence rather than assumed numbers.
