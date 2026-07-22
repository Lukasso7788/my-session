# MySession Discord Notifications v1

Posts to Discord using a Discord incoming webhook:

- Daily schedule at 07:00 Kyiv time.
- 24h before session.
- 30m before session.
- When session starts.
- When at least two people are actively focusing in a public infinite room.
- Web Push for active public infinite rooms (user-controlled in Profile).

Uses Supabase `discord_notification_sends` to avoid duplicate messages.

## Setup

1. Apply the Supabase migrations, including
   `20260715_discord_infinite_room_presence.sql` and
   `20260722_focus_room_presence_push.sql`.
2. Create Discord webhook:
   Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.
3. In Cloudflare Workers, deploy the worker.
4. Add secrets:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put DISCORD_WORKER_SECRET
npx wrangler secret put APP_URL
npx wrangler secret put PUSH_DISPATCH_SECRET
```

Use:

```txt
APP_URL=https://www.mysession.club
```

Use the same long random `PUSH_DISPATCH_SECRET` in the Cloudflare Worker and in
the Vercel project environment. Vercel also needs the existing
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and the frontend build
needs `VITE_VAPID_PUBLIC_KEY`. Optional Worker variables
`PUSH_PRESENCE_MIN_PARTICIPANTS` (default `2`) and
`PUSH_PRESENCE_COOLDOWN_MINUTES` (default `45`) tune delivery without a code
change.

5. Deploy:

```bash
cd cloudflare-worker
npm install
npx wrangler deploy
```

6. Manual test:

```txt
https://YOUR_WORKER_URL/run?secret=YOUR_SECRET&dryRun=1
```

Real run:

```txt
https://YOUR_WORKER_URL/run?secret=YOUR_SECRET
```

The run response includes `infiniteRoomPresence` and
`infiniteRoomPresencePush` with the rooms scanned, active
participant counts, cooldown skips, and messages that would be sent in dry-run
mode. Infinite-room presence uses a 90-second activity window and a 45-minute
per-room cooldown.

## Why Cloudflare Worker

Vercel Hobby cron is limited to daily execution, while this needs every 5 minutes for 30-minute/start reminders. Cloudflare Worker Cron supports scheduled handlers via cron triggers.
