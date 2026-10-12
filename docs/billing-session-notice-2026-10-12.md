# Free-session warning and subscription cancellation — continuation

Date: 2026-10-12. Full project architecture is in **my-session-project-context.md**
alongside this file. This document records only the new feature and its boundaries.

## Working state and authority

- Repo: `https://github.com/lukasso7788/my-session`.
- Checkout: `C:\projects\my-session\.codex-safe-billing-session-notice`.
- Branch: `codex/billing-session-notice`, based on fetched `origin/main` at
  `b66f09a`. Owner requested commit and push to main on 2026-10-12. Release subject:
  feat(billing): add Founding Member Pro and subscription controls. No direct
  deployment promotion, paywall activation or Stripe subscription cancellation
  ran. Subsequent owner-authorized membership
  grants and the complimentary expiry job were applied directly to production
  on 2026-10-12; see founding-members-2026-10-12.md for exact scope and status.
- Root `C:\projects\my-session` is an old dirty checkout. Do not reset it.
- Separate video-audit fixes remain in their own worktree/branch and were not
  copied or modified. Do not accidentally replace that room implementation.
- A node_modules junction reuses the already-installed dependency tree from
  `.codex-safe-room-side-panels`; no SDK/install/lockfile changes were made.
- Build-regenerated sitemap dates were restored to the branch baseline so this
  feature does not include unrelated SEO changes.
  Git may still report the four sitemap XML files as stat/EOL-dirty even though
  `git diff --numstat -- public/sitemap*.xml` is empty. Exclude them from a
  focused billing commit; do not blanket-stage the worktree.

## Runtime/data architecture relevant to this feature

React 18 / React Router / Vite / Tailwind SPA. `AppLayout` mounts shared Header
for account and sessions pages; room routes have their own UI. Header account
menu now has a direct **Subscription** link to `/settings#subscription` on both
desktop and mobile. Room/video layouts, policies and admission behavior are not
changed by this task.

Supabase supplies Auth, data and Realtime. The production project was confirmed
as `cxqgzcjsjyszcbcbdusp` (MySession). Identity validation remains server-side
`supabaseAdmin.auth.getUser(bearerToken)`; no authorization uses editable user
metadata. No service-role/Stripe secret is sent to the browser.

Canonical attended-session count is the existing
`get_lifetime_attendance_count` RPC / `calculate_lifetime_session_count(uuid)`:
scheduled session once per user/session, infinite room once per user/room/local
calendar date. Rejoins/tabs do not add another count. This code does not add
attendance writes or change the counting rules. The old RPC fallback is retained.

`PRICING.freeLifetimeSessions` remains 15. `VITE_PAYWALL_ENABLED` defaults false
and was NOT changed. `user_entitlements` remains the source for plan/status and
Stripe customer/subscription linkage. Pro/lifetime/founding exclusions use the
existing `hasUnlimitedAccess` rule, rather than inventing a parallel entitlement
policy. The owner has now supplied an EXCLUSION list for permanent free
Founding Member Pro, plus a zero-attendance exclusion. After identity clarification,
481 permanent founding grants and one temporary grant were applied. See
founding-members-2026-10-12.md for the latest instructions and outstanding holds.

## New UI and data flow

1. `src/lib/freeSessionNotice.ts` is a pure presentation model, not an admission
   gate. Logged-in, non-unlimited users get a visible warning at 12, 13 and 14:
   **Three / Two / One session(s) left**. At 15+ the display clamps remaining to
   zero and offers **Upgrade to Pro**. Unknown/failed usage does not become zero.
2. `src/components/FreeSessionsNotice.tsx` is rendered below Header on `/sessions`.
   It uses blue room-like accents, an accessible live status and `/pricing` CTA.
   The reminder is dormant while the paywall feature is disabled; do not tell
   users they have a limit before the owner actually turns that limit on.
3. `src/hooks/useAccountEntitlement.ts` refreshes on mount/navigation/focus and
   filtered profile/entitlement changes. No interval/polling/heartbeat was added.
   Results are tagged by account ID; logout/account switch cannot reuse the
   previous account's displayed allowance. `loadEntitlementState({forceRefresh})`
   bypasses stale result cache while retaining in-flight deduplication and
   preserving default cache behavior for existing callers.
4. `ProfileSettingsPage` delegates the Subscription card to
   `AccountSubscriptionSection`. The stateless `SubscriptionCard` is separated
   from API transport for UI testing. It shows plan, free allowance/progress when
   enabled, renewal date, scheduled cancellation and actual access-end date.
5. Recurring Stripe plans expose **Manage billing** and **Cancel subscription**.
   Manual Pro grants and lifetime access are not treated as recurring charges.
   Error/loading/retry states remain in-page; there is no fake success based only
   on a query-string marker. No pause capability is promised without support.
   Header's plan badge uses the same unlimited-access state, so a terminal
   canceled subscription does not keep a misleading Pro badge just because
   its historical plan field still says pro_monthly.

## Billing API/Stripe flow

Existing endpoint: `POST /api/billing/create-checkout-session`.

- `checkoutKind: "subscription_status"` reads the authenticated user's stored
  billing IDs, retrieves the linked subscription and returns a small UI summary.
  It returns no customer/subscription IDs and is marked `Cache-Control: no-store`.
- `checkoutKind: "customer_portal", portalAction: "manage"` retains the existing
  general Stripe portal behavior. Omitting portalAction still means manage.
- `portalAction: "cancel"` deep-links to Stripe's `subscription_cancel`
  **confirmation** flow. Opening it is NOT cancellation. Only the customer
  confirming in Stripe changes renewal.
