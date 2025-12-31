-- Grace period + delinquency tracking

alter table public.subscriptions
  add column if not exists delinquency_state text not null default 'none',
  add column if not exists grace_period_until timestamptz;

alter table public.subscriptions
  drop constraint if exists subscriptions_delinquency_state_check;

alter table public.subscriptions
  add constraint subscriptions_delinquency_state_check
  check (delinquency_state in ('pending_retry', 'past_due', 'in_grace', 'canceled', 'recovered', 'none'));

create index if not exists idx_subscriptions_grace_period_until
  on public.subscriptions (grace_period_until);

alter table public.member_subscriptions
  add column if not exists access_state text not null default 'active';

alter table public.member_subscriptions
  drop constraint if exists member_subscriptions_access_state_check;

alter table public.member_subscriptions
  add constraint member_subscriptions_access_state_check
  check (access_state in ('active', 'grace', 'restricted', 'inactive'));
