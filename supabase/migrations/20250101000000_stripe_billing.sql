-- Phase 2: Stripe billing foundation

alter table public.members
  add column if not exists stripe_customer_id text;

create unique index if not exists idx_members_stripe_customer_id
  on public.members (stripe_customer_id)
  where stripe_customer_id is not null;

create table if not exists public.pricing_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'usd',
  interval text not null check (interval in ('monthly', 'yearly')),
  stripe_price_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  pricing_plan_id uuid not null references public.pricing_plans (id) on delete restrict,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  stripe_payment_intent_id text,
  status text not null check (status in ('succeeded', 'failed', 'pending', 'refunded')),
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  stripe_invoice_id text,
  amount_due_cents integer not null check (amount_due_cents >= 0),
  amount_paid_cents integer not null check (amount_paid_cents >= 0),
  hosted_invoice_url text,
  pdf_url text,
  status text not null check (status in ('draft', 'open', 'paid', 'uncollectible', 'void')),
  created_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_member_id on public.subscriptions (member_id);
create index if not exists idx_subscriptions_status on public.subscriptions (status);
create index if not exists idx_subscriptions_stripe_subscription_id on public.subscriptions (stripe_subscription_id);
create index if not exists idx_transactions_subscription_id on public.transactions (subscription_id);
create index if not exists idx_transactions_status on public.transactions (status);
create index if not exists idx_invoices_subscription_id on public.invoices (subscription_id);
create index if not exists idx_invoices_status on public.invoices (status);

create unique index if not exists uniq_active_subscription_per_member
  on public.subscriptions (member_id)
  where status in ('active', 'trialing', 'past_due', 'unpaid');

create trigger set_pricing_plans_updated_at
before update on public.pricing_plans
for each row execute function public.set_updated_at();

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

alter table public.pricing_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.transactions enable row level security;
alter table public.invoices enable row level security;

create policy pricing_plans_select_authenticated
on public.pricing_plans
for select
using (auth.uid() is not null);

create policy subscriptions_select_member_or_staff
on public.subscriptions
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

create policy transactions_select_member_or_staff
on public.transactions
for select
using (
  exists (
    select 1
    from public.subscriptions s
    join public.members m on m.id = s.member_id
    where s.id = subscription_id
      and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.subscriptions s
    join public.members m on m.id = s.member_id
    where s.id = subscription_id
      and public.is_gym_staff(m.gym_id)
  )
);

create policy invoices_select_member_or_staff
on public.invoices
for select
using (
  exists (
    select 1
    from public.subscriptions s
    join public.members m on m.id = s.member_id
    where s.id = subscription_id
      and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.subscriptions s
    join public.members m on m.id = s.member_id
    where s.id = subscription_id
      and public.is_gym_staff(m.gym_id)
  )
);

insert into public.pricing_plans (name, description, price_cents, currency, interval, stripe_price_id, active)
values
  ('Basic Monthly', 'Unlimited access billed monthly', 4000, 'usd', 'monthly', 'price_basic_monthly_placeholder', true),
  ('Basic Yearly', 'Unlimited access billed yearly', 40000, 'usd', 'yearly', 'price_basic_yearly_placeholder', true)
on conflict do nothing;
