-- Phase 3: instance generation helpers

-- normalize_timezone converts a timestamp to the provided timezone
create or replace function public.normalize_timezone(ts timestamptz, tz text)
returns timestamptz
language sql
stable
as $$
  select (ts at time zone tz) at time zone tz;
$$;

-- compute_instance_times builds start/end timestamps for a class_date
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

create unique index if not exists idx_class_instances_schedule_date
  on public.class_instances (schedule_id, class_date);
