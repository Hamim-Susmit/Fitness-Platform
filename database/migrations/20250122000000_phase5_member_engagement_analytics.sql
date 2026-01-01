-- Phase 5: Step 2 - Member & engagement analytics

-- Privacy & access notes (documentation only):
/*
  - Members must NOT see other members' analytics.
  - Staff may only see data for gyms they manage.
  - Corporate admins may see cross-gym analytics.
  - No sensitive health data should be derived or displayed.
*/

-- Activity summary aggregated from checkins (with analytics_events fallback).
CREATE MATERIALIZED VIEW IF NOT EXISTS public.member_activity_summary_mv AS
WITH raw_events AS (
  SELECT
    c.member_id,
    c.gym_id,
    c.checked_in_at AS occurred_at
  FROM public.checkins c
  WHERE c.member_id IS NOT NULL
  UNION ALL
  SELECT
    ae.member_id,
    ae.gym_id,
    ae.created_at AS occurred_at
  FROM public.analytics_events ae
  WHERE ae.event_type = 'member.checkin.created'
    AND ae.member_id IS NOT NULL
),
deduped AS (
  SELECT DISTINCT ON (member_id, gym_id, occurred_at)
    member_id,
    gym_id,
    occurred_at
  FROM raw_events
  WHERE occurred_at IS NOT NULL
  ORDER BY member_id, gym_id, occurred_at
),
with_lag AS (
  SELECT
    member_id,
    gym_id,
    occurred_at,
    LAG(occurred_at) OVER (PARTITION BY member_id ORDER BY occurred_at) AS prev_visit_at
  FROM deduped
)
SELECT
  member_id,
  MIN(occurred_at) AS first_checkin_at,
  MAX(occurred_at) AS last_checkin_at,
  COUNT(*)::integer AS total_checkins,
  COUNT(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::integer AS visits_last_30_days,
  COUNT(*) FILTER (WHERE occurred_at >= now() - interval '90 days')::integer AS visits_last_90_days,
  AVG(EXTRACT(day FROM occurred_at - prev_visit_at))::numeric AS avg_days_between_visits
FROM with_lag
GROUP BY member_id;

CREATE UNIQUE INDEX IF NOT EXISTS member_activity_summary_unique
  ON public.member_activity_summary_mv (member_id);

CREATE INDEX IF NOT EXISTS member_activity_summary_member_idx
  ON public.member_activity_summary_mv (member_id);

-- Subscription status summary (latest subscription).
CREATE MATERIALIZED VIEW IF NOT EXISTS public.member_subscription_status_mv AS
WITH latest_sub AS (
  SELECT
    ms.*,
    ROW_NUMBER() OVER (PARTITION BY ms.member_id ORDER BY ms.started_at DESC, ms.created_at DESC) AS rn
  FROM public.member_subscriptions ms
),
selected AS (
  SELECT
    ls.member_id,
    ls.plan_id,
    ls.status,
    ls.started_at,
    mp.billing_period,
    mp.base_price_cents
  FROM latest_sub ls
  LEFT JOIN public.membership_plans mp ON mp.id = ls.plan_id
  WHERE ls.rn = 1
)
SELECT
  member_id,
  CASE
    WHEN status = 'ACTIVE' THEN 'ACTIVE'
    WHEN status = 'PAST_DUE' THEN 'ACTIVE'
    WHEN status = 'CANCELED' THEN 'CANCELLED'
    ELSE 'EXPIRED'
  END AS current_status,
  plan_id AS active_plan_id,
  CASE
    WHEN status = 'ACTIVE' THEN true
    WHEN status = 'PAST_DUE' THEN true
    ELSE false
  END AS billing_recurring,
  CASE
    WHEN base_price_cents IS NULL THEN NULL
    WHEN billing_period = 'YEARLY' THEN (base_price_cents::numeric / 12)
    ELSE base_price_cents::numeric
  END AS mrr_amount,
  started_at AS since
FROM selected;

CREATE UNIQUE INDEX IF NOT EXISTS member_subscription_status_unique
  ON public.member_subscription_status_mv (member_id);

CREATE INDEX IF NOT EXISTS member_subscription_status_member_idx
  ON public.member_subscription_status_mv (member_id);

-- Retention cohorts by first subscription start.
CREATE OR REPLACE VIEW public.monthly_signup_cohorts_v AS
WITH first_sub AS (
  SELECT member_id, MIN(started_at) AS first_started_at
  FROM public.member_subscriptions
  WHERE started_at IS NOT NULL
  GROUP BY member_id
),
activity AS (
  SELECT
    mas.member_id,
    mas.last_checkin_at
  FROM public.member_activity_summary_mv mas
),
status AS (
  SELECT
    mss.member_id,
    mss.current_status
  FROM public.member_subscription_status_mv mss
)
SELECT
  date_trunc('month', first_sub.first_started_at)::date AS cohort_month,
  COUNT(*)::integer AS members_in_cohort,
  COUNT(*) FILTER (
    WHERE (status.current_status = 'ACTIVE')
      OR (activity.last_checkin_at >= first_sub.first_started_at + interval '30 days')
  )::integer AS active_after_30d,
  COUNT(*) FILTER (
    WHERE (status.current_status = 'ACTIVE')
      OR (activity.last_checkin_at >= first_sub.first_started_at + interval '90 days')
  )::integer AS active_after_90d,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(
      (COUNT(*) FILTER (
        WHERE (status.current_status = 'ACTIVE')
          OR (activity.last_checkin_at >= first_sub.first_started_at + interval '30 days')
      )::numeric / COUNT(*)::numeric) * 100,
      2
    )
  END AS retention_30d_percent,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(
      (COUNT(*) FILTER (
        WHERE (status.current_status = 'ACTIVE')
          OR (activity.last_checkin_at >= first_sub.first_started_at + interval '90 days')
      )::numeric / COUNT(*)::numeric) * 100,
      2
    )
  END AS retention_90d_percent
FROM first_sub
LEFT JOIN activity ON activity.member_id = first_sub.member_id
LEFT JOIN status ON status.member_id = first_sub.member_id
GROUP BY date_trunc('month', first_sub.first_started_at);

-- Engagement score v1 (0-100).
CREATE OR REPLACE FUNCTION public.calculate_member_engagement_score(p_member_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity record;
  v_status record;
  v_days_since_last integer := 999;
  v_score integer := 0;
  v_visit_score integer := 0;
  v_recency_score integer := 0;
  v_subscription_score integer := 0;
BEGIN
  SELECT * INTO v_activity
  FROM public.member_activity_summary_mv
  WHERE member_id = p_member_id;

  SELECT * INTO v_status
  FROM public.member_subscription_status_mv
  WHERE member_id = p_member_id;

  IF v_activity.last_checkin_at IS NOT NULL THEN
    v_days_since_last := DATE_PART('day', now() - v_activity.last_checkin_at)::integer;
  END IF;

  -- Weighting model (v1):
  -- Visits (40): visits_last_30_days * 4 capped at 40.
  -- Recency (30): 0-7d=30, 8-14d=20, 15-30d=10, >30d=0.
  -- Subscription (30): ACTIVE/TRIAL=30, EXPIRED=10, CANCELLED=0.
  v_visit_score := LEAST(COALESCE(v_activity.visits_last_30_days, 0) * 4, 40);

  IF v_days_since_last <= 7 THEN
    v_recency_score := 30;
  ELSIF v_days_since_last <= 14 THEN
    v_recency_score := 20;
  ELSIF v_days_since_last <= 30 THEN
    v_recency_score := 10;
  ELSE
    v_recency_score := 0;
  END IF;

  IF v_status.current_status = 'ACTIVE' THEN
    v_subscription_score := 30;
  ELSIF v_status.current_status = 'EXPIRED' THEN
    v_subscription_score := 10;
  ELSE
    v_subscription_score := 0;
  END IF;

  v_score := v_visit_score + v_recency_score + v_subscription_score;

  IF v_score < 0 THEN
    v_score := 0;
  ELSIF v_score > 100 THEN
    v_score := 100;
  END IF;

  RETURN v_score;
END;
$$;

CREATE OR REPLACE VIEW public.member_engagement_scores_v AS
SELECT
  m.id AS member_id,
  public.calculate_member_engagement_score(m.id) AS engagement_score,
  CASE
    WHEN public.calculate_member_engagement_score(m.id) >= 70 THEN 'HIGH'
    WHEN public.calculate_member_engagement_score(m.id) >= 40 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS engagement_band
FROM public.members m;

-- Refresh helper for analytics MVs.
CREATE OR REPLACE FUNCTION public.refresh_member_analytics_materialized_views()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.member_activity_summary_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.member_subscription_status_mv;
$$;

-- Manual QA checklist (documentation only):
/*
  - member with frequent visits → HIGH score
  - member inactive 60+ days → LOW score
  - verify cohort metrics calculate correctly
  - verify staff cannot see members from other gyms
  - verify member profile analytics tab loads
*/
