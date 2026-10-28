-- Ledger of Stripe webhook events (see api/_lib/stripeEntitlementSync.ts).
-- An event is marked processed only after its effects were saved; failed and
-- abandoned attempts stay retryable. Contains Stripe event IDs/types only, no
-- customer data. Service role only: RLS on, no policies.
-- Does not change any user_entitlements row.

create table if not exists public.stripe_webhook_events (
  id text primary key,
  type text not null,
  livemode boolean not null default false,
  event_created_at timestamptz,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  outcome jsonb,
  received_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_status_idx
  on public.stripe_webhook_events (status, received_at);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

-- Lookups the sync does on every subscription event.
create index if not exists user_entitlements_stripe_subscription_id_idx
  on public.user_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;
create index if not exists user_entitlements_stripe_customer_id_idx
  on public.user_entitlements (stripe_customer_id)
  where stripe_customer_id is not null;

-- Keep 90 days of processed events; failures stay until handled.
select cron.schedule(
  'prune-stripe-webhook-events',
  '17 3 * * *',
  $prune$
delete from public.stripe_webhook_events
where status = 'processed' and processed_at < now() - interval '90 days';
  $prune$
);
