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
  plan_id uuid references public.membership_plans (id) on delete restrict,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  status text not null check (status in ('active', 'inactive')),
  access_state text not null default 'active' check (access_state in ('active', 'grace', 'restricted', 'inactive')),
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
  pricing_plan_id uuid references public.pricing_plans (id) on delete restrict,
  previous_pricing_plan_id uuid references public.pricing_plans (id),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid')),
  delinquency_state text not null default 'none' check (delinquency_state in ('pending_retry', 'past_due', 'in_grace', 'canceled', 'recovered', 'none')),
  grace_period_until timestamptz,
  plan_change_requested_at timestamptz,
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
  refund_amount_cents integer not null default 0,
  refund_reason text,
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

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

create or replace view public.billing_history_view as
select
  s.member_id,
  s.id as subscription_id,
  i.id as invoice_id,
  t.id as transaction_id,
  s.current_period_start as period_start,
  s.current_period_end as period_end,
  coalesce(t.amount_cents, i.amount_due_cents) as amount_cents,
  coalesce(t.currency, 'usd') as currency,
  case
    when t.status = 'succeeded' then 'paid'
    when t.status = 'failed' then 'failed'
    when t.status = 'refunded' then 'refunded'
    when t.status = 'pending' then 'pending'
    else 'pending'
  end as status,
  i.hosted_invoice_url,
  i.pdf_url,
  i.created_at
from public.invoices i
join public.subscriptions s on s.id = i.subscription_id
left join lateral (
  select t.*
  from public.transactions t
  where t.subscription_id = s.id
  order by t.created_at desc
  limit 1
) t on true;

create index if not exists idx_members_gym_id on public.members (gym_id);
create index if not exists idx_members_user_id on public.members (user_id);
create unique index if not exists idx_members_stripe_customer_id on public.members (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists idx_staff_gym_id on public.staff (gym_id);
create index if not exists idx_staff_user_id on public.staff (user_id);
create index if not exists idx_membership_plans_gym_id on public.membership_plans (gym_id);
create index if not exists idx_member_subscriptions_member_id on public.member_subscriptions (member_id);
create index if not exists idx_member_subscriptions_subscription_id on public.member_subscriptions (subscription_id);
create index if not exists idx_checkins_gym_id on public.checkins (gym_id);
create index if not exists idx_checkins_member_id on public.checkins (member_id);
create index if not exists idx_checkins_checked_in_at on public.checkins (checked_in_at);
create index if not exists idx_checkin_tokens_gym_id on public.checkin_tokens (gym_id);
create index if not exists idx_checkin_tokens_member_id on public.checkin_tokens (member_id);
create index if not exists idx_checkin_tokens_expires_at on public.checkin_tokens (expires_at);
create index if not exists idx_subscriptions_member_id on public.subscriptions (member_id);
create index if not exists idx_subscriptions_status on public.subscriptions (status);
create index if not exists idx_subscriptions_stripe_subscription_id on public.subscriptions (stripe_subscription_id);
create index if not exists idx_subscriptions_grace_period_until on public.subscriptions (grace_period_until);
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
alter table public.stripe_events enable row level security;

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

-- Phase 3: core class scheduling models
create table if not exists public.class_types (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  name text not null,
  description text,
  intensity text,
  duration_minutes integer not null check (duration_minutes > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  bio text,
  specialties text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  class_type_id uuid not null references public.class_types (id) on delete cascade,
  instructor_id uuid references public.instructors (id) on delete set null,
  capacity integer not null check (capacity > 0),
  start_time time with time zone not null,
  end_time time with time zone not null,
  timezone text not null,
  recurrence_rule text,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedules_time_order_check check (end_time > start_time)
);

create table if not exists public.class_instances (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.class_schedules (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  class_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'canceled', 'completed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_class_schedules_gym_id on public.class_schedules (gym_id);
create index if not exists idx_class_instances_schedule_id on public.class_instances (schedule_id);
create index if not exists idx_class_instances_class_date on public.class_instances (class_date);
create unique index if not exists idx_class_instances_schedule_date on public.class_instances (schedule_id, class_date);

create trigger set_class_schedules_updated_at
before update on public.class_schedules
for each row execute function public.set_updated_at();

create or replace function public.normalize_timezone(ts timestamptz, tz text)
returns timestamptz
language sql
stable
as $$
  select (ts at time zone tz) at time zone tz;
$$;

create or replace function public.compute_instance_times(
  class_date date,
  start_time time with time zone,
  end_time time with time zone,
  tz text
)
returns table (start_at timestamptz, end_at timestamptz)
language sql
stable
as $$
  select
    (class_date::text || 'T' || start_time::text)::timestamptz at time zone tz,
    (class_date::text || 'T' || end_time::text)::timestamptz at time zone tz;
$$;

alter table public.class_types enable row level security;
alter table public.instructors enable row level security;
alter table public.class_schedules enable row level security;
alter table public.class_instances enable row level security;

create policy class_types_select_member
on public.class_types
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

create policy class_types_insert_staff
on public.class_types
for insert
with check (public.is_gym_staff(gym_id));

create policy class_types_update_staff
on public.class_types
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));

create policy class_types_delete_staff
on public.class_types
for delete
using (public.is_gym_staff(gym_id));

create policy instructors_select_member
on public.instructors
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

create policy instructors_insert_staff
on public.instructors
for insert
with check (public.is_gym_staff(gym_id));

create policy instructors_update_staff
on public.instructors
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));

