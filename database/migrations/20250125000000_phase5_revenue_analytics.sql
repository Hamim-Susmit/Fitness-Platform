-- Phase 5: Step 5 - Revenue & subscription analytics

-- Privacy & accounting notes (documentation only):
/*
  - Platform analytics are directional; Stripe remains the source of truth for revenue.
  - Finance reports should minimize member PII exposure where possible.
  - Accounting reconciliation should be performed via exports or BI tooling.
*/

-- Materialized view for current subscription MRR snapshots.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.subscription_mrr_mv AS
WITH resolved_plans AS (
  SELECT
    ms.subscription_id,
    ms.member_id,
    ms.plan_id,
    COALESCE(ms.home_gym_id, m.home_gym_id, m.gym_id) AS gym_id,
    ms.status,
    ms.started_at,
    COALESCE(ms.ends_at, ms.current_period_end) AS ended_at,
    mp.billing_period,
    mp.base_price_cents,
    g.region_id,
    pgo.price_cents AS gym_price_cents,
    pro.price_cents AS region_price_cents
  FROM public.member_subscriptions ms
  JOIN public.members m ON m.id = ms.member_id
  LEFT JOIN public.gyms g ON g.id = COALESCE(ms.home_gym_id, m.home_gym_id, m.gym_id)
  LEFT JOIN public.membership_plans mp ON mp.id = ms.plan_id
  LEFT JOIN public.plan_gym_overrides pgo
    ON pgo.plan_id = ms.plan_id
    AND pgo.gym_id = COALESCE(ms.home_gym_id, m.home_gym_id, m.gym_id)
  LEFT JOIN public.plan_region_overrides pro
    ON pro.plan_id = ms.plan_id
    AND pro.region_id = g.region_id
)
SELECT
  subscription_id,
  member_id,
  plan_id,
  gym_id,
  COALESCE(gym_price_cents, region_price_cents, base_price_cents)::numeric AS price_amount,
  CASE
    WHEN billing_period = 'YEARLY' THEN 'year'
    ELSE 'month'
  END AS price_interval,
  CASE
    WHEN COALESCE(gym_price_cents, region_price_cents, base_price_cents) IS NULL THEN NULL
    WHEN billing_period = 'YEARLY' THEN COALESCE(gym_price_cents, region_price_cents, base_price_cents)::numeric / 12
    ELSE COALESCE(gym_price_cents, region_price_cents, base_price_cents)::numeric
  END AS mrr,
  CASE
    WHEN status IN ('ACTIVE', 'PAST_DUE')
      AND (ended_at IS NULL OR ended_at > now()) THEN true
    ELSE false
  END AS is_active,
  started_at,
  ended_at
FROM resolved_plans;

CREATE INDEX IF NOT EXISTS subscription_mrr_mv_gym_idx
  ON public.subscription_mrr_mv (gym_id);

CREATE INDEX IF NOT EXISTS subscription_mrr_mv_plan_idx
  ON public.subscription_mrr_mv (plan_id);

CREATE INDEX IF NOT EXISTS subscription_mrr_mv_member_idx
  ON public.subscription_mrr_mv (member_id);

-- Materialized view for revenue by plan and month.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.revenue_by_plan_mv AS
WITH subscription_months AS (
  SELECT
    sm.subscription_id,
    sm.plan_id,
    sm.gym_id,
    sm.mrr,
    generate_series(
      date_trunc('month', sm.started_at),
      date_trunc('month', COALESCE(sm.ended_at, now())),
      interval '1 month'
    ) AS month
  FROM public.subscription_mrr_mv sm
  WHERE sm.mrr IS NOT NULL
)
SELECT
  plan_id,
  gym_id,
  date_trunc('month', month)::date AS month,
  SUM(mrr)::numeric AS mrr_total,
  (SUM(mrr) * 12)::numeric AS arr_contribution,
  COUNT(DISTINCT subscription_id)::integer AS active_subscriptions
FROM subscription_months
GROUP BY plan_id, gym_id, date_trunc('month', month);

CREATE INDEX IF NOT EXISTS revenue_by_plan_month_idx
  ON public.revenue_by_plan_mv (month);

