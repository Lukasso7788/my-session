# Plunk phase 1 / admin test handoff

## Architecture and scope
Active checkout: C:\Users\misha\.codex\worktrees\monthly-attendance\my-session.
Branch: codex/session-milestone-tree-badges; main is the deployment destination.
Do not overwrite the old, dirty C:\projects\my-session checkout.

api/livekit/admin.ts direct invitation and daily schedule email sends now use
api/_lib/plunk.ts. POST server-only PLUNK_API_URL/v1/send, bearer PLUNK_SECRET_KEY,
from PLUNK_FROM_EMAIL and PLUNK_FROM_NAME. Existing content, reply-to and normal
daily audience/scheduling remain unchanged. Legacy resendId/resend_id names remain
for compatibility. No database migration. No other active Resend sender was found
under api/ or supabase/ in this checkout; dependencies/global env are not removed.
Sender lifecycle, api/_lib/sender.ts, email_event_outbox and Auth emails are untouched.

## Admin test
/admin/daily-schedule-email contains a separate Plunk test section.
Select the schedule date, Preview email, then Send test via Plunk.
Recipient is server-fixed to lukasus7788@gmail.com; existing assertAppAdmin validates
access before any test. The existing schedule template is reused with a TEST subject
and inert subscription footer; preview and send do not scan/change the audience or
write daily delivery/preferences records. The date uses existing UTC day bounds;
displayed times use Europe/Kyiv. This previews that day's schedule, not a rolling
future window. Empty dates are represented honestly by the existing template.

The server rebuilds HTML and verifies its SHA256 preview hash before sending.
If sessions changed, preview again. A UUID is allocated once per preview and reused
after failed sends; Plunk gets a stable Idempotency-Key. A synchronous UI ref blocks
duplicate clicks. HTTP success AND success:true are required. Acceptance is not proof
of inbox delivery. A reused key/ambiguous timeout must be checked in Plunk before a
new preview/send. Errors are sanitized; the API key is never returned/logged.

## Deployment and verification
Deploy main with server-side PLUNK_API_URL=https://mail-api.mysession.club,
PLUNK_SECRET_KEY, PLUNK_FROM_EMAIL=hello@updates.mysession.club and
PLUNK_FROM_NAME=MySession. No VITE_PLUNK secrets. Verify sender domain/SES production
permissions in Plunk, open admin, preview and explicitly send the test. Check Plunk
delivery logs plus inbox/spam. No live email has been sent during implementation.

Target checks: node --test api/_lib/plunk.test.mjs; targeted API TypeScript check;
production Vite build; git diff --check.

Actual results: 7/7 transport tests passed; targeted API TypeScript passed; app
TypeScript baseline comparison HEAD=251, working=251, new=0; Vite build passed;
diff check passed. ESLint: new helper clean; admin page has the same 11 existing
no-explicit-any errors as HEAD, no additions. Existing bundle-size/browser-data
warnings remain. No browser end-to-end or live Plunk/SES delivery verification was
performed. Confirm actual self-hosted /v1/send payload compatibility (including
reply field) with the explicit test before relying on production delivery.
