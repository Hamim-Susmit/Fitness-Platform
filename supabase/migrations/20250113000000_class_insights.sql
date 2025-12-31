-- Phase 3: class insights & analytics

create materialized view if not exists public.class_insights_mv as
select
  ci.id as instance_id,
  cs.class_type_id as class_id,
  ci.gym_id,
  ci.class_date as date,
  ci.capacity,
  count(cb.id) filter (where cb.status = 'booked') as booked_count,
  count(cw.id) filter (where cw.status = 'waiting') as waitlist_count,
  count(cb.id) filter (where cb.attendance_status = 'checked_in') as attendance_count,
  greatest(count(cb.id) filter (where cb.status = 'booked') - count(cb.id) filter (where cb.attendance_status = 'checked_in'), 0) as no_show_count,
  (count(cb.id) filter (where cb.status = 'booked')::numeric / nullif(ci.capacity, 0)) as fill_rate,
  (count(cb.id) filter (where cb.attendance_status = 'checked_in')::numeric / nullif(count(cb.id) filter (where cb.status = 'booked'), 0)) as attendance_rate
from public.class_instances ci
join public.class_schedules cs on cs.id = ci.schedule_id
left join public.class_bookings cb on cb.class_instance_id = ci.id
left join public.class_waitlist cw on cw.class_instance_id = ci.id and cw.status = 'waiting'
group by ci.id, cs.class_type_id, ci.gym_id, ci.class_date, ci.capacity;

create unique index if not exists class_insights_mv_instance_id
  on public.class_insights_mv (instance_id);

create materialized view if not exists public.class_type_performance_mv as
select
  ci.class_id as class_type_id,
  ci.gym_id,
  count(ci.instance_id) as total_sessions,
  avg(ci.fill_rate) as avg_fill_rate,
  avg(ci.waitlist_count) as avg_waitlist_count,
  avg(ci.attendance_rate) as avg_attendance_rate
from public.class_insights_mv ci
group by ci.class_id, ci.gym_id;

create unique index if not exists class_type_performance_mv_idx
  on public.class_type_performance_mv (class_type_id, gym_id);

create materialized view if not exists public.instructor_performance_mv as
select
  cs.instructor_id,
  count(ci.instance_id) as total_sessions,
  avg(ci.attendance_rate) as avg_attendance_rate,
  avg(ci.fill_rate) as avg_fill_rate,
  0::numeric as member_feedback_score
from public.class_insights_mv ci
join public.class_instances inst on inst.id = ci.instance_id
join public.class_schedules cs on cs.id = inst.schedule_id
where cs.instructor_id is not null
group by cs.instructor_id;

create unique index if not exists instructor_performance_mv_idx
  on public.instructor_performance_mv (instructor_id);

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
