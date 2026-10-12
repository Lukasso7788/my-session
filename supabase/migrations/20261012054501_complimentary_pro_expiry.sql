-- Complimentary grants use the canonical status-based access lifecycle.
-- Keep Stripe subscriptions and permanent Founding/Lifetime access untouched.
-- No recipient IDs or grants belong in this migration.
update public.billing_plans
set name = 'Founding Member Pro', updated_at = now()
where code = 'founding_free';

select cron.schedule(
  'expire-complimentary-pro',
  '* * * * *',
  $expiry$
update public.user_entitlements
set status = 'expired'
where source = 'admin_complimentary_pro'
  and plan in ('pro_monthly', 'pro_yearly')
  and status in ('active', 'trialing')
  and current_period_end is not null
  and current_period_end <= now()
  and stripe_subscription_id is null;
  $expiry$
);