-- Materialized view for failed payments visibility.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.failed_payments_mv AS
WITH latest_plan AS (
  SELECT
    ms.member_id,
    ms.plan_id,
    COALESCE(ms.home_gym_id, m.home_gym_id, m.gym_id) AS gym_id,
    ROW_NUMBER() OVER (PARTITION BY ms.member_id ORDER BY ms.started_at DESC, ms.created_at DESC) AS rn
  FROM public.member_subscriptions ms
  JOIN public.members m ON m.id = ms.member_id
)
SELECT
  t.id AS payment_id,
  s.member_id,
  lp.gym_id,
  lp.plan_id,
  t.created_at AS failed_at,
  COALESCE(t.refund_reason, 'payment_failed') AS failure_reason,
  CASE
    WHEN s.delinquency_state IN ('pending_retry', 'past_due', 'in_grace') THEN 'retrying'
    WHEN s.delinquency_state = 'canceled' THEN 'canceled'
    ELSE 'unknown'
  END AS retry_status,
  COUNT(*) OVER (PARTITION BY s.id)::integer AS attempt_count
FROM public.transactions t
JOIN public.subscriptions s ON s.id = t.subscription_id
LEFT JOIN latest_plan lp ON lp.member_id = s.member_id AND lp.rn = 1
WHERE t.status = 'failed';

CREATE INDEX IF NOT EXISTS failed_payments_mv_failed_at_idx
  ON public.failed_payments_mv (failed_at);

-- Revenue movement metrics (expansion, contraction, churn signals).
-- Rules:
--  - expansion = plan upgrade or price increase
--  - contraction = downgrade or discount
--  - churned = cancelled or expired subscription
CREATE OR REPLACE VIEW public.revenue_movement_v AS
WITH subscription_months AS (
  SELECT
    sm.subscription_id,
    sm.mrr,
    date_trunc('month', month)::date AS month,
    sm.ended_at
  FROM public.subscription_mrr_mv sm
  JOIN LATERAL generate_series(
    date_trunc('month', sm.started_at),
    date_trunc('month', COALESCE(sm.ended_at, now())),
    interval '1 month'
  ) AS month ON true
  WHERE sm.mrr IS NOT NULL
),
changes AS (
  SELECT
    subscription_id,
    month,
    mrr,
    LAG(mrr) OVER (PARTITION BY subscription_id ORDER BY month) AS prev_mrr,
    CASE
      WHEN ended_at IS NOT NULL AND date_trunc('month', ended_at)::date = month THEN true
      ELSE false
    END AS ended_this_month
  FROM subscription_months
)
SELECT
  month,
  SUM(CASE WHEN prev_mrr IS NULL THEN mrr ELSE 0 END)::numeric AS new_mrr,
  SUM(CASE WHEN prev_mrr IS NOT NULL AND mrr > prev_mrr THEN (mrr - prev_mrr) ELSE 0 END)::numeric AS expansion_mrr,
  SUM(CASE WHEN prev_mrr IS NOT NULL AND mrr < prev_mrr THEN (prev_mrr - mrr) ELSE 0 END)::numeric AS contraction_mrr,
  SUM(CASE WHEN ended_this_month THEN mrr ELSE 0 END)::numeric AS churned_mrr,
  (
    SUM(CASE WHEN prev_mrr IS NULL THEN mrr ELSE 0 END)
    + SUM(CASE WHEN prev_mrr IS NOT NULL AND mrr > prev_mrr THEN (mrr - prev_mrr) ELSE 0 END)
    - SUM(CASE WHEN prev_mrr IS NOT NULL AND mrr < prev_mrr THEN (prev_mrr - mrr) ELSE 0 END)
    - SUM(CASE WHEN ended_this_month THEN mrr ELSE 0 END)
  )::numeric AS net_new_mrr,
  SUM(mrr)::numeric AS mrr_ending
FROM changes
GROUP BY month
ORDER BY month;

-- Refresh helper for revenue analytics MVs.
-- NOTE: schedule background refresh later (cron/queue).
CREATE OR REPLACE FUNCTION public.refresh_revenue_materialized_views()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.subscription_mrr_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.revenue_by_plan_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.failed_payments_mv;
$$;

-- Manual QA checklist (documentation only):
/*
  - upgrading plan increases expansion MRR
  - cancellations show churned MRR
  - failed payment appears in report
  - corporate users can compare locations
  - refresh utilities rebuild data correctly
*/
