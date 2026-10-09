# MySession Plunk email rollout — 2026-10-03

Read [my-session-project-context.md](my-session-project-context.md) first for
the full project architecture and safe checkout rules. This file is the exact
handoff for the email cutover, not evidence that delivery is live.

## Current state and trust boundaries

- The existing direct admin sends (friend invites, daily schedule, fixed-inbox
  test) use `api/_lib/plunk.ts` -> self-hosted Plunk `/v1/send` -> AWS SES.
  Supabase Auth/security messages are separate and unchanged.
- Supabase triggers/Stripe enqueue named lifecycle facts into
  `public.email_event_outbox`. `api/livekit/admin.ts` is the authenticated admin
  and secret-authenticated cron boundary. `api/_lib/plunkLifecycle.ts` reads
  post-cutover rows and posts events to Plunk `/v1/track`; Plunk workflows,
  templates and SES then determine whether any email is actually sent.
- Legacy `api/_lib/sender.ts`, `evaluate_sender_lifecycle_events()` and the
  historic outbox rows are retained for audit. The new route does not invoke
  Sender's send functions. The Cloudflare worker under
  `mysession-daily-email-cron/` still calls `senderAction=process/evaluate` every
  five minutes/daily respectively; those are compatibility route names, not a
  Sender delivery path after this code ships.
- At the 2026-10-03 read-only production audit: **648** rows were pending in
  the historical outbox and **0** preference rows explicitly opted into
  marketing. Recheck these numbers before activation. Do not bulk-send the
  backlog or import all auth users as subscribed contacts.
- The `plunk_lifecycle_cutover` SQL migration was applied to project
  `cxqgzcjsjyszcbcbdusp` as remote version `20261003043655`. Read-only
  verification showed all three RPCs present, authenticated users unable to
  execute the claim RPC, and the historical pending count still **648**.
- `PLUNK_LIFECYCLE_ENABLED` defaults OFF. The evaluator has a second flag,
  `PLUNK_LIFECYCLE_EVALUATOR_ENABLED`. No queued event is sent until the
  operator intentionally enables the new path after deployment and migration.
- Vercel Production variable-name audit found `PLUNK_API_URL`,
  `PLUNK_SECRET_KEY`, `PLUNK_FROM_EMAIL`, `PLUNK_FROM_NAME`, `CRON_SECRET` and
  `SENDER_INTEGRATION_ENABLED`, but no `PLUNK_PUBLIC_KEY`,
  `PLUNK_WEBHOOK_SECRET`, `PLUNK_LIFECYCLE_CUTOVER_AT`, or Plunk lifecycle
  flags. Vercel marks the existing secret values non-exportable; no key value
  was inspected or written into this repository. Plunk workflow/template
  inventory therefore has not been authenticated or verified.

## Code and migration map

- `supabase/migrations/20261003043655_plunk_lifecycle_cutover.sql` adds
  `claim_plunk_email_event_outbox(limit, cutover_at)` and
  `evaluate_plunk_lifecycle_events(cutover_at)` as service-role-only RPCs,
  `record_plunk_marketing_unsubscribe(email)` as a service-role-only opt-out
  RPC, and fixes preference event IDs so re-opt-in is not deduplicated away.
  It does not delete or rewrite the existing Sender queue or policies.
- `api/_lib/plunkLifecycle.ts` requires a deliberate UTC cutover, both Plunk
  keys, and Sender disabled. It creates a missing contact unsubscribed before
  tracking an event because Plunk otherwise creates it subscribed. It uses the
  persistent outbox idempotency key, sends session-specific template fields as
  one-shot event data (not contact data), interprets a confirmed 409 repeat as
  accepted, and stops retries after 20 hours (inside Plunk's default 24-hour
  idempotency retention). Expired events are cancelled, not re-sent.
- `api/livekit/admin.ts` keeps legacy action names for the existing worker and
  UI. Admin test events can go only to `PLUNK_TEST_EMAIL` (default
  `lukasus7788@gmail.com`); it is **an event acceptance test**, not proof of
  inbox delivery. Admin outbox process/retry requires an app admin. The
  unsubscribe webhook requires `x-plunk-webhook-secret`, a false subscription
  state, and a valid email. No Plunk secret is sent to the browser.
- `src/pages/SenderEmailAdminPage.tsx` is available at `/admin/plunk-email`
  (old `/admin/sender-email` alias preserved). `/settings/email` holds the
  user's explicit marketing switch; default is OFF.

## Required server-side configuration

Set these in the **Vercel Production** environment for the MySession project;
redeploy after any change. Do not put values in Git, public JavaScript, or a
`VITE_` variable. Keys belong to the Plunk project backed by the verified
`hello@updates.mysession.club` sender and SES.

