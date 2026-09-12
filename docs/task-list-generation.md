# Pro task list generation

Tasks → Generate · Pro (or Generate task list · Pro on mobile) opens a goal form.
Generate preview returns a draft without creating a focus plan or tasks.
The user can edit its title, add/remove/edit tasks, refine the goal and provide
adjustment instructions. Regenerate sends the CURRENT edited draft, goal and
instructions to AI. A failed regeneration preserves the current draft.
Quick instructions include more detail, more smaller steps and rethinking the
whole plan. Drafts support 1–30 tasks.

Only Approve & add list saves the exact visible title/tasks as a normal private
focus plan and selects it. Approval does not call OpenAI. Closing an unapproved
draft discards it. Existing Add list and manual task entry are unchanged.

## Deployment

Deploy frontend and `api/templates.ts` together. No database migration or new
dependency is needed. This reuses the existing server-only `OPENAI_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (entitlement lookup only), Supabase URL/anon key,
and `OPENAI_TASK_SUGGESTIONS_MODEL` / `OPENAI_MODEL` (fallback: gpt-4.1-mini).
Do not put OpenAI or service-role keys in VITE-prefixed variables.

POST `task-list-generate` takes a bearer JWT and a 10–2000 character `goal`.
Regeneration also takes the current `draft: {title, tasks}` and nonempty
`adjustment` instructions up to 2000 characters. It returns `{draft}` only.
POST `task-list-approve` takes the edited `draft` and a UUID-v4 `requestId`;
it validates 1–30 nonempty tasks (max 300 characters) and a title (max 120).
Both actions enforce Pro access. User identity comes from auth.getUser, never
the request body. The server checks the same Pro entitlement rules as existing
AI Suggestions (active/trialing Pro monthly/yearly, lifetime, founding access).
All task writes use the caller's JWT and existing table ownership RLS.

OpenAI receives the goal and, when regenerating, the visible draft and adjustment
instructions; no other tasks/profile information is sent. store:false is requested.
Responses must match a strict schema and pass runtime validation.
Generation (including provider errors/refusals/incomplete output) never writes
to task tables. Deploy frontend and API together: the generate action no longer
returns a saved list.

## Persistence and retries

The UI locks all actions synchronously. Approval snapshots the edited draft
and generates its request ID. An ambiguous save failure freezes editing and
regeneration until Retry Approve confirms the same snapshot using the same ID.
A completed saved request is returned without another OpenAI request.
Task IDs are deterministic per plan/index.
An interrupted empty parent can be recovered, and duplicate task IDs are ignored.

Parent and bulk task writes are separate requests, not one database transaction.
A confirmed SQL task failure attempts to remove the newly-created empty parent.
An ambiguous transport failure never deletes a possibly committed result.
Reloading/closing the dialog starts a new draft; users should retry approval in
the same dialog after a save timeout to recover its result. Generation has a 25-second provider
timeout, input/output bounds, but no new account-wide generation quota.

## Verification

- `node --test scripts/test-task-list-generation.mjs`
- `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck api/templates.ts`
- `npx vite build`
- `git diff --check`

After deployment, smoke-test with actual Free and Pro sessions: direct API denial
for Free, preview/regeneration without persisted rows, manual edits then approval
and reload persistence for Pro, mobile access, and retry after a dropped save
response. Automated API tests use
mocked Supabase/OpenAI and do not prove deployed credentials or RLS configuration.
