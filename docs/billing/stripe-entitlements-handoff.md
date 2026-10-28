# Stripe subscriptions ↔ entitlements: handoff

Date: 2026-10-28. Status: implemented and tested locally, **not deployed**.
No migration applied, no Stripe/Vercel/Worker settings changed, no production
data read or written. The owner asked to deploy no earlier than 24 hours after
this change; see "Release plan".

General project context: `docs/my-session-project-context.md`. Earlier billing
UI/portal work: `docs/billing-session-notice-2026-10-12.md`.

## Confirmed case and root causes

A `user_entitlements` row stayed `plan=pro_monthly, status=active,
source=checkout_confirm, current_period_end=2026-06-21` with no Stripe IDs, no
payments/subscriptions rows and Free in `profiles`. The old code explains it:

1. `api/billing/confirm-checkout-session.ts` granted Pro when
   `payment_status !== "paid" && status !== "complete"` was false, i.e. a
   **completed but unpaid** session (delayed payment) was enough. It set the
   period to "now + 30 days" and **did not store** the customer/subscription
   IDs, so no later webhook could find or fix the row.
2. `hasUnlimitedAccess()` (app) and `hasPaidTaskAiAccess()` (`api/templates.ts`)
   checked plan + status only. Nothing ever moved the row off `active`, so the
   access never ended.
3. The webhook also granted on `checkout.session.completed` regardless of
   `payment_status`, used "now + 30/365 days" instead of Stripe's period, never
   extended the period on renewal, had no event dedup and answered 400 on
   internal errors.

## Architecture now

**Source of truth:** Stripe decides whether a subscription is paid and until
when. `public.user_entitlements` (one row per user) is the app's projection;
every access decision reads it through one rule, `hasUnlimitedAccess()` in
`src/lib/billing.ts`, used by the frontend and by the server (`api/templates.ts`
imports the same function).

**Every Stripe-driven write** goes through `api/_lib/stripeEntitlementSync.ts`:

| Caller | Function |
|---|---|
| `api/stripe/webhook.ts` (Stripe events) | `syncEntitlementForEvent` → `syncSubscription` / `syncCheckoutSession` |
| `api/billing/confirm-checkout-session.ts` (success page) | `syncCheckoutSession` with `expectedUserId` |
| Hourly reconciliation (Worker cron → webhook function) | event replay + `syncSubscription` |

Other writers that remain, untouched: manual/admin grants (Founding Member Pro,
complimentary Pro, done in SQL by the owner), the pg_cron job
`expire-complimentary-pro` (migration `20261012054501`, complimentary rows
without a Stripe subscription only), affiliate/host-support tables (not
entitlements).

### How a sync works

- Re-reads the **current** object from Stripe (`subscriptions.retrieve`,
  `checkout.sessions.retrieve`) instead of trusting the event payload. A replayed
  or late event therefore re-applies today's state; an old `active` snapshot
  cannot restore ended access.
- Owner: `subscription.metadata.supabase_user_id` / session metadata, written by
  `create-checkout-session` **on the server**. A row already linked to the
  subscription must agree; conflicting links → `user_mismatch`, no write. With
  no metadata it falls back to the row linked by subscription ID, then a unique
  customer ID. Client-supplied user/plan/price are never used.
- Write is compare-and-set on `updated_at` (`writeEntitlement`); a lost race
  re-reads Stripe and retries (max 4). No new column is needed for this.
- Never changes `founding_free` or `lifetime` rows from a subscription.
- If a user has two subscriptions, the one granting access wins, else the newer.
- An unpaid/incomplete checkout does not revoke a still-valid manual grant.
- No row is created for a subscription that grants nothing.

### Access policy (`desiredStateFromSubscription`, `hasUnlimitedAccess`)

| Stripe subscription status | Row | Pro until |
|---|---|---|
| `active` (incl. `cancel_at_period_end`) | `active` | item `current_period_end` |
| `trialing` | `trialing`, `trial_*` set, period null | `trial_end` (trial rules separate) |
| `past_due`, `unpaid` (renewal not paid) | `expired` | current period **start** = last paid end; no grace period |
| `incomplete`, `paused` | `expired` | none |
| `canceled`, `incomplete_expired` | `canceled` | `min(ended_at, period end)` |

`hasUnlimitedAccess(row, now)`:
- `lifetime`, `founding_free`: status active/trialing; dates ignored (unchanged).
- `pro_monthly`/`pro_yearly`: `status=active` **and** a valid
  `current_period_end > now`; missing/invalid date → no access.
  `status=trialing` → `trial_ends_at > now` only.
