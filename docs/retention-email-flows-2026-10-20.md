# MySession retention email implementation and continuation

## Project map
Repository: Lukasso7788/my-session, deploy branch main. Base d9d8a177fbb16bc43463fa30f49e92cc3c0333f3. Worktree C:/projects/my-session/.codex-retention-emails, branch codex/retention-email-flows. Preserve dirty parent checkout and other isolated worktrees (music/reconnect are unrelated).

MySession is a React 18/TypeScript/Vite coworking app. src/pages holds routes, src/pages/RoomPageLiveKit.tsx orchestrates LiveKit, src/components holds shared UI, src/lib holds frontend policies. api contains Vercel Node handlers. Supabase provides Auth, Postgres, Storage; migrations are in supabase/migrations. Supabase production project cxqgzcjsjyszcbcbdusp. Vercel project prj_DBd5YBg9YtKBhlhPoaQKXo1SX5cx, team team_4Dvl33owNJ0TlIqwLeNmmWFs, domains mysession.club/www.mysession.club. Full build prerenders and verifies public SEO pages and articles.

## Email architecture
Existing daily schedule: Cloudflare mysession-daily-email-cron -> api/livekit/admin.ts daily_schedule_send_all_active -> api/_lib/plunk.ts -> self-hosted Plunk. Remains at 07:00 Europe/Kyiv with DST guard, all daily-enabled users.
Existing legacy email_event_outbox / sender.ts / plunkLifecycle.ts is a separate event/workflow path. It has a historical pending backlog and is not activated or replayed by this change. Do not enable that evaluator concurrently for these scenarios without de-duplicating workflows.

New flow: existing Cloudflare worker every five minutes -> POST /api/retention -> current SQL eligibility -> atomic per-user claim -> revalidation -> exact HTML renderer -> Plunk /v1/send -> durable outcome ledger. Sender is not used. Existing DAILY_SCHEDULE_CRON_SECRET authenticates this endpoint and signs unsubscribe tokens; no new secret needed.

## Seven templates / six scenarios
- first_session: confirmed signup >=24h ago, no attendance and no future scheduled booking. One logical email per user; includes old unactivated accounts only if explicitly opted in.
- second_session: exactly one qualified visit (>=10min), last visit 24h–7d ago, no recent activity/future booking.
- return_7: seven days without attendance, no upcoming booking. First reminder per inactivity episode, including opted-in existing users.
- return_14: >=14d inactive, only after return_7 was accepted >=7d ago; no third or 30-day reminder. New actual attendance produces a new episode key.
- missed_session: booked scheduled session ended 2–30h ago and after rollout start, no attendance/future booking. Infinite rooms excluded.
- booking_reminder: confirmed booking starts in 5–20min, not cancelled/closed/ended, no active attendance. Skip if reminder_30m_sent_at already populated. Uses explicit booking start/end when supplied.
- weekly_recap: Monday, seven days of rollout history available, qualifying attendance in past week. Actual minutes clipped to week start/now; labelled minutes in sessions, not tasks completed. Infinite room repeat visits grouped by room and UTC date.

Marketing flows require email_automation_preferences.marketing_email_enabled=true AND lifecycle/category preference AND no new opt-out AND Plunk subscribed=true/not snoozed. Missing marketing consent does not authorize a send. Booking reminders use their separate reminder preference. No contacts are created or resubscribed.
At inspection: 62 preference rows, one explicit marketing opt-in, zero currently eligible candidates. These are time-sensitive measurements, not promises about future recipients.

Marketing send window 09:00–18:00 in profile/preference timezone (validated IANA, UTC fallback), respects custom quiet hours. At most one new marketing send per 24h; daily digest ledger counts toward cap. A due personal email excludes that user from the generic digest, and accepted/processing/uncertain retention sends suppress digest for 24h. Booking reminders are transactional and exempt from marketing cap.