| Name | Purpose |
| --- | --- |
| `PLUNK_API_URL` | `https://mail-api.mysession.club` (HTTPS only). |
| `PLUNK_SECRET_KEY` | Server-only `sk_*` key for contacts/direct `/v1/send`. |
| `PLUNK_PUBLIC_KEY` | `pk_*` key for `/v1/track`; used server-side here. |
| `PLUNK_FROM_EMAIL` | `hello@updates.mysession.club` for direct sends. |
| `PLUNK_FROM_NAME` | `MySession` for direct sends. |
| `PLUNK_TEST_EMAIL` | Approved inbox for lifecycle workflow tests. |
| `PLUNK_WEBHOOK_SECRET` | Strong random shared secret; configure the same value as Plunk workflow custom header. |
| `PLUNK_LIFECYCLE_CUTOVER_AT` | Actual activation time, ISO UTC including seconds and `Z`, e.g. `2026-10-03T15:00:00Z`. Must not precede deployment/migration. |
| `PLUNK_LIFECYCLE_ENABLED` | `false` until tests and workflows pass; then `true`. |
| `PLUNK_LIFECYCLE_EVALUATOR_ENABLED` | `false` initially; enable only after passive trigger delivery is verified. |
| `SENDER_INTEGRATION_ENABLED` | Must be `false`; simultaneous providers are refused. |
| `CRON_SECRET` | Existing Vercel secret matching Cloudflare worker `SENDER_CRON_SECRET`. Do not rotate casually. |

There is **no new Supabase project secret** for Plunk. Supabase holds preferences
and events; the Vercel server uses its existing Supabase service-role key.

## Safe activation sequence

1. Verify Plunk API health, verified sending domain, SES production sending,
   SPF/DKIM/DMARC, and a successful direct one-recipient test at
   `/admin/daily-schedule-email`. Health alone is not delivery proof.
2. Confirm the already-applied SQL migration (`20261003043655`) remains present
   in this production Supabase project. For a different project, apply it
   through the normal controlled migration process. Confirm the three new RPCs
   are executable only by `service_role`. Do **not** call
   `claim_email_event_outbox()` to clear the historical queue.
3. Create Plunk templates/workflows in DRAFT. Preserve existing Sender subject,
   body, delay and conditions where they exist in the Sender dashboard; this
   repository contains the event names but not those dashboard-only templates.
   Do not activate unreviewed workflows or assume event acceptance is delivery.
   Start with one low-risk lifecycle event (`user_registered`) and the
   matching approved-inbox test. Only then activate other workflows, one at
   a time. Marketing-category workflows must require explicit consent.
4. Create a Plunk `contact.unsubscribed` -> Webhook workflow. POST the default
   JSON body to
   `https://mysession.club/api/livekit/admin?plunkWebhook=unsubscribed` with
   header `x-plunk-webhook-secret: <same PLUNK_WEBHOOK_SECRET>`. Test that a
   hosted unsubscribe changes MySession `marketing_email_enabled` to false.
   Keep this workflow active before any marketing campaign. Do not configure
   `contact.subscribed` to flip the DB flag automatically; user must re-opt in
   through MySession if the hosted page is used to resubscribe.
5. Deploy with both lifecycle flags OFF. At `/admin/plunk-email`, confirm the
   status, approved test recipient, and outbox snapshot. Send the Plunk test
   suite only with explicit confirmation; it can trigger every enabled Plunk
   workflow in the approved inbox. Inspect actual delivery, variables,
   unsubscribe links, bounce status and SES logs.
6. Set cutover to the **current** UTC activation timestamp, keep
   `SENDER_INTEGRATION_ENABLED=false`, set `PLUNK_LIFECYCLE_ENABLED=true`,
   redeploy, and observe post-cutover outbox rows and inbox delivery. Old rows
   remain untouched. Do not move cutover backward to recover them.
7. Only after passive trigger flow works, enable
   `PLUNK_LIFECYCLE_EVALUATOR_ENABLED=true` and redeploy. The evaluator skips
   pre-cutover stalled users/no-shows/inactivity. Weekly recap waits seven
   days after cutover so it never claims a partial week is complete.
8. For marketing, create a **dynamic segment** requiring BOTH
   `subscribed=true` and `data.marketing_email_enabled=true`. Use that segment
   for MARKETING campaigns, not `ALL` and never TRANSACTIONAL to bypass an
   unsubscribe. Start with a preview/test send, then inspect exact recipient
   count and consent evidence before sending. Zero opt-ins means zero live
   recipients until people voluntarily opt in at `/settings/email`.

