# Sender lifecycle email integration

## Architecture

MySession owns facts and eligibility. Sender owns email templates, delays, conditions, delivery, opens/clicks and unsubscribe handling.

`Supabase trigger / Stripe webhook / nightly evaluator -> email_event_outbox -> existing /api/livekit/admin function -> Sender custom event -> Sender workflow`

The Sender token is server-only. A Sender failure never blocks registration, booking, attendance, or payment. Resend remains responsible for the existing daily schedule email and Supabase remains responsible for authentication/security messages.

## Manual setup order

1. Create a Sender account and go to **Account settings -> Domains -> Add domain**. Verify an address on `mysession.club`.
2. Add the exact SPF, DKIM and DMARC values shown by Sender to the DNS provider. If an SPF TXT record already exists, merge `include:sendersrv.com` into it; never create two SPF records. Wait until Sender shows green checks for all records.
3. In **Settings -> API access tokens**, create a token named `MySession production lifecycle`. Copy it once into Vercel; never place it in a `VITE_` variable or Cloudflare's public vars.
4. In Sender **Subscribers -> Groups**, create the groups below and copy each generated group ID. Then open **Subscribers -> Fields** and create the custom fields below.
5. In Sender **Custom events**, create every Phase 1 event below using the exact lowercase identifier. These identifiers use letters and underscores only because Sender rejects digits in custom-event names. Sender event names cannot be renamed later.
6. Create workflows in DRAFT state. Do not activate them yet.
7. Add the Vercel environment variables with `SENDER_INTEGRATION_ENABLED=false`, deploy the application, then configure and deploy the Cloudflare Worker.
8. Only after the application is deployed, run `supabase/migrations/20260719_sender_lifecycle_email.sql` once in Supabase SQL Editor. MySession never applies this migration automatically.
9. Test with a dedicated email address. Confirm the outbox event first, then enable Sender and activate one workflow at a time.

## Sender groups

Required:

- `mysession_all_users` -> `SENDER_DEFAULT_GROUP_ID`
- `mysession_marketing_opt_in` -> `SENDER_MARKETING_GROUP_ID`

Recommended plan groups:

- `mysession_free` -> `SENDER_FREE_GROUP_ID`
- `mysession_trial` -> `SENDER_TRIAL_GROUP_ID`
- `mysession_pro` -> `SENDER_PRO_GROUP_ID`

The integration adds subscribers to configured groups and does not remove unrelated/manual Sender groups.

## Sender custom fields

Create text fields with these handles:

- `user_id`
- `timezone`
- `plan`
- `signup_date`

The API sends them as `{$user_id}`, `{$timezone}`, `{$plan}`, and `{$signup_date}`.

## Custom events

Create these Phase 1 event containers now. Copy the identifiers exactly; none contains a digit:

- `user_registered`
- `registration_stalled`
- `session_booked`
- `session_cancelled`
- `session_no_show`
- `first_session_completed`
- `second_session_completed`
- `session_completed`
- `weekly_recap_ready`
- `inactive_seven_days`
- `inactive_fourteen_days`
- `inactive_thirty_days`
- `free_limit_warning`
- `free_limit_reached`
- `checkout_started`
- `subscription_started`
- `trial_ending_forty_eight_hours`
- `payment_failed`
- `payment_recovered`
- `subscription_cancelled`
- `subscription_reactivated`

Reserved for later product triggers; you may create these now, but Phase 1 does not emit them yet:

- `pricing_viewed`
- `trial_started`
- `trial_ended`
- `host_candidate_detected`
- `referral_candidate`
- `referral_signup`
- `testimonial_candidate`
- `technical_issue_resolved`

`subscriber_preferences_updated` is internal outbox work, not a Sender custom event. Do not create an event container for it.

## Vercel environment variables

### Get the Sender API token

1. Open Sender and select **API access tokens** in the left settings menu (Sender also documents this as **Settings -> API access tokens**).
2. Click **Create API token**.
3. Name it `MySession production lifecycle` and create it.
4. Copy the token immediately and store it in a password manager. Sender may not show the full value again.
5. Use the raw token as `SENDER_API_TOKEN`. Do not add `Bearer`, quotes, spaces, or a trailing newline.

