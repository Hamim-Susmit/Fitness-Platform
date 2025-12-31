-- Phase 1 MVP schema + RLS for Supabase

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'member')),
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete restrict,
  name text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  status text not null check (status in ('active', 'inactive', 'paused')),
  stripe_customer_id text,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  staff_role text not null check (staff_role in ('staff', 'manager')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  interval text not null check (interval in ('monthly', 'yearly')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  plan_id uuid not null references public.membership_plans (id) on delete restrict,
  status text not null check (status in ('active', 'canceled', 'past_due')),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  source text not null check (source in ('qr', 'manual')),
  staff_id uuid references public.staff (id) on delete set null
);

create table if not exists public.checkin_tokens (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  used boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users (id) on delete restrict
);

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

create index if not exists idx_members_gym_id on public.members (gym_id);
create index if not exists idx_members_user_id on public.members (user_id);
create unique index if not exists idx_members_stripe_customer_id on public.members (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists idx_staff_gym_id on public.staff (gym_id);
create index if not exists idx_staff_user_id on public.staff (user_id);
create index if not exists idx_membership_plans_gym_id on public.membership_plans (gym_id);
create index if not exists idx_member_subscriptions_member_id on public.member_subscriptions (member_id);
create index if not exists idx_checkins_gym_id on public.checkins (gym_id);
create index if not exists idx_checkins_member_id on public.checkins (member_id);
create index if not exists idx_checkins_checked_in_at on public.checkins (checked_in_at);
create index if not exists idx_checkin_tokens_gym_id on public.checkin_tokens (gym_id);
create index if not exists idx_checkin_tokens_member_id on public.checkin_tokens (member_id);
create index if not exists idx_checkin_tokens_expires_at on public.checkin_tokens (expires_at);
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

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger set_gyms_updated_at
before update on public.gyms
for each row execute function public.set_updated_at();

create trigger set_members_updated_at
before update on public.members
for each row execute function public.set_updated_at();

create trigger set_staff_updated_at
before update on public.staff
for each row execute function public.set_updated_at();

create trigger set_membership_plans_updated_at
before update on public.membership_plans
for each row execute function public.set_updated_at();

create trigger set_member_subscriptions_updated_at
before update on public.member_subscriptions
for each row execute function public.set_updated_at();

create trigger set_pricing_plans_updated_at
before update on public.pricing_plans
for each row execute function public.set_updated_at();

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create or replace function public.is_gym_owner(gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gyms g
    where g.id = gym_id
      and g.owner_id = auth.uid()
  );
$$;

create or replace function public.is_gym_staff(gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff s
    where s.gym_id = gym_id
      and s.user_id = auth.uid()
  )
  or public.is_gym_owner(gym_id);
$$;

create or replace function public.is_gym_member(gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members m
    where m.gym_id = gym_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.complete_checkin(
  p_token text,
  p_staff_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_member record;
  v_staff record;
  v_checkin_id uuid;
begin
  select * into v_staff
  from public.staff
  where user_id = p_staff_user_id;

  if v_staff is null then
    raise exception 'staff_not_found';
  end if;

  select * into v_token
  from public.checkin_tokens
  where token = p_token
  for update;

  if v_token is null then
    raise exception 'token_not_found';
  end if;

  if v_token.used or v_token.used_at is not null then
    raise exception 'token_already_used';
  end if;

  if v_token.expires_at <= now() then
    raise exception 'token_expired';
  end if;

  if v_token.gym_id <> v_staff.gym_id then
    raise exception 'staff_gym_mismatch';
  end if;

  select * into v_member
  from public.members
  where id = v_token.member_id;

  if v_member is null then
    raise exception 'member_not_found';
  end if;

  if v_member.status <> 'active' then
    raise exception 'member_inactive';
  end if;

  update public.checkin_tokens
  set used = true,
      used_at = now()
  where id = v_token.id;

  insert into public.checkins (member_id, gym_id, checked_in_at, source, staff_id)
  values (v_member.id, v_token.gym_id, now(), 'qr', v_staff.id)
  returning id into v_checkin_id;

  return v_checkin_id;
end;
$$;

alter table public.users enable row level security;
alter table public.gyms enable row level security;
alter table public.members enable row level security;
alter table public.staff enable row level security;
alter table public.membership_plans enable row level security;
alter table public.member_subscriptions enable row level security;
alter table public.checkins enable row level security;
alter table public.checkin_tokens enable row level security;
alter table public.pricing_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.transactions enable row level security;
alter table public.invoices enable row level security;

-- users policies
create policy users_select_self
on public.users
for select
using (id = auth.uid());

create policy users_insert_self
on public.users
for insert
with check (id = auth.uid());

create policy users_update_self
on public.users
for update
using (id = auth.uid())
with check (id = auth.uid());

-- gyms policies
create policy gyms_select_member_staff
on public.gyms
for select
using (
  public.is_gym_owner(id)
  or public.is_gym_staff(id)
  or public.is_gym_member(id)
);

create policy gyms_insert_owner
on public.gyms
for insert
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'owner'
  )
);

create policy gyms_update_owner
on public.gyms
for update
using (public.is_gym_owner(id))
with check (public.is_gym_owner(id));

create policy gyms_delete_owner
on public.gyms
for delete
using (public.is_gym_owner(id));

-- members policies
create policy members_select_self_or_staff
on public.members
for select
using (
  user_id = auth.uid()
  or public.is_gym_staff(gym_id)
);

create policy members_insert_self_or_staff
on public.members
for insert
with check (
  user_id = auth.uid()
  or public.is_gym_staff(gym_id)
);

create policy members_update_self_or_staff
on public.members
for update
using (
  user_id = auth.uid()
  or public.is_gym_staff(gym_id)
)
with check (
  user_id = auth.uid()
  or public.is_gym_staff(gym_id)
);

-- staff policies
create policy staff_select_self_or_owner
on public.staff
for select
using (
  user_id = auth.uid()
  or public.is_gym_owner(gym_id)
);

create policy staff_insert_owner
on public.staff
for insert
with check (public.is_gym_owner(gym_id));

create policy staff_update_owner
on public.staff
for update
using (public.is_gym_owner(gym_id))
with check (public.is_gym_owner(gym_id));

create policy staff_delete_owner
on public.staff
for delete
using (public.is_gym_owner(gym_id));

-- membership plans policies
create policy membership_plans_select
on public.membership_plans
for select
using (
  public.is_gym_staff(gym_id)
  or public.is_gym_member(gym_id)
);

create policy membership_plans_write_owner
on public.membership_plans
for insert
with check (public.is_gym_owner(gym_id));

create policy membership_plans_update_owner
on public.membership_plans
for update
using (public.is_gym_owner(gym_id))
with check (public.is_gym_owner(gym_id));

create policy membership_plans_delete_owner
on public.membership_plans
for delete
using (public.is_gym_owner(gym_id));

-- member subscriptions policies
create policy member_subscriptions_select
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

create policy member_subscriptions_write_staff
on public.member_subscriptions
for insert
with check (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and public.is_gym_staff(m.gym_id)
  )
);

create policy member_subscriptions_update_staff
on public.member_subscriptions
for update
using (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and public.is_gym_staff(m.gym_id)
  )
)
with check (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and public.is_gym_staff(m.gym_id)
  )
);

