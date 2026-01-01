-- Phase 5: Step 1 - Analytics event pipeline (foundations)

-- Event store (append-only).
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.members (id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  gym_id uuid REFERENCES public.gyms (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  source text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.analytics_events IS
  'Append-only analytics events. PII must NOT be stored in context payload.';

CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON public.analytics_events (created_at);

CREATE INDEX IF NOT EXISTS idx_events_event_type
  ON public.analytics_events (event_type);

CREATE INDEX IF NOT EXISTS idx_events_gym_id
  ON public.analytics_events (gym_id);

CREATE INDEX IF NOT EXISTS idx_events_member_id_partial
  ON public.analytics_events (member_id)
  WHERE member_id IS NOT NULL;

-- Event naming standard (documentation):
/*
  event_type conventions:
  - member.checkin.created
  - class.booking.created
  - class.booking.cancelled
  - subscription.created
  - subscription.renewed
  - payment.failed
  - app.login
  - app.session.start

  Rules:
  - use dotted domain naming
  - nouns first, action second
  - never log secrets or card data
  - keep payloads small + structured
*/

-- Retention & privacy (documentation only):
/*
  - Raw analytics events retained for 12-24 months.
  - On account deletion, consider anonymizing user_id/member_id references.
  - Do NOT store card numbers, passwords, or personal health data in context.
*/

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Trusted backend-only writes. Service role bypasses RLS.
DROP POLICY IF EXISTS analytics_events_insert_backend_only ON public.analytics_events;
CREATE POLICY analytics_events_insert_backend_only
ON public.analytics_events
FOR INSERT
WITH CHECK (false);

-- Server-side write function
CREATE OR REPLACE FUNCTION public.log_analytics_event(
  p_event_type text,
  p_user_id uuid DEFAULT NULL,
  p_member_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_gym_id uuid DEFAULT NULL,
  p_source text DEFAULT 'system',
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text := lower(coalesce(p_source, 'system'));
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_id uuid;
BEGIN
  IF v_source NOT IN ('web', 'mobile', 'system') THEN
    RAISE EXCEPTION 'invalid_source';
  END IF;

  INSERT INTO public.analytics_events (
    user_id,
    member_id,
    staff_id,
    gym_id,
    event_type,
    source,
    context
  )
  VALUES (
    p_user_id,
    p_member_id,
    p_staff_id,
    p_gym_id,
    p_event_type,
    v_source,
    v_context
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Materialized view for daily event counts.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.daily_event_counts_mv AS
SELECT
  date(created_at) AS event_date,
  event_type,
  count(*)::integer AS count
FROM public.analytics_events
GROUP BY date(created_at), event_type;

CREATE UNIQUE INDEX IF NOT EXISTS daily_event_counts_mv_unique
  ON public.daily_event_counts_mv (event_date, event_type);

CREATE INDEX IF NOT EXISTS daily_event_counts_mv_date_idx
  ON public.daily_event_counts_mv (event_date);

CREATE INDEX IF NOT EXISTS daily_event_counts_mv_event_idx
  ON public.daily_event_counts_mv (event_type);

CREATE OR REPLACE FUNCTION public.refresh_daily_event_counts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.daily_event_counts_mv;
$$;

-- Manual test checklist (documentation only):
/*
  - log event from web via /track-event
  - log event from mobile via /track-event
  - verify analytics_events row written with correct ids
  - verify append-only constraints (no updates/deletes by client)
  - verify daily_event_counts_mv contains new event
*/
