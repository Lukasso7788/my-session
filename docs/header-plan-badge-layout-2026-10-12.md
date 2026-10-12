# Header membership badge — layout regression handoff

Date: 2026-10-12. Full architecture: my-session-project-context.md.
Prior billing/FМ Pro release: dbcfd70, pushed to main. This follow-up starts from
that exact commit in C:\projects\my-session\.codex-safe-billing-session-notice,
branch codex/billing-session-notice. Other root/video worktrees remain untouched.
The owner requested a focused commit and non-force push to main; verify Git refs
for its release SHA. No direct Vercel promotion or live-deployment claim.

## Cause and presentation fix

The plan-badge anchor used whitespace-nowrap. Since white-space is inherited,
the entire popover description became one long line outside its 220px card.
That nowrap class is now only on the badge button. The popover explicitly uses
whitespace-normal, min-w-0 and break-words for its title, description and action.
Its width remains 220px, capped by calc(100vw - 24px).

Badge placement is left: calc(100% - 4px), top: -2px relative to the wordmark.
This deliberately overlaps the last letter by 4px as requested. The mobile
popover anchor is -150px from the badge's start; at sm+ it remains right-aligned.
That keeps the card inside the viewport even for shorter Free/Pro badge labels.

src/components/HeaderPlanBadge.tsx is a stateless presentational component.
Header still owns the entitlement hook, title/copy, navigation, click handlers,
140ms close delay, outside-click and Escape handling. All handlers are passed
through unchanged. Accessible expanded state was added to the badge trigger.
No permission, payment, grant, expiry, flag, plan-name or room logic changed.

## Regression coverage and local check

- tests/browser/billing-session-notice.tsx now uses the real HeaderPlanBadge
  component next to a matching MySession wordmark, rather than a lookalike badge.
- tests/headerPlanBadge.test.mjs: 3 regression tests cover nowrap scoping,
  overlap/closed markup and caller-owned hover/action callbacks.
- The test uses Vite's installed esbuild via createRequire. Root esbuild is the
  legacy 0.14.47 used by older tests; Vite uses 0.27.7 with automatic JSX support.
  No dependency or lockfile change was made.
- Combined header/billing suite: 27 tests passed. Full npm.cmd run build passed
  including all prerender/SEO checks. Focused ESLint has no errors; only the
  dev fixture's Fast Refresh/no-export warning remains.
- Changed-file TypeScript comparison: baseline 44/current 44, zero introduced
  diagnostics. Whole-project typecheck still has old tsconfig reference issues.
- Browser checks used the same component at desktop and actual 375/320 CSS px.
  Free, Pro and FM Pro cards all stayed inside the viewport. Every description
  text-line rectangle remained inside its card; no horizontal overflow.
  Measured wordmark overlap: 4.00390625px. FM Pro description wraps onto 3 lines.
- Windows browser scaling affects viewport requests (300 requested => 375 actual,
  256 => 320). Measurements use actual window.innerWidth, not requested values.
  Temporary viewport override was reset after testing. Screenshots were inspected.

Local preview remains http://127.0.0.1:4203/tests/browser/billing-session-notice.html.
Source files: Header.tsx, HeaderPlanBadge.tsx, dev fixture, regression test and
these context docs. Do not stage the unrelated sitemap XML stat/EOL dirtiness,
private membership exports or build output.