- Both IDs come from `user_entitlements` for the bearer-authenticated user. A
  Stripe subscription's customer is checked against the stored customer before
  returning status or opening cancellation. Client user/customer/subscription
  IDs and return URLs are not trusted or accepted as authoritative.
- Only an active portal configuration with cancellation enabled and
  `mode: at_period_end` is allowed for this cancel flow. A missing/disabled/
  immediate-cancel configuration shows a support path instead of silently
  removing the paid period. Scheduled or terminal subscriptions cannot be
  canceled twice. Subscriptions managed by a schedule are not falsely promised
  a portal cancellation capability.
- Return: `/settings?billing=returned#subscription`, after which the app rereads
  Stripe status. Existing paid access is not changed on portal creation or
  `cancel_at_period_end`; terminal deletion is handled by the existing webhook.
- `src/lib/subscriptionManagement.ts` sends bearer-authenticated requests, maps
  safe user-facing errors and only navigates to HTTPS `billing.stripe.com`.

Server helper: `api/_lib/stripeSubscriptionPortal.ts`. The installed Stripe SDK
is 22.0.2; type aliases are derived from the SDK instance methods because its
CJS default export is a constructor rather than the old merged type namespace.
Modern billing-period timestamps are on `subscription.items.data`; the helper
also supports legacy root `current_period_end` payloads.

### Confirmed webhook bug fixed

`user_entitlements_status_check` only accepts `active`, `trialing`, `expired`,
`canceled`. The prior deleted-subscription handler attempted `cancelled` and
ignored the Supabase update error. It now writes `canceled` and throws on a failed
update so Stripe can retry instead of receiving a false success acknowledgement.
Terminal/renewal cancellation events only apply to the currently linked recurring
plan. An old subscription deletion cannot revoke a later lifetime/founding grant.
No historical Stripe reconciliation was performed: previously acknowledged
failed cancellations, if any, must be checked against Stripe before rollout.
Cancellation lifecycle emails now use the modern/legacy period helper. Their
event name `subscription_cancelled` is retained for compatibility.

## Environment/provider setup before release

The existing Stripe integration is reused, not newly provisioned. Required
server variables remain `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` and existing checkout price
IDs. No values were read/exported into this document or changed.

Optional: `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` selects an existing portal
configuration. If omitted, the default active configuration is inspected. In
the Stripe account that serves these customers, enable cancellation **at the
end of the current billing period** before expecting the Cancel button to appear.
Live Stripe configuration was not authenticated/inspected in this task. Do not
claim a real subscription was canceled or a production portal was tested.

Official flow references:
- https://docs.stripe.com/customer-management/portal-deep-links
- https://docs.stripe.com/customer-management/configure-portal
- https://docs.stripe.com/api/subscriptions/object

## Verification and limitations

- `node --test tests/billingSessionNotice.test.mjs`: 24 tests passed, including
  thresholds, feature-off/unknown usage, Pro/lifetime exceptions, modern dates,
  foreign-customer rejection, confirmation payload, disabled/immediate portal
  guard, repeat-cancel guard, authenticated HTTP routing, ignored client IDs,
  actual client request shape, secure navigation, user-facing API errors and the
  real webhook handler's status/retry/lifetime-protection paths, plus the distinct
  FM Pro badge, purchased Lifetime labeling and complimentary-Pro presentation.
  Stripe/Supabase adapters are isolated fixtures: no production writes/payments.
- `npm.cmd run build`: full production build and all bundled SEO verification
  scripts passed (33 sitemap pages, editorial/prerender checks included).
- `npm.cmd run typecheck`: fails on pre-existing tsconfig reference errors
  TS6306/TS6310. `node scripts/check-billing-types.mjs` compares diagnostics with
  the actual HEAD source instead of masking them: baseline 45, current 44,
  **no introduced diagnostics**. Do not claim the whole repo is type-clean.
- Focused ESLint: no errors; only the browser fixture's pre-existing pattern of
  a test entry without an exported component produces a Fast Refresh warning.
- Browser: real shared UI components were checked in 11 plan/allowance states,
  including keyboard activation of cancellation. Desktop and narrow/mobile
  breakpoint checks show no horizontal overflow. No real portal call is made
  from the fixture. Browser screenshot capture was unavailable; do not invent
  a screenshot or claim visual screenshot inspection succeeded for that earlier
  pass. A new screenshot of the updated FM Pro fixture did succeed on this turn.
  Computed browser contrast: warning title 11.13:1; CTA 6.09:1. CTA target is 44px.
- Vite alone does NOT serve Vercel API endpoints. Authenticated HTTP handler
  behavior is covered by isolated adapter tests, not live deployment tests.

## Local preview / resume commands

Dev-only fixture: `tests/browser/billing-session-notice.html` and `.tsx`.
Preview URL: `http://127.0.0.1:4203/tests/browser/billing-session-notice.html`.
Server session 75142 was started outside network sandbox for browser reachability.
The inaccessible sandbox-only server was session 8189 on port 4202 and was
interrupted during cleanup. The browser viewport override was reset after tests.

From the checkout:

```powershell
node --test tests/billingSessionNotice.test.mjs
node scripts/check-billing-types.mjs
npm.cmd run build
npm.cmd run dev -- --host 127.0.0.1 --port 4203 --strictPort
git diff --check
```

Next safe release checks: review diff, verify an existing Stripe test portal
configuration, test end-to-end with a test subscription (never a real user's
subscription), deploy only with authorization, and only then separately enable
the paywall. Membership grants have now been applied as documented in the
founding-members handoff; do not rerun them or extend the temporary grant.
