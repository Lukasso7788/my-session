-- Uses only a temporary fixture and always rolls back. No actual recipient IDs.
begin;
create temporary table complimentary_expiry_fixture (id text primary key,plan text,status text,source text,current_period_end timestamptz,stripe_subscription_id text);
insert into complimentary_expiry_fixture values
('expired-grant','pro_monthly','active','admin_complimentary_pro',now()-interval '1 second',null),
('expired-trial','pro_yearly','trialing','admin_complimentary_pro',now()-interval '1 second',null),
('boundary','pro_monthly','active','admin_complimentary_pro',now(),null),
('future','pro_monthly','active','admin_complimentary_pro',now()+interval '6 months',null),
('stripe','pro_monthly','active','stripe_webhook',now()-interval '1 day','sub_fixture'),
('stripe-guard','pro_monthly','active','admin_complimentary_pro',now()-interval '1 day','sub_fixture'),
('founding','founding_free','active','admin_complimentary_pro',now()-interval '1 day',null),
('lifetime','lifetime','active','admin_complimentary_pro',now()-interval '1 day',null),
('null-end','pro_monthly','active','admin_complimentary_pro',null,null),
('canceled','pro_monthly','canceled','admin_complimentary_pro',now()-interval '1 day',null);
update pg_temp.complimentary_expiry_fixture
set status = 'expired'
where source = 'admin_complimentary_pro'
  and plan in ('pro_monthly', 'pro_yearly')
  and status in ('active', 'trialing')
  and current_period_end is not null
  and current_period_end <= now()
  and stripe_subscription_id is null;
do $test$ begin
if (select count(*) from complimentary_expiry_fixture where status='expired') <> 3 then raise exception 'Wrong expiry count'; end if;
if exists(select 1 from complimentary_expiry_fixture where id in ('future','stripe','stripe-guard','founding','lifetime','null-end') and status<>'active') then raise exception 'Protected access changed'; end if;
if (select status from complimentary_expiry_fixture where id='canceled')<>'canceled' then raise exception 'Canceled state changed'; end if;
end $test$;
select jsonb_agg(to_jsonb(f) - 'stripe_subscription_id') as verified_fixture_states from complimentary_expiry_fixture f;
rollback;