create policy instructors_delete_staff
on public.instructors
for delete
using (public.is_gym_staff(gym_id));

create policy class_schedules_select_member
on public.class_schedules
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

create policy class_schedules_insert_staff
on public.class_schedules
for insert
with check (public.is_gym_staff(gym_id));

create policy class_schedules_update_staff
on public.class_schedules
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));

create policy class_schedules_delete_staff
on public.class_schedules
for delete
using (public.is_gym_staff(gym_id));

create policy class_instances_select_member
on public.class_instances
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

create policy class_instances_insert_staff
on public.class_instances
for insert
with check (public.is_gym_staff(gym_id));

create policy class_instances_update_staff
on public.class_instances
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));

create policy class_instances_delete_staff
on public.class_instances
for delete
using (public.is_gym_staff(gym_id));

-- Phase 3: waitlist core
create table if not exists public.class_waitlist (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  class_instance_id uuid not null references public.class_instances (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  position integer not null,
  status text not null default 'waiting' check (status in ('waiting', 'promoted', 'removed')),
  joined_at timestamptz not null default now(),
  promoted_at timestamptz,
  removed_at timestamptz
);

create unique index if not exists idx_class_waitlist_member_instance
  on public.class_waitlist (member_id, class_instance_id);

create unique index if not exists idx_class_waitlist_instance_position
  on public.class_waitlist (class_instance_id, position);

create index if not exists idx_class_waitlist_instance_id on public.class_waitlist (class_instance_id);
create index if not exists idx_class_waitlist_member_id on public.class_waitlist (member_id);
create index if not exists idx_class_waitlist_status on public.class_waitlist (status);

alter table public.class_waitlist enable row level security;

create policy class_waitlist_select_member
on public.class_waitlist
for select
using (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
);

create policy class_waitlist_insert_member
on public.class_waitlist
for insert
with check (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.class_instances ci
    where ci.id = class_instance_id
      and ci.gym_id = gym_id
  )
);

create policy class_waitlist_update_member
on public.class_waitlist
for update
using (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
);

create policy class_waitlist_select_staff
on public.class_waitlist
for select
using (public.is_gym_staff(gym_id));

create policy class_waitlist_update_staff
on public.class_waitlist
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));

-- Phase 3: attendance tracking
alter table public.class_bookings
  add column if not exists attendance_status text not null default 'pending',
  add column if not exists attendance_marked_at timestamptz,
  add column if not exists attendance_marked_by uuid references public.staff (user_id);

alter table public.class_bookings
  drop constraint if exists class_bookings_attendance_status_check;

alter table public.class_bookings
  add constraint class_bookings_attendance_status_check
  check (attendance_status in ('pending', 'checked_in', 'no_show', 'excused'));

alter table public.class_instances
  add column if not exists checkin_method text not null default 'manual';

alter table public.class_instances
  drop constraint if exists class_instances_checkin_method_check;

alter table public.class_instances
  add constraint class_instances_checkin_method_check
  check (checkin_method in ('manual', 'qr', 'hybrid'));

create index if not exists idx_class_bookings_attendance
  on public.class_bookings (class_instance_id, attendance_status);

-- Attendance RLS adjustments
-- Members can view their attendance records but cannot modify attendance fields
-- Staff can update attendance for bookings in their gym

-- Phase 3: class notifications and reminders

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum (
      'CLASS_REMINDER',
      'BOOKING_CONFIRMED',
      'BOOKING_CANCELLED',
      'WAITLIST_PROMOTED'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_status') then
    create type public.notification_status as enum ('queued', 'sent', 'failed');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'push_platform') then
    create type public.push_platform as enum ('ios', 'android', 'web');
  end if;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type public.notification_type not null,
  payload jsonb not null default '{}'::jsonb,
  status public.notification_status not null default 'queued',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token text not null,
  platform public.push_platform not null,
  created_at timestamptz not null default now(),
  unique (user_id, token, platform)
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  class_reminders_enabled boolean not null default true,
  waitlist_notifications_enabled boolean not null default true
);