- `isEntitlementActive` follows the same rule; `getWeeklyLimitState`,
  `getPaywallDecision`, header badge, free-session notice, AI task lists and the
  subscription card all go through these. The card now shows lapsed rows as
  ended and `past_due` as "Payment failed".

Lifetime (payment-mode checkout): granted only when the session is `complete`
and `payment_status` is `paid` or `no_payment_required`. A Lifetime purchase may
upgrade a `founding_free` row (the user paid explicitly); nothing else does.

### Events handled (API version `2026-03-25.dahlia`, stripe-node 22.0.2)

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`
- `customer.subscription.created|updated|deleted|paused|resumed|pending_update_applied|pending_update_expired`
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`
  (subscription read from `invoice.parent.subscription_details.subscription`,
  legacy `invoice.subscription` as fallback)
- `charge.refunded`, `charge.dispute.created` (affiliate reversal, unchanged)
- host support checkouts: marked available only when `payment_status=paid`
  (also on `async_payment_succeeded`).

Existing side effects kept and idempotent by their own keys: lifecycle emails
(`subscription_started`, `payment_failed`, `payment_recovered`,
`subscription_cancelled`, `subscription_reactivated`), affiliate revenue share.
Cancellation emails fire only for the subscription the row follows.

### Webhook processing and ledger

`handleStripeEvent`: verify signature on the raw body (`bodyParser: false`,
`constructEvent`) → claim the event in `public.stripe_webhook_events` →
process → mark `processed` **only after** all effects saved. Failure → row
`failed` + HTTP 500 (Stripe retries). Duplicate of a processed event → 200
`duplicate`. Concurrent delivery (lease < 2 min) → 409 (Stripe retries).
Stale/failed attempts are taken over with a conditional update. Before the
migration exists the ledger reports `ledger_unavailable` and processing still
works (syncs are idempotent). Bad signature → 400; internal error → 500
(was 400).

### Reconciliation (missed webhooks)

`api/_lib/stripeReconcile.ts`, served by `POST /api/stripe/webhook` with header
`x-billing-reconcile-secret` (kept inside the existing function: the project
has 12 functions in `api/`, the Vercel Hobby limit). Scheduler: the existing
Cloudflare Worker cron (`*/5 * * * *`) calls it once per hour (first tick of
each UTC hour), `maybeReconcileBilling` in `cloudflare-worker/src/index.ts`.
1. Lists access-changing events from the last 72 h (Stripe keeps 30 days),
   oldest first, through `handleStripeEvent`; the ledger skips handled ones.
2. Re-syncs up to 100 recurring rows with a subscription whose period end is
   missing, ends within 2 h or ended in the last 40 days.