### Get the five Sender group IDs

First create these groups in **Subscribers -> Groups**:

- `mysession_all_users`
- `mysession_marketing_opt_in`
- `mysession_free`
- `mysession_trial`
- `mysession_pro`

The reliable way to retrieve every ID is Sender's read-only groups endpoint. In PowerShell, run:

```powershell
$senderToken = Read-Host "Paste the Sender API token"
$headers = @{ Authorization = "Bearer $senderToken"; Accept = "application/json" }
(Invoke-RestMethod -Uri "https://api.sender.net/v2/groups?limit=100" -Headers $headers).data |
  Select-Object title, id
$senderToken = $null
$headers = $null
```

The output contains a `title` and an `id`. Copy only the `id` belonging to each exact group name. An ID is a short Sender identifier such as `elxJK6`; it is not the group title and not the whole dashboard URL.

Map the IDs as follows:

```text
mysession_all_users       -> SENDER_DEFAULT_GROUP_ID
mysession_marketing_opt_in -> SENDER_MARKETING_GROUP_ID
mysession_free            -> SENDER_FREE_GROUP_ID
mysession_trial           -> SENDER_TRIAL_GROUP_ID
mysession_pro             -> SENDER_PRO_GROUP_ID
```

If the command returns `401`, create a fresh API token and make sure only the raw token was pasted at the prompt.

### Generate CRON_SECRET

`CRON_SECRET` does not come from Sender, Vercel, or Cloudflare. Generate it once yourself. In PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the single resulting line into a password manager. Use that exact same value in both places:

- Vercel variable `CRON_SECRET`;
- Cloudflare Worker secret `SENDER_CRON_SECRET`.

Do not generate two different values and do not put this value in the repository.

### Add the variables in Vercel

1. Open Vercel and select the team that owns MySession.
2. Open the MySession project.
3. Open **Settings -> Environment Variables**.
4. Add each variable below. Select **Production** for every one. Preview and Development are optional; do not enable Sender in Preview while testing production.
5. Mark `SENDER_API_TOKEN` and `CRON_SECRET` as sensitive/secret values if the Vercel UI offers that option.
6. Group IDs are identifiers rather than credentials, but keeping all values in Environment Variables makes configuration consistent.

```text
SENDER_INTEGRATION_ENABLED=false
SENDER_API_TOKEN=<raw Sender API token>
SENDER_DEFAULT_GROUP_ID=<ID of mysession_all_users>
SENDER_MARKETING_GROUP_ID=<ID of mysession_marketing_opt_in>
SENDER_FREE_GROUP_ID=<ID of mysession_free>
SENDER_TRIAL_GROUP_ID=<ID of mysession_trial>
SENDER_PRO_GROUP_ID=<ID of mysession_pro>
CRON_SECRET=<the generated 32-byte random secret>
APP_URL=https://mysession.club
```

`APP_URL` is the literal production origin shown above; it is not an API key. None of these server-side names may start with `VITE_`.

Start with `SENDER_INTEGRATION_ENABLED=false`. The outbox will collect idempotent events but the processor will not contact Sender. Environment changes do not affect old Vercel deployments, so deploy or redeploy after saving them. Change the flag to `true` only after the domain, groups, fields, events, and first workflow are ready, then redeploy again.

`VITE_PAYWALL_ENABLED` also controls delivery of `free_limit_warning` and `free_limit_reached`. When the product paywall is off, those queued events are cancelled instead of being sent.

## Vercel function budget

Sender adds **zero** new Vercel Functions. The repository remains at the existing limit of 12:

- lifecycle evaluate/process cron: multiplexed into `POST /api/livekit/admin?senderAction=evaluate`;
- Sender admin list/retry: multiplexed into `POST /api/livekit/admin`;
- user preferences: direct Supabase access protected by row-level security;
- scheduling: the existing `mysession-daily-email-cron` Cloudflare Worker.