create index if not exists idx_notifications_user_status
  on public.notifications (user_id, status);

create unique index if not exists idx_notifications_reminder_dedupe
  on public.notifications (
    user_id,
    type,
    (payload->>'class_instance_id'),
    (payload->>'reminder_minutes')
  )
  where type = 'CLASS_REMINDER';

create index if not exists idx_push_tokens_user
  on public.push_tokens (user_id);

alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notification_preferences enable row level security;

create policy notifications_select_own
on public.notifications
for select
using (auth.uid() = user_id);

create policy push_tokens_select_own
on public.push_tokens
for select
using (auth.uid() = user_id);

create policy push_tokens_insert_own
on public.push_tokens
for insert
with check (auth.uid() = user_id);

create policy push_tokens_update_own
on public.push_tokens
for update
using (auth.uid() = user_id);

create policy push_tokens_delete_own
on public.push_tokens
for delete
using (auth.uid() = user_id);

create policy notification_preferences_select_own
on public.notification_preferences
for select
using (auth.uid() = user_id);

create policy notification_preferences_upsert_own
on public.notification_preferences
for insert
with check (auth.uid() = user_id);

create policy notification_preferences_update_own
on public.notification_preferences
for update
using (auth.uid() = user_id);

-- Phase 3: instructor/admin class management tools

do $$
begin
  if not exists (select 1 from pg_type where typname = 'class_instance_event_type') then
    create type public.class_instance_event_type as enum (
      'CAPACITY_CHANGED',
      'CLASS_CANCELLED',
      'CLASS_RESCHEDULED',
      'MEMBER_REMOVED',
      'ROSTER_EDITED'
    );
  end if;
end $$;

create or replace function public.is_gym_instructor(gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.instructors i
    where i.gym_id = gym_id
      and i.user_id = auth.uid()
      and i.active = true
  );
$$;

create or replace function public.is_schedule_instructor(schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_schedules cs
    join public.instructors i on cs.instructor_id = i.id
    where cs.id = schedule_id
      and i.user_id = auth.uid()
  );
$$;

create or replace function public.is_instance_instructor(instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_instances ci
    join public.class_schedules cs on cs.id = ci.schedule_id
    join public.instructors i on cs.instructor_id = i.id
    where ci.id = instance_id
      and i.user_id = auth.uid()
  );
$$;

