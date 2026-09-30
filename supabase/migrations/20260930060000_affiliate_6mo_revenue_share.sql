-- Migrate the partner affiliate program from a one-time $5 reward to
-- 50% revenue share for the first six months of a newly referred member.
-- Existing referrals keep the legacy first-payment terms; existing ledger
-- rewards are intentionally left untouched.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.referrals
  add column if not exists affiliate_terms_version text;

update public.referrals
set affiliate_terms_version = 'legacy_first_payment_5_v1'
where affiliate_terms_version is null;

alter table public.referrals
  alter column affiliate_terms_version set default 'partner_50pct_6mo_v1',
  alter column affiliate_terms_version set not null;

alter table public.partner_profiles
  alter column revenue_share_percent set default 50,
  alter column revenue_share_months set default 6,
  alter column subscribed_user_reward_usd set default 0,
  alter column revenue_share_label set default '50% for first 6 months (up to $30)';

update public.partner_profiles
set
  revenue_share_percent = 50,
  revenue_share_months = 6,
  subscribed_user_reward_usd = 0,
  revenue_share_label = '50% for first 6 months (up to $30)',
  updated_at = now();

alter table public.reward_ledger
  add column if not exists source_payment_key text,
  add column if not exists payment_provider text,
  add column if not exists provider_invoice_ref text,
  add column if not exists provider_payment_ref text,
  add column if not exists gross_payment_usd numeric,
  add column if not exists commission_rate numeric,
  add column if not exists reversal_of_reward_id uuid references public.reward_ledger(id) on delete set null;

-- The old unique constraint made one reward row per referral/type possible,
-- which is incompatible with recurring revenue-share entries.
alter table public.reward_ledger
  drop constraint if exists reward_ledger_referral_id_type_key;

-- Keep the old singleton reward types idempotent while allowing many
-- partner_revenue_share rows for the same referral.
create unique index if not exists reward_ledger_singleton_referral_type_idx
  on public.reward_ledger (referral_id, type)
  where referral_id is not null
    and type in ('invitation_activation', 'first_payment_bonus');

create unique index if not exists reward_ledger_source_payment_key_idx
  on public.reward_ledger (source_payment_key)
  where source_payment_key is not null;

create index if not exists reward_ledger_referral_created_idx
  on public.reward_ledger (referral_id, created_at desc)
  where referral_id is not null;

-- Existing activation-credit logic used ON CONFLICT(referral_id,type), which
-- relied on the dropped broad constraint. Plain DO NOTHING preserves the same
-- idempotent behavior against the narrower singleton index.
create or replace function public.process_referral_activations()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  update public.referrals r
  set
    status = 'activated',
    activated_at = now()
  where r.status = 'registered'
    and exists (
      select 1
      from public.session_attendance sa
      where sa.user_id = r.referred_user_id
        and coalesce(sa.duration_minutes, 0) >= 20
    );

  insert into public.reward_ledger (
    user_id,
    related_user_id,
    referral_id,
    type,
    amount_usd,
    currency,
    status,
    available_at
  )
  select
    r.referrer_user_id,
    r.referred_user_id,
    r.id,
    'invitation_activation',
    2,
    'usd',
    'available',
    now()
  from public.referrals r
  where r.status = 'activated'
    and r.activated_at is not null
  on conflict do nothing;
end;
$function$;

-- Keep the legacy helper for any non-Stripe callers, but make it explicitly
-- legacy-only. New-program commissions are created per successful payment by
-- the payment webhook and use partner_revenue_share ledger rows.
create or replace function public.reward_referrer_for_first_payment(
  p_referred_user_id uuid,
  p_payment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_referral_id uuid;
  v_referrer_user_id uuid;
  v_terms_version text;
begin
  select id, referrer_user_id, affiliate_terms_version
  into v_referral_id, v_referrer_user_id, v_terms_version
  from public.referrals
  where referred_user_id = p_referred_user_id
  limit 1;

  if v_referral_id is null
     or v_referrer_user_id is null
     or v_terms_version <> 'legacy_first_payment_5_v1' then
    return;
  end if;

  insert into public.reward_ledger (
    user_id,
    related_user_id,
    referral_id,
    type,
    amount_usd,
    currency,
    status,
    available_at,
    created_at
  )
  values (
    v_referrer_user_id,
    p_referred_user_id,
    v_referral_id,
    'first_payment_bonus',
    5,
    'usd',
    'available',
    now(),
    now()
  )
  on conflict do nothing;

  update public.referrals
  set
    status = 'paid',
    first_paid_at = coalesce(first_paid_at, now())
  where id = v_referral_id;
end;
$function$;
