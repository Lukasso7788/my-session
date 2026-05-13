# MySession Discord Notifications v1

Posts to Discord using a Discord incoming webhook:

- Daily schedule at 07:00 Kyiv time.
- 24h before session.
- 30m before session.
- When session starts.

Uses Supabase `discord_notification_sends` to avoid duplicate messages.

## Setup

1. Run `supabase_discord_notifications_v1.sql` in Supabase.
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
```

Use:

```txt
APP_URL=https://www.mysession.club
```

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

## Why Cloudflare Worker

Vercel Hobby cron is limited to daily execution, while this needs every 5 minutes for 30-minute/start reminders. Cloudflare Worker Cron supports scheduled handlers via cron triggers.