create table if not exists public.class_instance_events (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.class_instances (id) on delete cascade,
  actor_user_id uuid not null references public.users (id) on delete restrict,
  event_type public.class_instance_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_class_instance_events_instance
  on public.class_instance_events (instance_id, created_at desc);

alter table public.class_instance_events enable row level security;

create policy class_instance_events_select_staff
on public.class_instance_events
for select
using (
  public.is_instance_instructor(instance_id)
  or public.is_gym_staff((select gym_id from public.class_instances ci where ci.id = instance_id))
);

create policy class_types_select_instructor
on public.class_types
for select
using (public.is_gym_instructor(gym_id));

create policy instructors_select_instructor
on public.instructors
for select
using (public.is_gym_instructor(gym_id));

create policy class_schedules_select_instructor
on public.class_schedules
for select
using (public.is_schedule_instructor(id));

create policy class_instances_select_instructor
on public.class_instances
for select
using (public.is_instance_instructor(id));

create policy class_bookings_select_instructor
on public.class_bookings
for select
using (public.is_instance_instructor(class_instance_id));

create policy class_waitlist_select_instructor
on public.class_waitlist
for select
using (public.is_instance_instructor(class_instance_id));

-- Phase 3: class insights & analytics

create materialized view if not exists public.class_insights_mv as
select
  ci.id as instance_id,
  cs.class_type_id as class_type_id,
  ci.gym_id,
  ci.class_date as date,
  ci.capacity,
  count(cb.id) filter (where cb.status = 'booked') as booked_count,
  count(cw.id) filter (where cw.status = 'waiting') as waitlist_count,
  count(cb.id) filter (where cb.attendance_status = 'checked_in') as attendance_count,
  greatest(
    count(cb.id) filter (where cb.status = 'booked')
      - count(cb.id) filter (where cb.attendance_status = 'checked_in'),
    0
  ) as no_show_count,
  (count(cb.id) filter (where cb.status = 'booked')::numeric / nullif(ci.capacity, 0)) as fill_rate,
  (count(cb.id) filter (where cb.attendance_status = 'checked_in')::numeric
    / nullif(count(cb.id) filter (where cb.status = 'booked'), 0)) as attendance_rate
from public.class_instances ci
join public.class_schedules cs on cs.id = ci.schedule_id
left join public.class_bookings cb on cb.class_instance_id = ci.id
left join public.class_waitlist cw on cw.class_instance_id = ci.id and cw.status = 'waiting'
group by ci.id, cs.class_type_id, ci.gym_id, ci.class_date, ci.capacity;

create unique index if not exists class_insights_mv_instance_id
  on public.class_insights_mv (instance_id);

create index if not exists class_insights_mv_gym_date_idx
  on public.class_insights_mv (gym_id, date);

create materialized view if not exists public.class_type_performance_mv as
select
  ci.class_type_id,
  ci.gym_id,
  count(ci.instance_id) as total_sessions,
  avg(ci.fill_rate) as avg_fill_rate,
  avg(ci.waitlist_count) as avg_waitlist_count,
  avg(ci.attendance_rate) as avg_attendance_rate
from public.class_insights_mv ci
group by ci.class_type_id, ci.gym_id;

create unique index if not exists class_type_performance_mv_idx
  on public.class_type_performance_mv (class_type_id, gym_id);

create index if not exists class_type_performance_mv_gym_idx
  on public.class_type_performance_mv (gym_id, class_type_id);

create materialized view if not exists public.instructor_performance_mv as
select
  cs.instructor_id,
  ci.gym_id,
  count(ci.instance_id) as total_sessions,
  avg(ci.attendance_rate) as avg_attendance_rate,
  avg(ci.fill_rate) as avg_fill_rate,
  0::numeric as member_feedback_score
from public.class_insights_mv ci
join public.class_instances inst on inst.id = ci.instance_id
join public.class_schedules cs on cs.id = inst.schedule_id
where cs.instructor_id is not null
group by cs.instructor_id, ci.gym_id;

create unique index if not exists instructor_performance_mv_idx
  on public.instructor_performance_mv (instructor_id, gym_id);

create index if not exists instructor_performance_mv_gym_idx
  on public.instructor_performance_mv (gym_id, instructor_id);

create materialized view if not exists public.gym_performance_mv as
with class_daily as (
  select
    gym_id,
    date,
    count(*) as total_classes,
    avg(fill_rate) as avg_fill_rate,
    avg(attendance_rate) as avg_attendance_rate,
    sum(waitlist_count) as total_waitlisted,
    sum(booked_count) as total_booked,
    sum(no_show_count) as total_no_shows
  from public.class_insights_mv
  group by gym_id, date
),
checkins_daily as (
  select
    gym_id,
    checked_in_at::date as date,
    count(*) as total_checkins,
    count(distinct member_id) as unique_members
  from public.checkins
  group by gym_id, checked_in_at::date
),
combined as (
  select
    coalesce(cd.gym_id, ch.gym_id) as gym_id,
    coalesce(cd.date, ch.date) as period_start,
    coalesce(cd.date, ch.date) as period_end,
    ch.total_checkins,
    ch.unique_members,
    cd.total_classes,
    cd.avg_fill_rate,
    cd.avg_attendance_rate,
    cd.total_waitlisted,
    cd.total_booked,
    cd.total_no_shows
  from class_daily cd
  full outer join checkins_daily ch
    on cd.gym_id = ch.gym_id and cd.date = ch.date
)
select
  gym_id,
  period_start,
  period_end,
  coalesce(total_checkins, 0) as total_checkins,
  coalesce(unique_members, 0) as unique_members,
  case
    when coalesce(unique_members, 0) = 0 then 0
    else total_checkins::numeric / nullif(unique_members, 0)
  end as avg_checkins_per_member,
  avg_fill_rate,
  avg_attendance_rate,
  coalesce(total_classes, 0) as total_classes,
  coalesce(total_waitlisted, 0) as total_waitlisted,
  case
    when coalesce(total_booked, 0) = 0 then 0
    else total_no_shows::numeric / nullif(total_booked, 0)
  end as no_show_rate
from combined;

create unique index if not exists gym_performance_mv_gym_date_idx
  on public.gym_performance_mv (gym_id, period_start);

create or replace function public.refresh_gym_performance(gym_id uuid, from_date date, to_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- TODO: Replace with incremental refresh strategy once supported.
  refresh materialized view public.gym_performance_mv;
end;
$$;

create or replace function public.refresh_class_insights(instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- NOTE: refreshes entire MV due to Postgres materialized view limitations.
  refresh materialized view public.class_insights_mv;
end;
$$;

create or replace function public.refresh_class_type_performance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.class_type_performance_mv;
end;
$$;

create or replace function public.refresh_instructor_performance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.instructor_performance_mv;
end;
$$;

create or replace function public.handle_class_insights_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance_id uuid;
begin
  if (tg_op = 'DELETE') then
    v_instance_id = old.class_instance_id;
  else
    v_instance_id = new.class_instance_id;
  end if;

  perform public.refresh_class_insights(v_instance_id);
  perform public.refresh_class_type_performance();
  perform public.refresh_instructor_performance();
  return null;
end;
$$;

drop trigger if exists refresh_class_insights_on_booking on public.class_bookings;
create trigger refresh_class_insights_on_booking
after insert or update or delete on public.class_bookings
for each row execute function public.handle_class_insights_refresh();

drop trigger if exists refresh_class_insights_on_waitlist on public.class_waitlist;
create trigger refresh_class_insights_on_waitlist
after insert or update or delete on public.class_waitlist
for each row execute function public.handle_class_insights_refresh();

-- Phase 4: Multi-gym core schema + RLS foundation

-- NOTE: This migration is additive and preserves Phase 1-3 behavior.
-- TODO: Backfill existing single-gym records to new tables before enforcing stricter RLS.
-- TODO: Map all current members to a default HOME gym in member_gym_access.
-- TODO: Roll out in a dual-mode compatibility window (members table + member_gym_access).
-- TODO: Apply staff->staff_roles backfill before deprecating staff table.

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_gym_access_type') THEN
    CREATE TYPE public.member_gym_access_type AS ENUM ('HOME', 'SECONDARY', 'ALL_ACCESS');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staff_role_type') THEN
    CREATE TYPE public.staff_role_type AS ENUM ('STAFF', 'MANAGER', 'ADMIN', 'INSTRUCTOR');
  END IF;
END $$;

-- Core chain table
CREATE TABLE IF NOT EXISTS public.gym_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Extend gyms for multi-location fields (preserve existing rows)
ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS chain_id uuid REFERENCES public.gym_chains (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS address jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS gyms_code_unique
  ON public.gyms (code)
  WHERE code IS NOT NULL;

-- Member access table (multi-gym)
CREATE TABLE IF NOT EXISTS public.member_gym_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  access_type public.member_gym_access_type NOT NULL DEFAULT 'HOME',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_gym_access_home_unique
  ON public.member_gym_access (member_id)
  WHERE access_type = 'HOME';

CREATE INDEX IF NOT EXISTS member_gym_access_member_idx
  ON public.member_gym_access (member_id);

CREATE INDEX IF NOT EXISTS member_gym_access_gym_idx
  ON public.member_gym_access (gym_id);

-- Staff roles table (multi-gym)
CREATE TABLE IF NOT EXISTS public.staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  role public.staff_role_type NOT NULL DEFAULT 'STAFF',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_unique
  ON public.staff_roles (user_id, gym_id, role);

CREATE INDEX IF NOT EXISTS staff_roles_user_idx
  ON public.staff_roles (user_id);

CREATE INDEX IF NOT EXISTS staff_roles_gym_idx
  ON public.staff_roles (gym_id);

-- Gym hours & holidays
CREATE TABLE IF NOT EXISTS public.gym_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week between 0 and 6),
  open_time time NOT NULL,
  close_time time NOT NULL,
  CONSTRAINT gym_hours_time_order_check CHECK (close_time > open_time)
);

CREATE TABLE IF NOT EXISTS public.gym_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  date date NOT NULL,
  label text
);

CREATE UNIQUE INDEX IF NOT EXISTS gym_holidays_unique
  ON public.gym_holidays (gym_id, date);

-- Reference updates (nullable for safety)
-- TODO: Backfill gym_id for legacy rows before making NOT NULL.
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_instances
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_schedules
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_bookings
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

-- TODO: add gym_id to payments once billing model migrates to multi-gym.

-- Utility functions
CREATE OR REPLACE FUNCTION public.get_member_active_gyms(p_user_id uuid)
RETURNS TABLE (gym_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Returns gyms a member can access (HOME, SECONDARY). ALL_ACCESS returns all active gyms.
  SELECT mga.gym_id
  FROM public.member_gym_access mga
  JOIN public.members m ON m.id = mga.member_id
  WHERE m.user_id = p_user_id
    AND mga.access_type IN ('HOME', 'SECONDARY')
  UNION
  SELECT g.id
  FROM public.gyms g
  WHERE EXISTS (
    SELECT 1
    FROM public.member_gym_access mga
    JOIN public.members m ON m.id = mga.member_id
    WHERE m.user_id = p_user_id
      AND mga.access_type = 'ALL_ACCESS'
  )
    AND g.active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_user_staff_roles(p_user_id uuid)
RETURNS TABLE (gym_id uuid, role public.staff_role_type)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sr.gym_id, sr.role
  FROM public.staff_roles sr
  WHERE sr.user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.has_gym_access(p_user_id uuid, p_gym_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.get_member_active_gyms(p_user_id) g WHERE g.gym_id = p_gym_id
  )
  OR EXISTS (
    SELECT 1 FROM public.staff_roles sr WHERE sr.user_id = p_user_id AND sr.gym_id = p_gym_id
  );
$$;

-- Enable RLS
ALTER TABLE public.gym_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_gym_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_holidays ENABLE ROW LEVEL SECURITY;

-- RLS policies
-- Gyms: read-only access scoped by member access or staff roles.
CREATE POLICY gyms_select_multi_gym
ON public.gyms
FOR SELECT
USING (public.has_gym_access(auth.uid(), id));

-- Member gym access: members can read their own, staff can read within gym.
CREATE POLICY member_gym_access_select_self
ON public.member_gym_access
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = member_id
      AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = gym_id
  )
);

