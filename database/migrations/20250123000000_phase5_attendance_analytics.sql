-- Phase 5: Step 3 - Attendance & peak-hours analytics

-- Supporting materialized views
CREATE MATERIALIZED VIEW IF NOT EXISTS public.gym_daily_attendance_mv AS
SELECT
  c.gym_id,
  date(c.checked_in_at) AS day,
  COUNT(*)::integer AS total_checkins,
  COUNT(DISTINCT c.member_id)::integer AS unique_members,
  MIN(c.checked_in_at) AS first_checkin_at,
  MAX(c.checked_in_at) AS last_checkin_at
FROM public.checkins c
WHERE c.gym_id IS NOT NULL
GROUP BY c.gym_id, date(c.checked_in_at);

CREATE UNIQUE INDEX IF NOT EXISTS gym_daily_attendance_unique
  ON public.gym_daily_attendance_mv (gym_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.gym_hourly_attendance_mv AS
SELECT
  c.gym_id,
  date(c.checked_in_at) AS day,
  EXTRACT(hour FROM c.checked_in_at)::integer AS hour,
  COUNT(*)::integer AS checkins_this_hour,
  COUNT(DISTINCT c.member_id)::integer AS unique_members_this_hour
FROM public.checkins c
WHERE c.gym_id IS NOT NULL
GROUP BY c.gym_id, date(c.checked_in_at), EXTRACT(hour FROM c.checked_in_at);

CREATE UNIQUE INDEX IF NOT EXISTS gym_hourly_attendance_unique
  ON public.gym_hourly_attendance_mv (gym_id, day, hour);

-- Peak hours view (load bands are directional signals only).
CREATE OR REPLACE VIEW public.gym_peak_hours_v AS
WITH hourly AS (
  SELECT
    gym_id,
    hour,
    AVG(checkins_this_hour)::numeric AS avg_checkins,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY checkins_this_hour)::numeric AS percentile_90_checkins
  FROM public.gym_hourly_attendance_mv
  GROUP BY gym_id, hour
),
capacity AS (
  SELECT gym_id, max_active_members
  FROM public.gym_capacity_limits
)
SELECT
  hourly.gym_id,
  hourly.hour,
  hourly.avg_checkins,
  hourly.percentile_90_checkins,
  CASE
    -- If capacity is known, use it as a proxy threshold.
    WHEN capacity.max_active_members IS NOT NULL AND hourly.avg_checkins >= capacity.max_active_members * 0.8 THEN 'CRITICAL'
    WHEN capacity.max_active_members IS NOT NULL AND hourly.avg_checkins >= capacity.max_active_members * 0.5 THEN 'HIGH'
    WHEN capacity.max_active_members IS NOT NULL AND hourly.avg_checkins >= capacity.max_active_members * 0.3 THEN 'MEDIUM'
    -- Fallback thresholds when capacity is unknown.
    WHEN hourly.avg_checkins >= 50 THEN 'CRITICAL'
    WHEN hourly.avg_checkins >= 25 THEN 'HIGH'
    WHEN hourly.avg_checkins >= 10 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS load_band
FROM hourly
LEFT JOIN capacity ON capacity.gym_id = hourly.gym_id;

-- Occupancy trends (directional; based on check-ins, not live occupancy).
CREATE OR REPLACE VIEW public.gym_occupancy_trends_v AS
SELECT
  gym_id,
  day,
  AVG(total_checkins) OVER (PARTITION BY gym_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)::numeric AS avg_daily_checkins,
  AVG(total_checkins) OVER (PARTITION BY gym_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)::numeric AS trend_7d,
  AVG(total_checkins) OVER (PARTITION BY gym_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)::numeric AS trend_30d,
  CASE
    WHEN AVG(total_checkins) OVER (PARTITION BY gym_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
       > AVG(total_checkins) OVER (PARTITION BY gym_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) * 1.05 THEN 'UP'
    WHEN AVG(total_checkins) OVER (PARTITION BY gym_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
       < AVG(total_checkins) OVER (PARTITION BY gym_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) * 0.95 THEN 'DOWN'
    ELSE 'FLAT'
  END AS trend_label
FROM public.gym_daily_attendance_mv;

-- Refresh helper
CREATE OR REPLACE FUNCTION public.refresh_attendance_materialized_views()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.gym_daily_attendance_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.gym_hourly_attendance_mv;
$$;

-- Notes & safety (documentation only):
/*
  - Occupancy here is derived from check-ins, not live sensors.
  - Use results directionally; do not treat as exact headcount.
  - No member-identifying data is shown in these analytics outputs.
*/

-- Manual QA checklist (documentation only):
/*
  - day with many check-ins shows correctly
  - heatmap highlights busy hours
  - multi-gym table only visible to corporate role
  - switching gyms updates charts
  - refresh view regenerates metrics
*/
