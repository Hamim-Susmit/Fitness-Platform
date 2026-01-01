-- Phase 4: Step 2 - Home-gym assignment & cross-gym access rules

-- NOTE: Additive changes to preserve Phase 1-3 behavior.
-- TODO: Backfill members.home_gym_id and member_gym_access before enforcing NOT NULL.
-- TODO: Backfill checkins.gym_id, access_decision, decision_reason for legacy rows.
-- TODO: Ensure staff_roles is populated before relying on override validation.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_gym_access_status') THEN
    CREATE TYPE public.member_gym_access_status AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_gym_access_source') THEN
    CREATE TYPE public.member_gym_access_source AS ENUM ('PLAN', 'MANUAL_OVERRIDE', 'PROMO');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checkin_access_decision') THEN
    CREATE TYPE public.checkin_access_decision AS ENUM (
      'ALLOWED_HOME',
      'ALLOWED_SECONDARY',
      'ALLOWED_ALL_ACCESS',
      'ALLOWED_OVERRIDE',
      'DENIED_NO_ACCESS',
      'DENIED_EXPIRED',
      'DENIED_SUSPENDED'
    );
  END IF;
END $$;

-- Extend members with home gym
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS home_gym_id uuid REFERENCES public.gyms (id) ON DELETE SET NULL;

-- Extend member_gym_access
ALTER TABLE public.member_gym_access
  ADD COLUMN IF NOT EXISTS status public.member_gym_access_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS access_source public.member_gym_access_source NOT NULL DEFAULT 'PLAN';

-- Extend checkins
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS access_decision public.checkin_access_decision,
  ADD COLUMN IF NOT EXISTS decision_reason text;

-- Home-gym assignment function
CREATE OR REPLACE FUNCTION public.assign_home_gym(p_member_id uuid, p_gym_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure only one HOME record exists per member.
  UPDATE public.member_gym_access
  SET access_type = 'SECONDARY'
  WHERE member_id = p_member_id
    AND access_type = 'HOME'
    AND gym_id <> p_gym_id;

  INSERT INTO public.member_gym_access (member_id, gym_id, access_type, status, access_source)
  VALUES (p_member_id, p_gym_id, 'HOME', 'ACTIVE', 'MANUAL_OVERRIDE')
  ON CONFLICT (member_id)
  WHERE access_type = 'HOME'
  DO UPDATE SET gym_id = EXCLUDED.gym_id,
               status = EXCLUDED.status,
               access_source = EXCLUDED.access_source;

  UPDATE public.members
  SET home_gym_id = p_gym_id
  WHERE id = p_member_id;

  RETURN p_gym_id;
END;
$$;

-- Resolve member gym access function
CREATE OR REPLACE FUNCTION public.resolve_member_gym_access(p_member_id uuid, p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access record;
BEGIN
  -- Access is derived from the active member_subscriptions plan configuration.
  -- When subscriptions change (canceled/expired), re-run derive_member_gym_access_from_subscription.
  -- Prefer direct access record for gym.
  SELECT access_type, status
  INTO v_access
  FROM public.member_gym_access
  WHERE member_id = p_member_id
    AND gym_id = p_gym_id
  ORDER BY (status = 'ACTIVE') DESC
  LIMIT 1;

  IF v_access.access_type IS NULL THEN
    -- Fall back to ALL_ACCESS if present.
    SELECT access_type, status
    INTO v_access
    FROM public.member_gym_access
    WHERE member_id = p_member_id
      AND access_type = 'ALL_ACCESS'
    ORDER BY (status = 'ACTIVE') DESC
    LIMIT 1;
  END IF;

  IF v_access.access_type IS NULL THEN
    RETURN jsonb_build_object(
      'has_access', false,
      'access_type', 'NONE',
      'status', 'NONE'
    );
  END IF;

  IF v_access.status = 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'has_access', true,
      'access_type', v_access.access_type,
      'status', v_access.status
    );
  END IF;

  RETURN jsonb_build_object(
    'has_access', false,
    'access_type', v_access.access_type,
    'status', v_access.status
  );
END;
$$;

-- Audit table for home-gym assignments and overrides
CREATE TABLE IF NOT EXISTS public.member_gym_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_gym_access_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_gym_access_events_select_staff
ON public.member_gym_access_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = member_gym_access_events.gym_id
  )
);

-- RLS updates
-- Members can only read their own gym access records.
CREATE POLICY member_gym_access_select_member_only
ON public.member_gym_access
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = member_gym_access.member_id
      AND m.user_id = auth.uid()
  )
);

-- Checkins: members read only their own checkins; staff scoped to their gym roles.
DROP POLICY IF EXISTS checkins_select_multi_gym ON public.checkins;

CREATE POLICY checkins_select_member_own
ON public.checkins
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = checkins.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY checkins_select_staff_gym
ON public.checkins
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = checkins.gym_id
  )
);

-- Remove overly broad booking access (members should not see all bookings in a gym).
DROP POLICY IF EXISTS class_bookings_select_multi_gym ON public.class_bookings;

-- Test queries
/*
  -- Member checks into home gym → allowed
  select public.resolve_member_gym_access('member_id', 'home_gym_id');

  -- Member checks into secondary gym → allowed
  select public.resolve_member_gym_access('member_id', 'secondary_gym_id');

  -- Member without access → denied
  select public.resolve_member_gym_access('member_id', 'unknown_gym_id');

  -- Suspended member → denied
  update public.member_gym_access set status = 'SUSPENDED' where member_id = 'member_id';
  select public.resolve_member_gym_access('member_id', 'home_gym_id');

  -- Staff override → allowed_override recorded
  select * from public.checkins where access_decision = 'ALLOWED_OVERRIDE';
*/
