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
