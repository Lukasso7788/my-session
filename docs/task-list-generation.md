# Pro task list generation

Tasks → Generate · Pro (or Generate task list · Pro on mobile) opens a goal form.
Submitting creates a normal private focus plan and 3–12 editable tasks, then
selects that list. Existing Add list and manual task entry are unchanged.

## Deployment

Deploy frontend and `api/templates.ts` together. No database migration or new
dependency is needed. This reuses the existing server-only `OPENAI_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (entitlement lookup only), Supabase URL/anon key,
and `OPENAI_TASK_SUGGESTIONS_MODEL` / `OPENAI_MODEL` (fallback: gpt-4.1-mini).
Do not put OpenAI or service-role keys in VITE-prefixed variables.

The new POST action is `task-list-generate`, with a bearer JWT, a 10–2000 character
`goal`, and a UUID-v4 `requestId`. User identity comes from auth.getUser, never
the request body. The server checks the same Pro entitlement rules as existing
AI Suggestions (active/trialing Pro monthly/yearly, lifetime, founding access).
All task writes use the caller's JWT and existing table ownership RLS.

OpenAI receives only the goal, not other tasks/profile information; store:false
is requested. Responses must match a strict schema and pass runtime validation.
Provider errors/refusals/incomplete output do not create a plan.

## Persistence and retries

The UI locks submission synchronously. Retrying an unchanged description within
the open dialog reuses its request ID as the plan ID. A completed saved request is
returned without another OpenAI request. Task IDs are deterministic per plan/index.
An interrupted empty parent can be recovered, and duplicate task IDs are ignored.

Parent and bulk task writes are separate requests, not one database transaction.
A confirmed SQL task failure attempts to remove the newly-created empty parent.
An ambiguous transport failure never deletes a possibly committed result.
Reloading/closing the dialog starts a new request; users should retry in the same
dialog after a timeout to recover its result. Generation has a 25-second provider
timeout, input/output bounds, but no new account-wide generation quota.

## Verification

- `node --test scripts/test-task-list-generation.mjs`
- `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck api/templates.ts`
- `npx vite build`
- `git diff --check`

After deployment, smoke-test with actual Free and Pro sessions: direct API denial
for Free, generation and reload persistence for Pro, editing/completing generated
tasks, mobile access, and retry after a dropped response. Automated API tests use
mocked Supabase/OpenAI and do not prove deployed credentials or RLS configuration.