## Existing event identifiers

The outbox preserves these names: `user_registered`,
`registration_stalled`, `session_booked`, `session_cancelled`,
`session_no_show`, `first_session_completed`, `second_session_completed`,
`session_completed`, `weekly_recap_ready`, `inactive_seven_days`,
`inactive_fourteen_days`, `inactive_thirty_days`, `free_limit_warning`,
`free_limit_reached`, `pricing_viewed`, `checkout_started`,
`subscription_started`, `trial_started`, `trial_ending_forty_eight_hours`,
`trial_ended`, `payment_failed`, `payment_recovered`,
`subscription_cancelled`, `subscription_reactivated`,
`host_candidate_detected`, `referral_candidate`, `referral_signup`,
`testimonial_candidate`, `technical_issue_resolved`.
`subscriber_preferences_updated` is internal sync work, **not** a Plunk
workflow trigger. Some identifiers are only reserved for future product
triggers; creating an enabled workflow for them does not make the app emit
them. Paywall-warning events are cancelled while the paywall flag is off.

## Verification and rollback

- Run `node --test api/_lib/plunkLifecycle.test.mjs api/_lib/plunk.test.mjs`,
  `npm run build`, targeted ESLint, and `git diff --check`. Root
  `npm run typecheck` has pre-existing TS project-reference failures; full
  app typecheck also has many unrelated baseline errors, so compare touched
  lines and record any new ones separately.
- Check direct test's inbox and Plunk/SES logs; then one `user_registered`
  workflow with an approved test contact; then a real consent opt-in/out test;
  then the Cloudflare five-minute cron response. `/v1/track` returning success
  means the event was recorded, **not** that Plunk sent or delivered email.
- If anything is wrong, turn `PLUNK_LIFECYCLE_ENABLED=false` and redeploy;
  leave Sender OFF unless a separately reviewed rollback plan is approved.
  Do not replay the old 648 rows or a partially accepted Plunk batch. Inspect
  Plunk event IDs, outbox attempts and SES status before a manual retry.
- Plunk self-host version, live Vercel env values, workflow/template inventory,
  SMTP/SES deliverability and production inbox delivery must be verified by
  an operator with the relevant account access. Do not mark rollout complete
  based on code/tests or `/health` alone.

References: [Plunk track API](https://docs.useplunk.com/api-reference/public-api/trackEvent),
[campaign targeting](https://docs.useplunk.com/concepts/campaigns),
[segments](https://docs.useplunk.com/concepts/segments),
[webhooks](https://docs.useplunk.com/guides/webhooks).

## Daily schedule digest extension — 2026-10-09

This is a separate **direct** `/v1/send` email, not a lifecycle template or
Plunk marketing campaign. The existing scheduled-session template now also
shows real Infinite Room host reservations as complete time ranges. The
server selects all registered users with a valid email who have not disabled
the daily digest. The `marketing_email_enabled` switch is separate and does
not gate this daily schedule. The hourly Worker
chooses each user's 08:00–09:59 local morning and uses a stable per-user/day
idempotency key plus the Supabase send ledger. An admin-only fixed-inbox
preview/test can add a labelled sample host interval when no real booking
exists. It never seeds recipients or production booking rows.

The user explicitly clarified that the old Resend cap of 100/day was a
provider limit, not a recipient policy: the daily schedule should go to
everyone except those who have opted out of this specific email. The direct
daily send still honors `daily_schedule_email_preferences.enabled=false`,
validates addresses, includes a per-message unsubscribe URL and records each
attempt. This decision does **not** grant marketing campaign consent or alter
Plunk lifecycle targeting; never flip `marketing_email_enabled` in bulk.

Activation checklist: deploy the Vercel `main` build; wait for READY; inspect
`/admin/daily-schedule-email` preview and its audience/host counts; send
one fixed-inbox Plunk test with the sample host interval if the real count
is zero, then verify mailbox and Plunk/SES status. Deploy the Cloudflare
Worker separately with `wrangler deploy` from
`mysession-daily-email-cron/` and confirm hourly, 04:00 UTC and five-minute
triggers. Verify Worker `/health`, then authenticated `/run` with
`x-cron-secret` and confirm the daily-enabled audience and individual
opt-outs; never put the secret in URL or logs. Recheck daily opt-outs,
unsubscribe behavior, bounce rate, Plunk 422 errors and ledger rows daily
for the first several days. If the Worker cannot be deployed/verified, Git
push alone has **not** activated the new hourly schedule. See the project
context file's final section for exact code/test/rollback map.
