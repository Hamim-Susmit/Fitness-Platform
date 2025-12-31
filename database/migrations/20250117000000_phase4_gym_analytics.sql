-- Phase 4: Per-location analytics & reporting

-- Rebuild class insights materialized views with gym_id as a primary dimension.
-- NOTE: Materialized views are rebuilt to safely add gym-aware indexes and columns.

DROP MATERIALIZED VIEW IF EXISTS public.instructor_performance_mv;
DROP MATERIALIZED VIEW IF EXISTS public.class_type_performance_mv;
DROP MATERIALIZED VIEW IF EXISTS public.class_insights_mv;

CREATE MATERIALIZED VIEW public.class_insights_mv AS
SELECT
  ci.id AS instance_id,
  cs.class_type_id AS class_type_id,
  ci.gym_id,
  ci.class_date AS date,
  ci.capacity,
  COUNT(cb.id) FILTER (WHERE cb.status = 'booked') AS booked_count,
  COUNT(cw.id) FILTER (WHERE cw.status = 'waiting') AS waitlist_count,
  COUNT(cb.id) FILTER (WHERE cb.attendance_status = 'checked_in') AS attendance_count,
  GREATEST(
    COUNT(cb.id) FILTER (WHERE cb.status = 'booked')
      - COUNT(cb.id) FILTER (WHERE cb.attendance_status = 'checked_in'),
    0
  ) AS no_show_count,
  (COUNT(cb.id) FILTER (WHERE cb.status = 'booked')::numeric / NULLIF(ci.capacity, 0)) AS fill_rate,
  (COUNT(cb.id) FILTER (WHERE cb.attendance_status = 'checked_in')::numeric
    / NULLIF(COUNT(cb.id) FILTER (WHERE cb.status = 'booked'), 0)) AS attendance_rate
FROM public.class_instances ci
JOIN public.class_schedules cs ON cs.id = ci.schedule_id
LEFT JOIN public.class_bookings cb ON cb.class_instance_id = ci.id
LEFT JOIN public.class_waitlist cw ON cw.class_instance_id = ci.id AND cw.status = 'waiting'
GROUP BY ci.id, cs.class_type_id, ci.gym_id, ci.class_date, ci.capacity;

CREATE UNIQUE INDEX class_insights_mv_instance_id
  ON public.class_insights_mv (instance_id);

CREATE INDEX class_insights_mv_gym_date_idx
  ON public.class_insights_mv (gym_id, date);

CREATE MATERIALIZED VIEW public.class_type_performance_mv AS
SELECT
  ci.class_type_id,
  ci.gym_id,
  COUNT(ci.instance_id) AS total_sessions,
  AVG(ci.fill_rate) AS avg_fill_rate,
  AVG(ci.waitlist_count) AS avg_waitlist_count,
  AVG(ci.attendance_rate) AS avg_attendance_rate
FROM public.class_insights_mv ci
GROUP BY ci.class_type_id, ci.gym_id;

CREATE UNIQUE INDEX class_type_performance_mv_idx
  ON public.class_type_performance_mv (class_type_id, gym_id);

CREATE INDEX class_type_performance_mv_gym_idx
  ON public.class_type_performance_mv (gym_id, class_type_id);

CREATE MATERIALIZED VIEW public.instructor_performance_mv AS
SELECT
  cs.instructor_id,
  ci.gym_id,
  COUNT(ci.instance_id) AS total_sessions,
  AVG(ci.attendance_rate) AS avg_attendance_rate,
  AVG(ci.fill_rate) AS avg_fill_rate,
  0::numeric AS member_feedback_score
FROM public.class_insights_mv ci
JOIN public.class_instances inst ON inst.id = ci.instance_id
JOIN public.class_schedules cs ON cs.id = inst.schedule_id
WHERE cs.instructor_id IS NOT NULL
GROUP BY cs.instructor_id, ci.gym_id;

CREATE UNIQUE INDEX instructor_performance_mv_idx
  ON public.instructor_performance_mv (instructor_id, gym_id);

CREATE INDEX instructor_performance_mv_gym_idx
  ON public.instructor_performance_mv (gym_id, instructor_id);

-- Per-gym performance rollup (daily)
DROP MATERIALIZED VIEW IF EXISTS public.gym_performance_mv;

CREATE MATERIALIZED VIEW public.gym_performance_mv AS
WITH class_daily AS (
  SELECT
    gym_id,
    date,
    COUNT(*) AS total_classes,
    AVG(fill_rate) AS avg_fill_rate,
    AVG(attendance_rate) AS avg_attendance_rate,
    SUM(waitlist_count) AS total_waitlisted,
    SUM(booked_count) AS total_booked,
    SUM(no_show_count) AS total_no_shows
  FROM public.class_insights_mv
  GROUP BY gym_id, date
),
checkins_daily AS (
  SELECT
    gym_id,
    checked_in_at::date AS date,
    COUNT(*) AS total_checkins,
    COUNT(DISTINCT member_id) AS unique_members
  FROM public.checkins
  GROUP BY gym_id, checked_in_at::date
),
combined AS (
  SELECT
    COALESCE(cd.gym_id, ch.gym_id) AS gym_id,
    COALESCE(cd.date, ch.date) AS period_start,
    COALESCE(cd.date, ch.date) AS period_end,
    ch.total_checkins,
    ch.unique_members,
    cd.total_classes,
    cd.avg_fill_rate,
    cd.avg_attendance_rate,
    cd.total_waitlisted,
    cd.total_booked,
    cd.total_no_shows
  FROM class_daily cd
  FULL OUTER JOIN checkins_daily ch
    ON cd.gym_id = ch.gym_id AND cd.date = ch.date
)
SELECT
  gym_id,
  period_start,
  period_end,
  COALESCE(total_checkins, 0) AS total_checkins,
  COALESCE(unique_members, 0) AS unique_members,
  CASE
    WHEN COALESCE(unique_members, 0) = 0 THEN 0
    ELSE total_checkins::numeric / NULLIF(unique_members, 0)
  END AS avg_checkins_per_member,
  avg_fill_rate,
  avg_attendance_rate,
  COALESCE(total_classes, 0) AS total_classes,
  COALESCE(total_waitlisted, 0) AS total_waitlisted,
  CASE
    WHEN COALESCE(total_booked, 0) = 0 THEN 0
    ELSE total_no_shows::numeric / NULLIF(total_booked, 0)
  END AS no_show_rate
FROM combined;

CREATE UNIQUE INDEX gym_performance_mv_gym_date_idx
  ON public.gym_performance_mv (gym_id, period_start);

-- Refresh helper (note: refreshes the full MV due to Postgres limitations).
CREATE OR REPLACE FUNCTION public.refresh_gym_performance(gym_id uuid, from_date date, to_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  -- TODO: Replace with incremental refresh strategy once supported.
  refresh materialized view public.gym_performance_mv;
end;
$$;