-- Staff roles: staff can read roles scoped to their gym assignments.
CREATE POLICY staff_roles_select_same_gym
ON public.staff_roles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = staff_roles.gym_id
  )
);

-- Class instances: members read only for gyms they can access, staff roles read by gym.
CREATE POLICY class_instances_select_multi_gym
ON public.class_instances
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

-- Checkins: members/staff limited to their gyms.
CREATE POLICY checkins_select_multi_gym
ON public.checkins
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

-- Attendance (stored on class_bookings): members/staff limited to their gyms.
CREATE POLICY class_bookings_select_multi_gym
ON public.class_bookings
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

-- RLS test queries
/*
  -- Member should only see gyms they can access
  select * from public.gyms;

  -- Member should only see checkins from allowed gyms
  select * from public.checkins;

  -- Staff should see roles for their gym only
  select * from public.staff_roles;

  -- Denied access should return zero rows
  select * from public.class_instances where gym_id = '00000000-0000-0000-0000-000000000000';

  -- RLS enforced on joins
  select ci.id, g.name
  from public.class_instances ci
  join public.gyms g on g.id = ci.gym_id;
*/

-- Phase 4: Step 2 - Home-gym assignment & cross-gym access rules

-- NOTE: Additive changes to preserve Phase 1-3 behavior.
-- TODO: Backfill members.home_gym_id and member_gym_access before enforcing NOT NULL.
-- TODO: Backfill checkins.gym_id, access_decision, decision_reason for legacy rows.
-- TODO: Ensure staff_roles is populated before relying on override validation.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_gym_access_status') THEN
    CREATE TYPE public.member_gym_access_status AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_gym_access_source') THEN
    CREATE TYPE public.member_gym_access_source AS ENUM ('PLAN', 'MANUAL_OVERRIDE', 'PROMO');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checkin_access_decision') THEN
    CREATE TYPE public.checkin_access_decision AS ENUM (
      'ALLOWED_HOME',
      'ALLOWED_SECONDARY',
      'ALLOWED_ALL_ACCESS',
      'ALLOWED_OVERRIDE',
      'DENIED_NO_ACCESS',
      'DENIED_EXPIRED',
      'DENIED_SUSPENDED'
    );
  END IF;
