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

create trigger set_class_schedules_updated_at
before update on public.class_schedules
for each row execute function public.set_updated_at();

alter table public.class_types enable row level security;
alter table public.instructors enable row level security;
alter table public.class_schedules enable row level security;
alter table public.class_instances enable row level security;

-- Members can read class types for their gym
create policy class_types_select_member
on public.class_types
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

-- Staff and owners can manage class types for their gym
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

-- Members can read instructors for their gym
create policy instructors_select_member
on public.instructors
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

-- Staff and owners can manage instructors for their gym
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

-- Members can read schedules for their gym
create policy class_schedules_select_member
on public.class_schedules
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

-- Staff and owners can manage schedules for their gym
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

-- Members can read instances for their gym
create policy class_instances_select_member
on public.class_instances
for select
using (public.is_gym_member(gym_id) or public.is_gym_staff(gym_id));

-- Staff and owners can manage instances for their gym
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
