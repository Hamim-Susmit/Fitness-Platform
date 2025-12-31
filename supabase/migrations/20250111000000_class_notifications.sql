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