`?dryRun=1` (also the Worker's `/run?dryRun=1`) only reads and reports
`would_set_*`. Output has counts only, no user IDs.

## Dry-run audit of existing rows (no writes)

```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… STRIPE_SECRET_KEY=… \
  node scripts/billing/audit-entitlements.mjs [--out file.json] [--no-stripe]
```

The Supabase client is wrapped to throw on insert/update/upsert/delete; Stripe
is only read. Report (internal IDs only, written to the OS temp dir by default;
do not commit) with findings from `api/_lib/entitlementAudit.ts`:

- `loses_access_with_new_rule` (**release blocker**): old rule granted Pro, new
  rule does not. Review every one before deploying.
- `active_without_period_end`, `invalid_period_end`, `active_but_period_ended`
- `paid_source_missing_stripe_ids` (the confirmed case), `no_payment_record`
  (payments/subscriptions tables, if they exist)
- `stripe_mismatch`, `customer_mismatch`, `stripe_subscription_missing`
- `profile_mismatch`: compares any plan-like `profiles` columns it finds
  (the repo code has none; the column the owner sees as "Free" is detected
  dynamically).
- `manual_grant`, `manual_or_unknown_grant`, `lifetime_without_stripe_link`:
  info only; historical manual grants are not errors.

## Files

- New: `api/_lib/stripeEntitlementSync.ts`, `api/_lib/stripeReconcile.ts`,
  `api/_lib/entitlementAudit.ts`, `scripts/billing/audit-entitlements.mjs`,
  `supabase/migrations/20261028200000_stripe_webhook_events.sql`,
  `tests/stripeEntitlements.test.mjs`, this document.
- Changed: `api/stripe/webhook.ts` (handler rewritten; affiliate and host
  support helpers kept), `api/billing/confirm-checkout-session.ts`,
  `api/templates.ts`, `src/lib/billing.ts`, `src/pages/PricingSuccessPage.tsx`
  (shows "processing" and rechecks 5× every 4 s instead of claiming success),
  `src/components/SubscriptionCard.tsx`, `cloudflare-worker/src/index.ts`,
  `tests/billingSessionNotice.test.mjs` (fixtures need a paid period; the old
  webhook tests moved to the new file).
- Not changed: `create-checkout-session.ts` (already server-sets metadata).

## Verification done (local only)

- `node --test tests/stripeEntitlements.test.mjs tests/billingSessionNotice.test.mjs`:
  47/47. Covers first payment, renewal, failed renewal, period end, cancel at
  period end then deletion, duplicate and out-of-order events, failure →
  retry → processed, concurrent delivery, bad signature, missing ledger table,
  async success/failure, Lifetime paid/unpaid, success-page ownership, expired
  `active`, missing/invalid dates, FM Pro and Lifetime protection, two
  subscriptions, manual grant protection, trials, write races, unlinked
  subscriptions, reconciliation (dry run and real), audit classification.
- Mutation check: reverting each fix (old access rule, past_due extending,
  trusting event snapshot, unpaid Lifetime) makes the matching tests fail.
- Migration applied twice to a local PostgreSQL 16 with stubs for
  `cron.schedule`, roles and `user_entitlements`: idempotent; PK, status check,
  RLS, no anon access, indexes, prune job and prune predicate verified.
- `scripts/check-billing-types.mjs`: no new type errors (46 before/after, all
  pre-existing). Strict tsc on the billing API files: only the pre-existing
  missing types for `affiliateCommission.js`. ESLint clean on new/changed
  billing files. `vite build` passes. All `tests/*.test.mjs`: only the 3
  `seo-server-routes` tests fail, and they fail identically without this change
  (they need a built `dist/`).
- Not verified: real Stripe (test or live), real Supabase/PostgREST, the Worker
  in Cloudflare, the audit script against production data.
- docs.stripe.com was not reachable from the work environment; event names,
  statuses, `payment_status` values and the dahlia period location were
  verified against the SDK generated for this API version
  (`node_modules/stripe/cjs/resources/*.d.ts`, CHANGELOG). Re-check before
  release: https://docs.stripe.com/billing/subscriptions/webhooks,
  https://docs.stripe.com/checkout/fulfillment,
  https://docs.stripe.com/webhooks#verify-events,
  https://docs.stripe.com/billing/subscriptions/overview.

## Release plan (each step needs the owner's go-ahead)

1. **Run the dry-run audit** against production and review every
   `release_blocker` (`loses_access_with_new_rule`) and `review` finding. The new
   access rule removes Pro from monthly/yearly rows that are active without a
   current period (that is the point, but manual grants without an end date
   would lose access too). Decide per row; do not bulk-update.
2. Apply `20261028200000_stripe_webhook_events.sql` (table, two indexes, prune
   job). Code works before it too, without early duplicate skipping.
3. Set `BILLING_RECONCILE_SECRET` (same random value) in Vercel (Production) and
   as a Worker secret; deploy the Worker (`wrangler deploy` in
   `cloudflare-worker/`). Without the secret the Worker skips reconciliation.
4. In the Stripe webhook endpoint, make sure these events are enabled:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.paused`, `customer.subscription.resumed`,
   `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
   `charge.refunded`, `charge.dispute.created`. Endpoint API version should be
   `2026-03-25.dahlia` (matches the SDK).
5. Deploy the app (merge to `main`). Then call the reconcile with `dryRun=1`,
   review, then let the hourly run proceed.
6. Watch `stripe_webhook_events` for `failed` rows and Vercel logs for
   `user_mismatch`/`unlinked`.

## Open decisions for the owner

- `STRIPE_COUPON_100_OFF`: `create-checkout-session` applies it to every
  non-UPI checkout when set. Such checkouts are `no_payment_required` and grant
  Pro by design. Confirm whether it is set in production.
- A Founding Member who starts a paid subscription keeps the FM row; the
  subscription is not recorded on it (`skipped_permanent_plan`). Decide whether
  that should ever happen.
- Lifetime refunds/disputes only reverse affiliate commission; access is not
  revoked. Unchanged; decide if it should be.
- Immediate cancellation in the Stripe dashboard ends Pro at `ended_at`
  (Stripe ended the service). Cancel-at-period-end keeps the paid period.
- The confirmed row (and similar ones): after review, set `status=expired` by
  hand or leave it; the new rule already denies access.
