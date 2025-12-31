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

-- Members can read their own waitlist entries
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

-- Members can join the waitlist for themselves
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

-- Members can remove themselves from the waitlist
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

-- Staff can view and update waitlist entries for their gym
create policy class_waitlist_select_staff
on public.class_waitlist
for select
using (public.is_gym_staff(gym_id));

create policy class_waitlist_update_staff
on public.class_waitlist
for update
using (public.is_gym_staff(gym_id))
with check (public.is_gym_staff(gym_id));