END $$;

-- Extend members with home gym
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS home_gym_id uuid REFERENCES public.gyms (id) ON DELETE SET NULL;

-- Extend member_gym_access
ALTER TABLE public.member_gym_access
  ADD COLUMN IF NOT EXISTS status public.member_gym_access_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS access_source public.member_gym_access_source NOT NULL DEFAULT 'PLAN';

-- Extend checkins
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS access_decision public.checkin_access_decision,
  ADD COLUMN IF NOT EXISTS decision_reason text;

-- Home-gym assignment function
CREATE OR REPLACE FUNCTION public.assign_home_gym(p_member_id uuid, p_gym_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure only one HOME record exists per member.
  UPDATE public.member_gym_access
  SET access_type = 'SECONDARY'
  WHERE member_id = p_member_id
    AND access_type = 'HOME'
    AND gym_id <> p_gym_id;

  INSERT INTO public.member_gym_access (member_id, gym_id, access_type, status, access_source)
  VALUES (p_member_id, p_gym_id, 'HOME', 'ACTIVE', 'MANUAL_OVERRIDE')
  ON CONFLICT (member_id)
  WHERE access_type = 'HOME'
  DO UPDATE SET gym_id = EXCLUDED.gym_id,
               status = EXCLUDED.status,
               access_source = EXCLUDED.access_source;

  UPDATE public.members
  SET home_gym_id = p_gym_id
  WHERE id = p_member_id;

  RETURN p_gym_id;
END;
$$;

-- Resolve member gym access function
CREATE OR REPLACE FUNCTION public.resolve_member_gym_access(p_member_id uuid, p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access record;
BEGIN
  -- Prefer direct access record for gym.
  SELECT access_type, status
  INTO v_access
  FROM public.member_gym_access
  WHERE member_id = p_member_id
    AND gym_id = p_gym_id
  ORDER BY (status = 'ACTIVE') DESC
  LIMIT 1;

  IF v_access.access_type IS NULL THEN
    -- Fall back to ALL_ACCESS if present.
    SELECT access_type, status
    INTO v_access
    FROM public.member_gym_access
    WHERE member_id = p_member_id
      AND access_type = 'ALL_ACCESS'
    ORDER BY (status = 'ACTIVE') DESC
    LIMIT 1;
  END IF;

  IF v_access.access_type IS NULL THEN
    RETURN jsonb_build_object(
      'has_access', false,
      'access_type', 'NONE',
      'status', 'NONE'
    );
  END IF;

  IF v_access.status = 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'has_access', true,
      'access_type', v_access.access_type,
      'status', v_access.status
    );
  END IF;

  RETURN jsonb_build_object(
    'has_access', false,
    'access_type', v_access.access_type,
    'status', v_access.status
  );
END;
$$;

-- Audit table for home-gym assignments and overrides
CREATE TABLE IF NOT EXISTS public.member_gym_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_gym_access_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_gym_access_events_select_staff
ON public.member_gym_access_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = member_gym_access_events.gym_id
  )
);