Do not recreate the removed `/api/sender/*` files: each file would consume another Vercel Function.

## Cloudflare Worker secrets

The existing `mysession-daily-email-cron` worker now also calls the Sender evaluator on its existing daily schedule.

Deployment status (2026-07-19): the updated Worker is deployed at `https://mysession-daily-email-cron.lukasus7788.workers.dev`, `/health` returns `ok`, and both schedules are active (`0 4 * * *` and `*/5 * * * *`). Do not create another Worker. The only remaining Cloudflare configuration is the secret below.

Only one new Cloudflare secret is required. It intentionally has a different variable name from Vercel, but its value must be identical.

Dashboard method:

1. Open Cloudflare -> **Workers & Pages**.
2. Select `mysession-daily-email-cron`.
3. Open **Settings -> Variables and Secrets**.
4. Click **Add**, choose **Secret**, and use the name `SENDER_CRON_SECRET`.
5. Paste the exact value stored in Vercel as `CRON_SECRET`.
6. Save/deploy the new Worker version.

Alternatively, use Wrangler from the repository:

```powershell
cd mysession-daily-email-cron
npx wrangler secret put SENDER_CRON_SECRET
```

When Wrangler prompts for a value, enter exactly the same value as Vercel `CRON_SECRET`, then deploy the Worker code:

```powershell
npx wrangler deploy
```

`SENDER_LIFECYCLE_URL` is already declared as `https://www.mysession.club/api/livekit/admin?senderAction=evaluate`. The Worker uses the same URL with two modes:

- `senderAction=process` every five minutes for near-real-time outbox delivery;
- `senderAction=evaluate` daily at 04:00 UTC for inactivity, no-show, trial and recap evaluation, followed by delivery.

The manual protected worker route is `/run-sender` (evaluate + process). Use `/run-sender?action=process` to process the existing queue without running the evaluator.

## Stripe webhook check

In Stripe Dashboard, open the existing webhook for `https://www.mysession.club/api/stripe/webhook` and make sure it receives:

- `checkout.session.completed`
- `invoice.payment_failed`
- `invoice.paid`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Do not create a second webhook if the current endpoint already receives all events.

## Phase 1 workflows in Sender

### 1. Welcome and activation

Trigger: `user_registered`, repeat disabled.

1. Delay 3 minutes.
2. Email: `Welcome to MySession — let’s complete your first focus session`.
3. Delay 21 hours.
4. Condition: subscriber has not triggered `first_session_completed`.
5. Yes -> email: `Your first session can be just 25 minutes`.
6. Delay 2 days.
7. Condition again; Yes -> `Need help getting started?`; then end.

Use `https://mysession.club/sessions` for **Find a session** and `https://mysession.club/sessions?tab=infinite` for **Join an infinite room**.

### 2. Booking

Trigger: `session_booked`, allow repeat.

Send an immediate confirmation using `session_title`, `session_start`, `duration_minutes`, `session_format`, and `session_url`. Do not build 24h/60m reminders as fixed delays from the booking event: bookings can occur after those thresholds. For exact reminders, add a later scheduled reminder evaluator or date field workflow. Phase 1 sends confirmation only.

### 3. No-show recovery

Trigger: `session_no_show`, allow repeat.

1. Email immediately: `Missed today’s session? Here are two more options`.
2. Link to `sessions_url` and the Infinite Rooms tab.
3. Optional delay 3 days and one final email; no more messages in this branch.

### 4. First session to second session

Trigger: `first_session_completed`, repeat disabled.

1. Delay 30 minutes.
2. Celebration email using `focused_minutes`.
3. Delay 2 days.
4. Condition: no `second_session_completed`; Yes -> momentum email.
5. Delay 3 days; repeat the condition; Yes -> final return email.

### 5. Inactivity

Create separate workflows for `inactive_seven_days`, `inactive_fourteen_days`, and `inactive_thirty_days`. Send one email per workflow and do not add a repeating delay loop. MySession creates a new idempotent inactivity period only after the user becomes active and then lapses again.

### 6. Free limit

