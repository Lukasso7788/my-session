# MySession analytics setup

The client integration is disabled unless `VITE_ANALYTICS_ENABLED=true`.
Missing vendor keys disable only that vendor; the application continues normally.

## Vercel environment variables

```text
VITE_ANALYTICS_ENABLED=true
VITE_POSTHOG_KEY=phc_...
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_SENTRY_DSN=https://...@...ingest.sentry.io/...
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE=0.05
VITE_CLARITY_PROJECT_ID=...
```

Use the EU PostHog ingest host instead if the PostHog project is created in the EU region.

## Privacy defaults

- Email, display name and profile fields are never sent by this integration.
- The only user identifier is the opaque Supabase user UUID.
- PostHog and Sentry mask all text and inputs in replay.
- Sentry blocks all media in replay.
- `/room-livekit/*` and `/room-iframe/*` stop PostHog and Sentry replay.
- If Clarity was loaded earlier in the SPA session, the entire room root is explicitly masked.
- Clarity should additionally be configured to **Strict** masking in its dashboard.

Before production enablement, update the privacy/cookie notice and pass the visitor's consent
state to the vendors as required for the visitor's jurisdiction.

## Event API

Import `captureProductEvent` from `src/lib/analytics.ts`. Event properties must contain only
non-sensitive operational values such as session type, browser capability, or boolean state.
Never send task text, chat/DM content, email, display name, camera frames, or audio.
