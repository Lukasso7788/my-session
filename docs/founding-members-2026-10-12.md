# Founding Member Pro — architecture, authority and continuation

Date: 2026-10-12. Project-wide context: my-session-project-context.md. Existing
allowance/cancellation feature: billing-session-notice-2026-10-12.md.

## Current applied status (supersedes the historical draft below)

Production grants committed at 2026-10-12 08:51:06 Kyiv: **481 FM Pro accounts**
and **one six-month complimentary Pro** grant. No excluded/zero-attendance FM
grant and no unrequested entitlement change were found in the independent
before/after comparison. The temporary grant ends on **2027-04-12 08:51:06 Kyiv**.

The owner resolved the ambiguous/duplicate-name accounts and subsequently
confirmed **both remaining disputed accounts as excluded**; a fresh production
read confirmed neither has FM Pro or a founding grant timestamp. No extra grant
or revocation was needed. All identity mapping stays in the private audit.
A Stripe-linked Pro
account is unchanged, pending billing/grant direction. Never silently cancel charges.

The owner requested commit and push to main on 2026-10-12. Release subject:
feat(billing): add Founding Member Pro and subscription controls. Check Git history
and origin/main for the exact release SHA; no direct deployment promotion ran.
Live DB access is already applied; the new badge's production rollout requires
independent deployment verification. The paywall was not activated. No real
Stripe mutation/payment/portal ran.

## Latest owner instruction: do not invert the audience

- The pasted list of 64 lines is an **exclusion list**, NOT a grant list.
- Exclude users whose canonical attended-session count is zero as well.
- Other existing attendees are intended to receive free permanent Pro under a
  distinct Founding Member plan, shown as **FM Pro** in the header.
- One recipient has a separate six-month complimentary Pro instruction. Never use
  founding_free or lifetime for that temporary exception.
- Paid/purchased Lifetime remains a distinct plan. Do not cancel existing
  Stripe subscriptions, change billing details, activate the paywall, deploy,
  commit or push without the corresponding authority.
- Exact recipient entitlements and the private founding plan display name were
  updated in one guarded transaction. The complimentary expiry job was scheduled
  in that transaction. No profiles/subscriptions/payments were changed.

## Workspace

Checkout: C:\projects\my-session\.codex-safe-billing-session-notice.
Branch: codex/billing-session-notice, base b66f09a. This branch contains only the
focused billing release. Root checkout and separate video work remain untouched.
Do not blanket-stage generated sitemap XML/stat-only changes.

## Live data model (verified)

Supabase MySession: cxqgzcjsjyszcbcbdusp; use the account link named Supabase.
Authorization source is public.user_entitlements, not editable Auth metadata.
The existing private billing_plans row already has code founding_free, price 0,
billing_interval none, is_active true, is_public false and unlimited limits.
Do not invent a duplicate enum/plan. Its DB display name is now Founding Member
Pro; all price/public/interval/limit settings remain unchanged.
Purchased lifetime remains code lifetime, price 300 and a public plan.

user_entitlements supports free/pro_monthly/pro_yearly/lifetime/founding_free
and active/trialing/expired/canceled. It has a unique user_id, period dates,
founding_granted_at, lifetime_granted_at, source, notes, force_paywall and Stripe
linkage. Only an updated_at trigger exists on this table; no profile-sync trigger
was found. Any profile projection updates must be deliberate and verified.

Canonical count is calculate_lifetime_session_count(user_id): distinct scheduled
sessions with a joined_at, plus rows in infinite_room_daily_attendance. Infinite
room entries count once per room/local day. Do not use cached profile counts or
bookings as grant eligibility. Auth users without a profile still exist; do not
create/delete profiles as an incidental grant operation.

## Historical read-only audience snapshot (before owner clarification)

678 Auth accounts; 546 with canonical attendance >0 and 132 with count 0.
57 of 64 list lines have direct normalized-name/email matches. They map to 60
distinct accounts; repeated Sofia lines overlap. Other names have possible
abbreviated aliases, not confirmed identities. Names are normalized only for
candidate discovery; NEVER grant based on a fuzzy guess.

Clarification was requested for abbreviated and duplicate display names.
Other duplicate matches include one zero-attendance
account, which is excluded independently. Seven shorter/alias names require
careful identity review; their candidate details are in a PRIVATE local report.

A conservative preview holds out ALL exact/possible exclusion candidates:
69 accounts held out, 65 with attendance; 481 remaining attendees, 480 without
any stored Stripe subscription link. This is a DRAFT, not an approved final count.
One possible recipient has a stored Stripe subscription link. Preserve that
person's current paid plan/billing until the owner decides how the free grant
should interact with the subscription. Never silently stop renewal or clear IDs.

Private review (contains names/emails/UUIDs, deliberately outside Git):
C:\Users\misha\.codex\visualizations\2026\09\08\01a08286-eb98-7cf2-b791-de2d118d1093\mysession-attendance-2026-10-12\founding-members-exclusions-review.md

## Implemented local presentation