- `free_limit_warning`: `You have one free session left` using `free_sessions_remaining`.
- `free_limit_reached`: show `session_count`, total value, and `upgrade_url`.

The current product limit is 15 lifetime sessions, not the old weekly limit. Do not use “this week” in these templates.

### 7. Weekly recap

Trigger: `weekly_recap_ready`, repeat enabled. Use `session_count`, `focused_minutes`, `week_start`, and `sessions_url`.

### 8. Revenue lifecycle

- `subscription_started`: welcome to Pro; link to sessions and pricing/account management.
- `trial_ending_forty_eight_hours`: warn that the trial ends within 24–48 hours and link to `upgrade_url`.
- `payment_failed`: immediate action-oriented recovery email. A second message can be added after 3 days with a condition that `payment_recovered` has not occurred.
- `payment_recovered`: terminate/suppress the failed-payment branch.
- `subscription_cancelled`: confirm cancellation and show `access_ends_at`.

## Consent and preferences

The user page is `/settings/email`.

- Lifecycle defaults on.
- Marketing defaults off and requires explicit opt-in.
- Weekly recap, session reminders and reactivation can be disabled independently.
- Authentication/security emails are outside Sender and cannot be disabled here.
- Never backfill marketing contacts without consent.
- Every Sender marketing template must contain Sender's working unsubscribe link.

## Admin diagnostics

Admins can open `/admin/sender-email` to:

- see event type, status, attempts, timestamps, a truncated last error, and retry failed/dead events;
- manually process up to 100 pending outbox rows;
- run the complete Sender automation test suite against a dedicated test inbox.

The test suite uses the existing `/api/livekit/admin` function, so it consumes no additional Vercel Function. It requires app-admin authentication and a second explicit confirmation value on the server. It synchronizes the test subscriber once, then emits every supported custom event with realistic placeholder properties and a unique `test_suite_id`. Events are sent with concurrency limited to four requests. Recipient email and full production payloads remain omitted from the outbox table.

The existing Resend daily-schedule test remains at `/admin/daily-schedule-email` and is linked from the Sender diagnostics page. Supabase authentication/security messages must be tested from the Supabase email-template and authentication flow because they are intentionally outside Sender.

Users manage consent and categories at `/settings/email`. This page writes directly to the RLS-protected preferences table and consumes no Vercel Function.

## Test procedure

1. Keep all Sender workflows in DRAFT and `SENDER_INTEGRATION_ENABLED=false`.
2. Apply SQL and deploy app/worker.
3. Confirm booking a test session creates one `session_booked` row in `email_event_outbox`.
4. Repeat the same action/retry and confirm the unique idempotency key prevents duplicates.
5. Enable Sender integration, redeploy, and publish only the workflows currently under test.
6. Open `/admin/sender-email`, enter a dedicated test inbox, and click **Send all test events**.
7. Confirm the warning. The page must show a green result for every event accepted by Sender. A green result proves API acceptance; actual email delivery still requires a published Sender workflow for that event.
8. Check the dedicated inbox and Sender workflow activity. Use the displayed `test_suite_id` to correlate one run.
9. Click **Process pending** to test the real outbox processor separately.
10. Test a temporary invalid token: the row must become `failed`, core booking must still succeed, and Retry must work after restoring the token.
11. Test all preference switches and verify disabled categories do not enqueue new rows.
12. Only then activate production workflows one by one.

## Backfill

Do not backfill automatically. For lifecycle contacts, insert explicit outbox events with unique keys prefixed `backfill:` and keep subscriber creation `trigger_automation=false`. Never include users with marketing disabled in marketing groups or marketing events.

## Rollback

1. Set `SENDER_INTEGRATION_ENABLED=false` and redeploy. This immediately stops external Sender API calls while retaining queued rows.
2. Pause all workflows in Sender.
3. If required, disable the Cloudflare cron call by removing its Sender secrets or URL.
4. The existing product, Resend daily schedule email, Supabase auth email, bookings, attendance, and Stripe processing continue independently.
5. Do not drop the tables during an incident; they are the delivery audit trail.
