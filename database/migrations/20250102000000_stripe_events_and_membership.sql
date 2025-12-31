-- Stripe webhook idempotency + member subscription linkage

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- Lock down member_subscriptions for webhook-only updates
alter table public.member_subscriptions
  add column if not exists subscription_id uuid references public.subscriptions (id) on delete set null;

alter table public.subscriptions
  alter column pricing_plan_id drop not null;

alter table public.member_subscriptions
  alter column plan_id drop not null;

update public.member_subscriptions
  set status = 'inactive'
  where status in ('canceled', 'past_due');

alter table public.member_subscriptions
  drop constraint if exists member_subscriptions_status_check;

alter table public.member_subscriptions
  add constraint member_subscriptions_status_check check (status in ('active', 'inactive'));

create index if not exists idx_member_subscriptions_subscription_id
  on public.member_subscriptions (subscription_id);

-- Remove client write access policies
drop policy if exists member_subscriptions_select on public.member_subscriptions;
drop policy if exists member_subscriptions_write_staff on public.member_subscriptions;
drop policy if exists member_subscriptions_update_staff on public.member_subscriptions;

create policy member_subscriptions_select_member_or_staff
on public.member_subscriptions
for select
using (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.members m
    where m.id = member_id
      and public.is_gym_staff(m.gym_id)
  )
);