- src/lib/membershipPresentation.ts: pure getMembershipBadge and plan-name
  helpers. Signed-out => no badge; resolved non-unlimited => Free; active
  founding_free => FM Pro; other unlimited plans => Pro.
- Header uses that resolved access; the badge sits after the wordmark with
  content-sized positioning and no wrapping. Founding and purchased Lifetime
  have distinct popover text. No new admission or payment behavior.
- SubscriptionCard calls the shared plan-name helper. Founding Member Pro
  explicitly describes free permanent access separately from purchased Lifetime.
- Browser fixture includes an FM Pro state and a badge generated by the same
  helper. It makes no live Auth/billing calls.

## Temporary access: implemented canonical lifecycle

hasUnlimitedAccess currently relies on plan/status, not current_period_end.
api/templates.ts intentionally uses the same plan/status convention. Merely
setting six months in current_period_end would NOT reliably expire temporary Pro.
No expiry job existed initially. This was addressed with the narrowly scoped
`expire-complimentary-pro` job, ID 4, every minute as postgres. It changes status
to expired ONLY for source admin_complimentary_pro, recurring Pro codes, active/
trialing status, a non-null due period end, and no Stripe subscription ID. It
never touches founding_free, lifetime, paid Stripe sources or linked subscriptions.
The existing status-based frontend/server access checks are unchanged.
The first two inspected production runs succeeded with UPDATE 0 (not due yet).
Expiry resolution is minute-level; existing client result caches can add up to
two minutes before an old displayed state refreshes.

Migration source (created with Supabase CLI 2.75.0):
supabase/migrations/20261012054501_complimentary_pro_expiry.sql.
It records the idempotent job configuration and plan name, NO recipient IDs.
The SQL was applied directly with execute_sql; remote migration history was
NOT marked/repaired. Reapplying the migration only replaces the named job and
updates the plan name; it cannot regrant or extend the recipient's access.

supabase/tests/complimentary_pro_expiry.sql exercises the exact job predicate
against ten temporary fixture rows in a rolled-back transaction. Expired/boundary
grants change; future, paid, linked, permanent, missing-end and canceled rows do
not. No fake users or permanent test records were created in production.
Existing paid Stripe period timestamps can be stale/approximate; do NOT globally
tighten all Pro expiry checks and accidentally revoke real paid memberships.

## Checks for current presentation changes

- 24 isolated billing tests pass, including FM Pro vs purchased Lifetime naming,
  canceled/signed-out badge behavior, complimentary-Pro naming and the existing
  allowance/cancel-flow checks. The temporary SQL fixture assertions also passed.
- Full npm.cmd run build passes, including all SEO/prerender verifiers.
- Focused ESLint: zero errors, only test-entry Fast Refresh warning.
- Baseline-comparison TypeScript check: 45 baseline / 44 current diagnostics,
  zero introduced. Whole-repo typecheck still has old project-reference issues.
- FM Pro fixture DOM shows correct badge/name, no allowance warning, no desktop
  horizontal overflow; screenshot succeeded and was inspected this turn.
- React best-practices review: pure derived presentation, no extra fetch/hooks
  or entitlement policy; accessible existing controls preserved.
- Complimentary active/ended and FM Pro browser fixture states were checked:
  active grant shows its end date and no recurring billing; ended grant shows
  Free badge; FM Pro suppresses the free-session warning. No desktop overflow.
- user_entitlements has RLS enabled with authenticated SELECT ownership
  auth.uid()=user_id; no authenticated UPDATE/INSERT policy was found. This task
  did not add tables, functions, public privilege grants or RLS policies.
- Supabase security advisors returned existing warnings on other public views/
  functions and Auth password protection. They were not changed by this task;
  this is not a claim that the whole project is security-clean. References:
  [Definer views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view),
  [Public definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Recovery and precise operation audit

Private directory (never track in Git):
C:\Users\misha\.codex\visualizations\2026\09\08\01a08286-eb98-7cf2-b791-de2d118d1093\mysession-attendance-2026-10-12

- founding-grant-before.json: exact frozen UUIDs, exclusions and prior full
  entitlement records, plus previous billing-plan rows.
- founding-grant-operation.sql: scoped guarded transaction. Before-row snapshots,
  canonical attendance, exclusions and paid-plan guards are rechecked; changed
  count must equal expected size or the entire transaction rolls back.
- founding-grant-after.json: independently read resulting records and counts.
- founding-grant-completed.md: names/emails and complete granted cohort/report.

The first attempt hit SQL NULL vs JSON-null mismatch on a missing temporary
entitlement and rolled back before any writes; absence of grants/job was checked.
The corrected transaction then committed. Do not blindly rerun this operation:
it would fail snapshot guards and could extend temporary access if rewritten.

## Next safe step

Resolve the retained Stripe-linked Pro account; both disputed accounts are resolved
and must remain excluded. Modify only the specific account if the owner authorizes it,
never repeat the batch.
Review local UI/billing diff, verify Stripe test portal configuration, and commit/
push/deploy only if requested. Paywall activation remains a separate owner action.
Keep all recipient exports and recovery snapshots outside the repo.