## Implementation files
- api/_lib/retentionTemplates.ts: single source for production and preview HTML/text; 7 copy variants, safe escaped user content, allowed HTTPS MySession links, table email layout, blue accents, Inter/Arial stack, one-click unsubscribe footer. No invented attendance/tasks.
- api/_lib/retentionDelivery.ts: exact contact lookup, durable claim/recheck/send/status, bounded batch/deadline; counts-only responses. Plunk keys remain server-only.
- api/retention.ts: shared-secret protected POST run/dry-run. Signed unsubscribe GET displays confirmation; POST records opt-out. GET never changes preference. No cross-origin wildcard CORS.
- migration 20261020180417_retention_email_flows.sql: retention_email_config, retention_email_opt_outs, retention_email_sends; RLS enabled, access only service_role. Private SECURITY DEFINER functions with fixed search_path, revoked public execution, narrow public invoker wrappers. Atomic user advisory lock and unique logical_key prevent racing sends.
- api/livekit/admin.ts: checks retention_digest_exclusions before daily selection.
- mysession-daily-email-cron: RETENTION_EMAIL_URL and five-minute invocation, reuses existing daily secret, logs counts/codes only.
- scripts/preview-retention-emails.mjs: generates all seven HTML and text previews + responsive-switching gallery; fixture data is explicitly identified as demo.
- scripts/serve-retention-previews.mjs: localhost-only preview server, whitelisted static names, port 4212.
- api/_lib/retention.test.mjs: render/link escaping, signed unsubscribe, provider suppression, idempotency headers, dry-run no sends, send-time cancellation, acceptance vs uncertainty.

## Delivery semantics
accepted means Plunk API acceptance, not inbox delivery. Transport ambiguity or crash is uncertain and must be reconciled in Plunk before any manual resend. Failed/cancelled/accepted/uncertain logical emails are not automatically replayed. This deliberately avoids sending twice after process failure. No blind replay of historical Sender events.
Processing rows older than 10 minutes are marked uncertain when the same user is claimed again. Retain ledger for audit; no deletion job introduced. Batch default 20; local quiet users do not consume the successful-claim batch cap. No marketing holdout/attribution experiment was added.

## Verification and release checklist
Read-only production schema inspected. Migration applied with config.enabled=false. SQL query returned zero eligible candidates. Verified RLS=true, anon ledger SELECT=false, anon candidates EXECUTE=false, authenticated claim EXECUTE=false. Transactional synthetic auth fixture proved first-session eligibility, marketing opt-out and retention unsubscribe; ROLLBACK removed all test data/events.
Seven new delivery tests passed, seven existing Plunk transport tests passed, six worker tests passed. Targeted TypeScript API check passed. Full frontend/SEO build passed (52 URLs). Gallery serves HTTP 200 at http://127.0.0.1:4212/.
Vercel connector can access correct project; local CLI identity could not access the project team. Cloudflare CLI OAuth resolves expected account 0fa940b9ed26e2a076b05a9676a97911. Prefer connector for Vercel release.

Release order: tested code commit/push; Vercel production deployment READY; verify unauth endpoint 401 and unsubscribe invalid token 400; Cloudflare deploy --keep-vars; set retention_email_config.enabled=true only after both deployments succeed. Then verify scheduled counts and DB outcome ledger without triggering an arbitrary bulk send.
Pause: update public.retention_email_config set enabled=false where id=true. Do not toggle existing daily/Sender cron secrets.
See final chat response for actual release status and remaining blockers. A source commit is not proof production or cron was deployed.

## Current handoff status
Implementation commit caed82e is pushed only to codex/retention-email-flows. Automatic approval review rejected the main push because the current request did not explicitly authorize the production release. No connector/alternate route was used to bypass that rejection. Vercel and Cloudflare releases remain pending; config.enabled remains false, so no new retention email was sent.
Production Vercel metadata confirms PLUNK_API_URL, PLUNK_SECRET_KEY, PLUNK_FROM_EMAIL, PLUNK_FROM_NAME, DAILY_SCHEDULE_CRON_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. No secret values were printed. The Cloudflare CLI can deploy the expected account once release is approved.
Additional rollback-only SQL fixture passed: first atomic claim succeeds, second concurrent/logical claim is blocked, accepted email is not offered again. All synthetic auth/profile/preference/ledger changes rolled back. Security advisors report RLS-without-policies on the three new tables: intentional deny-all for client roles, service_role-only access independently verified. No new exposed public SECURITY DEFINER routine was introduced; private routines have restricted EXECUTE.
The older RLS/security findings in unrelated database tables/functions were not changed by this feature.
Preview gallery verified HTTP 200 at port 4212; port 4211 attempt was replaced. Open outputs/retention-email-previews/index.html or rerun the generator/server if needed.