-- checkins policies
create policy checkins_select
on public.checkins
for select
using (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
  or public.is_gym_staff(gym_id)
);

create policy checkins_insert_member_or_staff
on public.checkins
for insert
with check (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
      and m.gym_id = gym_id
  )
  or public.is_gym_staff(gym_id)
);

-- checkin tokens policies
create policy checkin_tokens_select_self_or_staff
on public.checkin_tokens
for select
using (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
  or public.is_gym_staff(gym_id)
);

create policy checkin_tokens_insert_self_or_staff
on public.checkin_tokens
for insert
with check (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
      and m.gym_id = gym_id
  )
  or public.is_gym_staff(gym_id)
);

create policy checkin_tokens_update_staff
on public.checkin_tokens
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));

-- pricing plans policies
create policy pricing_plans_select_authenticated
on public.pricing_plans
for select
using (auth.uid() is not null);

-- subscriptions policies
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

-- transactions policies
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

-- invoices policies
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

-- Seed users, gym, and roles
with owner_user as (
  insert into auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    role,
    aud,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    'owner@gym.local',
    crypt('owner_password_123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Olivia Owner"}',
    'authenticated',
    'authenticated',
    now(),
    now()
  )
  on conflict (email) do update set updated_at = excluded.updated_at
  returning id
),
staff_user as (
  insert into auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    role,
    aud,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    'staff@gym.local',
    crypt('staff_password_123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Sam Staff"}',
    'authenticated',
    'authenticated',
    now(),
    now()
  )
  on conflict (email) do update set updated_at = excluded.updated_at
  returning id
),
member_user as (
  insert into auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    role,
    aud,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    'member@gym.local',
    crypt('member_password_123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Mia Member"}',
    'authenticated',
    'authenticated',
    now(),
    now()
  )
  on conflict (email) do update set updated_at = excluded.updated_at
  returning id
),
upsert_users as (
  insert into public.users (id, role, full_name)
  select id, 'owner', 'Olivia Owner' from owner_user
  on conflict (id) do update set role = excluded.role
  returning id
),
upsert_staff as (
  insert into public.users (id, role, full_name)
  select id, 'staff', 'Sam Staff' from staff_user
  on conflict (id) do update set role = excluded.role
  returning id
),
upsert_member as (
  insert into public.users (id, role, full_name)
  select id, 'member', 'Mia Member' from member_user
  on conflict (id) do update set role = excluded.role
  returning id
),
seed_gym as (
  insert into public.gyms (owner_id, name, timezone)
  select id, 'Downtown Fitness', 'America/New_York'
  from owner_user
  on conflict do nothing
  returning id
)
insert into public.staff (user_id, gym_id, staff_role)
select s.id, g.id, 'staff'
from staff_user s
cross join seed_gym g
on conflict (user_id) do nothing;

insert into public.members (user_id, gym_id, status)
select m.id, g.id, 'active'
from member_user m
cross join seed_gym g
on conflict (user_id) do nothing;

insert into public.pricing_plans (name, description, price_cents, currency, interval, stripe_price_id, active)
values
  ('Basic Monthly', 'Unlimited access billed monthly', 4000, 'usd', 'monthly', 'price_basic_monthly_placeholder', true),
  ('Basic Yearly', 'Unlimited access billed yearly', 40000, 'usd', 'yearly', 'price_basic_yearly_placeholder', true)
on conflict do nothing;