-- RLS updates
-- Members can only read their own gym access records.
CREATE POLICY member_gym_access_select_member_only
ON public.member_gym_access
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = member_gym_access.member_id
      AND m.user_id = auth.uid()
  )
);

-- Checkins: members read only their own checkins; staff scoped to their gym roles.
DROP POLICY IF EXISTS checkins_select_multi_gym ON public.checkins;

CREATE POLICY checkins_select_member_own
ON public.checkins
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = checkins.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY checkins_select_staff_gym
ON public.checkins
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = checkins.gym_id
  )
);

-- Remove overly broad booking access (members should not see all bookings in a gym).
DROP POLICY IF EXISTS class_bookings_select_multi_gym ON public.class_bookings;

-- Test queries
/*
  -- Member checks into home gym → allowed
  select public.resolve_member_gym_access('member_id', 'home_gym_id');

  -- Member checks into secondary gym → allowed
  select public.resolve_member_gym_access('member_id', 'secondary_gym_id');

  -- Member without access → denied
  select public.resolve_member_gym_access('member_id', 'unknown_gym_id');

  -- Suspended member → denied
  update public.member_gym_access set status = 'SUSPENDED' where member_id = 'member_id';
  select public.resolve_member_gym_access('member_id', 'home_gym_id');

  -- Staff override → allowed_override recorded
  select * from public.checkins where access_decision = 'ALLOWED_OVERRIDE';
*/

-- Phase 4: Location-aware scheduling & classes

-- Ensure gym_id is present and required for all scheduling artifacts.
-- Every class artifact is scoped to a single gym.

ALTER TABLE public.class_types
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_types
  ALTER COLUMN gym_id SET NOT NULL;

ALTER TABLE public.instructors
  ALTER COLUMN gym_id SET NOT NULL;

ALTER TABLE public.class_schedules
  ALTER COLUMN gym_id SET NOT NULL;

ALTER TABLE public.class_instances
  ALTER COLUMN gym_id SET NOT NULL;

-- Composite keys to enforce gym consistency across schedules and instances.
CREATE UNIQUE INDEX IF NOT EXISTS class_types_id_gym_idx
  ON public.class_types (id, gym_id);

CREATE UNIQUE INDEX IF NOT EXISTS class_schedules_id_gym_idx
  ON public.class_schedules (id, gym_id);

ALTER TABLE public.class_schedules
  DROP CONSTRAINT IF EXISTS class_schedules_class_type_gym_fkey;

ALTER TABLE public.class_schedules
  ADD CONSTRAINT class_schedules_class_type_gym_fkey
  FOREIGN KEY (class_type_id, gym_id)
  REFERENCES public.class_types (id, gym_id)
  ON DELETE CASCADE;

