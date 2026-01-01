-- Phase 3: class booking engine

alter table public.class_instances
  add column if not exists late_cancel_cutoff_minutes integer not null default 120;

create table if not exists public.class_bookings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  class_instance_id uuid not null references public.class_instances (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  status text not null default 'booked' check (status in ('booked', 'canceled', 'attended', 'no_show')),
  booked_at timestamptz not null default now(),
  canceled_at timestamptz,
  cancellation_reason text
);

create unique index if not exists idx_class_bookings_member_instance
  on public.class_bookings (member_id, class_instance_id);

create index if not exists idx_class_bookings_instance_id on public.class_bookings (class_instance_id);
create index if not exists idx_class_bookings_member_id on public.class_bookings (member_id);

alter table public.class_bookings enable row level security;

-- Members can read their own bookings
create policy class_bookings_select_member
on public.class_bookings
for select
using (
  exists (
    select 1
    from public.members m
    where m.id = member_id
      and m.user_id = auth.uid()
  )
);

-- Members can book classes for themselves
create policy class_bookings_insert_member
on public.class_bookings
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

-- Members can cancel their own bookings
create policy class_bookings_update_member
on public.class_bookings
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

-- Staff can view and update bookings for their gym
create policy class_bookings_select_staff
on public.class_bookings
for select
using (public.is_gym_staff(gym_id));

create policy class_bookings_update_staff
on public.class_bookings
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));
