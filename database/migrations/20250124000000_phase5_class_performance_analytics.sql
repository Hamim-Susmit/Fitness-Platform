-- Phase 5: Step 4 - Class & instructor performance analytics

-- Privacy & safety notes (documentation only):
/*
  - Do not expose individual member attendance in analytics outputs.
  - Instructor dashboards should only show aggregate metrics.
  - Ratings should be aggregated/anonymized when introduced.
*/

-- Class instance attendance aggregates.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.class_instance_attendance_mv AS
WITH booking_counts AS (
  SELECT
    cb.class_instance_id,
    COUNT(*) FILTER (WHERE cb.status IN ('booked', 'attended', 'no_show'))::integer AS booked_count,
    COUNT(*) FILTER (WHERE cb.attendance_status = 'checked_in')::integer AS attended_count,
    COUNT(*) FILTER (WHERE cb.attendance_status = 'no_show')::integer AS no_show_count
  FROM public.class_bookings cb
  GROUP BY cb.class_instance_id
),
waitlist_counts AS (
  SELECT
    cw.class_instance_id,
    COUNT(*) FILTER (WHERE cw.status = 'waiting')::integer AS waitlist_count,
    COUNT(*) FILTER (WHERE cw.status = 'promoted')::integer AS promoted_count
  FROM public.class_waitlist cw
  GROUP BY cw.class_instance_id
)
SELECT
  ci.id AS class_instance_id,
  cs.class_type_id AS class_id,
  cs.instructor_id,
  ci.gym_id,
  ci.start_at AS start_time,
  ci.capacity,
  COALESCE(booking_counts.booked_count, 0) AS booked_count,
  COALESCE(booking_counts.attended_count, 0) AS attended_count,
  COALESCE(waitlist_counts.waitlist_count, 0) AS waitlist_count,
  COALESCE(booking_counts.no_show_count, 0) AS no_show_count,
  COALESCE(waitlist_counts.promoted_count, 0) AS waitlist_promoted_count
FROM public.class_instances ci
JOIN public.class_schedules cs ON cs.id = ci.schedule_id
LEFT JOIN booking_counts ON booking_counts.class_instance_id = ci.id
LEFT JOIN waitlist_counts ON waitlist_counts.class_instance_id = ci.id
WHERE ci.status <> 'canceled';

CREATE UNIQUE INDEX IF NOT EXISTS class_instance_attendance_unique
  ON public.class_instance_attendance_mv (class_instance_id);

CREATE INDEX IF NOT EXISTS class_instance_attendance_gym_idx
  ON public.class_instance_attendance_mv (gym_id, start_time);

-- Fill rate aggregates per class type.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.class_fill_rates_mv AS
SELECT
  class_id,
  gym_id,
  AVG(CASE WHEN capacity > 0 THEN booked_count::numeric / capacity ELSE 0 END) * 100 AS avg_fill_percent,
  AVG(waitlist_count)::numeric AS avg_waitlist_size,
  AVG(CASE WHEN booked_count > 0 THEN no_show_count::numeric / booked_count ELSE 0 END) * 100 AS avg_no_show_rate,
  COUNT(*)::integer AS sample_size
FROM public.class_instance_attendance_mv
GROUP BY class_id, gym_id;

CREATE UNIQUE INDEX IF NOT EXISTS class_fill_rates_unique
  ON public.class_fill_rates_mv (class_id, gym_id);

-- Instructor performance aggregates.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.instructor_performance_mv AS
SELECT
  instructor_id,
  gym_id,
  COUNT(*)::integer AS classes_taught,
  AVG(CASE WHEN capacity > 0 THEN booked_count::numeric / capacity ELSE 0 END) * 100 AS avg_fill_percent,
  AVG(attended_count)::numeric AS avg_attendance,
  NULL::numeric AS avg_rating,
  NULL::numeric AS revenue_generated
FROM public.class_instance_attendance_mv
WHERE instructor_id IS NOT NULL
GROUP BY instructor_id, gym_id;

CREATE UNIQUE INDEX IF NOT EXISTS instructor_performance_unique
  ON public.instructor_performance_mv (instructor_id, gym_id);

-- Waitlist & no-show behaviors per class instance.
CREATE OR REPLACE VIEW public.class_attendance_behavior_v AS
SELECT
  class_instance_id,
  gym_id,
  CASE
    WHEN waitlist_count + waitlist_promoted_count = 0 THEN 0
    ELSE (waitlist_promoted_count::numeric / (waitlist_count + waitlist_promoted_count)) * 100
  END AS waitlist_conversion_rate,
  CASE
    WHEN booked_count = 0 THEN 0
    ELSE (no_show_count::numeric / booked_count) * 100
  END AS no_show_rate,
  CASE
    WHEN booked_count = 0 THEN 0
    ELSE (attended_count::numeric / booked_count) * 100
  END AS attendance_rate
FROM public.class_instance_attendance_mv;

-- Refresh helper for scheduled jobs.
CREATE OR REPLACE FUNCTION public.refresh_class_analytics_materialized_views()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.class_instance_attendance_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.class_fill_rates_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.instructor_performance_mv;
$$;

-- Manual QA checklist (documentation only):
/*
  - popular classes show higher fill rate
  - instructors with more classes show stable averages
  - waitlist values compute correctly
  - switching gyms updates datasets
  - refresh utilities regenerate metrics
*/