ALTER TABLE public.class_instances
  DROP CONSTRAINT IF EXISTS class_instances_schedule_gym_fkey;

ALTER TABLE public.class_instances
  ADD CONSTRAINT class_instances_schedule_gym_fkey
  FOREIGN KEY (schedule_id, gym_id)
  REFERENCES public.class_schedules (id, gym_id)
  ON DELETE CASCADE;

-- Ensure instructor belongs to same gym as schedule.
CREATE OR REPLACE FUNCTION public.enforce_schedule_instructor_gym()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_instructor_gym uuid;
begin
  if new.instructor_id is null then
    return new;
  end if;

  select gym_id
    into v_instructor_gym
  from public.instructors
  where id = new.instructor_id;

  if v_instructor_gym is null then
    raise exception 'instructor_not_found';
  end if;

  if v_instructor_gym <> new.gym_id then
    raise exception 'instructor_gym_mismatch';
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS class_schedules_instructor_gym_check ON public.class_schedules;
CREATE TRIGGER class_schedules_instructor_gym_check
BEFORE INSERT OR UPDATE ON public.class_schedules
FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_instructor_gym();

-- Indexes
CREATE INDEX IF NOT EXISTS class_types_gym_id_idx
  ON public.class_types (gym_id);

CREATE INDEX IF NOT EXISTS instructors_gym_id_idx
  ON public.instructors (gym_id);

CREATE INDEX IF NOT EXISTS class_schedules_gym_id_idx
  ON public.class_schedules (gym_id);

CREATE INDEX IF NOT EXISTS class_instances_gym_id_date_idx
  ON public.class_instances (gym_id, class_date);

-- RLS policy hardening for gym-scoped scheduling.
-- Members can only read rows where they have gym access.
-- Staff can mutate only within assigned gyms.
-- Edge Functions remain the preferred mutation path for sensitive operations.

DROP POLICY IF EXISTS class_types_select_member ON public.class_types;
DROP POLICY IF EXISTS class_types_insert_staff ON public.class_types;
DROP POLICY IF EXISTS class_types_update_staff ON public.class_types;
DROP POLICY IF EXISTS class_types_delete_staff ON public.class_types;

CREATE POLICY class_types_select_gym
ON public.class_types
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY class_types_write_staff
ON public.class_types
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_types_update_staff
ON public.class_types
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_types_delete_staff
ON public.class_types
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

DROP POLICY IF EXISTS instructors_select_member ON public.instructors;
DROP POLICY IF EXISTS instructors_insert_staff ON public.instructors;
DROP POLICY IF EXISTS instructors_update_staff ON public.instructors;
DROP POLICY IF EXISTS instructors_delete_staff ON public.instructors;

CREATE POLICY instructors_select_gym
ON public.instructors
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY instructors_write_staff
ON public.instructors
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY instructors_update_staff
ON public.instructors
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY instructors_delete_staff
ON public.instructors
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

DROP POLICY IF EXISTS class_schedules_select_member ON public.class_schedules;
DROP POLICY IF EXISTS class_schedules_insert_staff ON public.class_schedules;
DROP POLICY IF EXISTS class_schedules_update_staff ON public.class_schedules;
DROP POLICY IF EXISTS class_schedules_delete_staff ON public.class_schedules;

CREATE POLICY class_schedules_select_gym
ON public.class_schedules
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY class_schedules_write_staff
ON public.class_schedules
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_schedules_update_staff
ON public.class_schedules
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_schedules_delete_staff
ON public.class_schedules
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

DROP POLICY IF EXISTS class_instances_select_member ON public.class_instances;
DROP POLICY IF EXISTS class_instances_insert_staff ON public.class_instances;
DROP POLICY IF EXISTS class_instances_update_staff ON public.class_instances;
DROP POLICY IF EXISTS class_instances_delete_staff ON public.class_instances;

CREATE POLICY class_instances_select_gym
ON public.class_instances
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY class_instances_write_staff
ON public.class_instances
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_instances_update_staff
ON public.class_instances
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_instances_delete_staff
ON public.class_instances
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

COMMENT ON TABLE public.class_types IS 'Class types are scoped to a single gym.';
COMMENT ON TABLE public.instructors IS 'Instructors are scoped to a single gym.';
COMMENT ON TABLE public.class_schedules IS 'Schedules belong to a single gym and must align with class type + instructor gym.';
COMMENT ON TABLE public.class_instances IS 'Class instances are scoped to a single gym and inherit gym from schedule.';
