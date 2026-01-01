-- Phase 4: Step 9 - Per-location capacity limits & load protection

CREATE TABLE IF NOT EXISTS public.gym_capacity_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  max_active_members integer,
  soft_limit_threshold integer,
  hard_limit_enforced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gym_capacity_limits IS
  'Per-location capacity settings for active memberships. Null max = unlimited.';

CREATE UNIQUE INDEX IF NOT EXISTS gym_capacity_limits_gym_unique
  ON public.gym_capacity_limits (gym_id);

CREATE TABLE IF NOT EXISTS public.plan_location_capacity_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.membership_plans (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  max_active_members integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_location_capacity_limits IS
  'Optional plan-specific capacity caps per gym; evaluated alongside gym_capacity_limits.';

CREATE UNIQUE INDEX IF NOT EXISTS plan_location_capacity_unique
  ON public.plan_location_capacity_limits (plan_id, gym_id);

-- TODO: extend analytics materialized views to include capacity snapshots for historical tracking.

-- Returns capacity summary for a gym location.
CREATE OR REPLACE FUNCTION public.get_gym_capacity_status(p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit record;
  v_active_count integer := 0;
  v_status text := 'OK';
  v_percent numeric := 0;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    v_allowed := true;
  ELSE
    v_allowed := EXISTS (
      SELECT 1 FROM public.staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.gym_id = p_gym_id
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_roles orr
      JOIN public.gyms g ON g.chain_id = orr.chain_id
      WHERE orr.user_id = auth.uid()
        AND g.id = p_gym_id
    );
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT max_active_members, soft_limit_threshold, hard_limit_enforced
  INTO v_limit
  FROM public.gym_capacity_limits
  WHERE gym_id = p_gym_id;

  SELECT count(*) INTO v_active_count
  FROM public.member_subscriptions ms
  WHERE ms.home_gym_id = p_gym_id
    AND ms.status = 'ACTIVE';

  IF v_limit.max_active_members IS NULL THEN
    v_status := 'OK';
    v_percent := 0;
  ELSE
    v_percent := round((v_active_count::numeric / v_limit.max_active_members::numeric) * 100, 2);
    IF v_active_count >= v_limit.max_active_members AND v_limit.hard_limit_enforced THEN
      v_status := 'BLOCK_NEW';
    ELSIF v_active_count >= v_limit.max_active_members THEN
      v_status := 'AT_CAPACITY';
    ELSIF v_limit.soft_limit_threshold IS NOT NULL AND v_active_count >= v_limit.soft_limit_threshold THEN
      v_status := 'NEAR_LIMIT';
    ELSE
      v_status := 'OK';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'gym_id', p_gym_id,
    'active_members_count', v_active_count,
    'max_active_members', v_limit.max_active_members,
    'soft_limit_threshold', v_limit.soft_limit_threshold,
    'hard_limit_enforced', COALESCE(v_limit.hard_limit_enforced, false),
    'capacity_percent', v_percent,
    'status', v_status
  );
END;
$$;

-- Returns plan-specific capacity check results for a gym.
CREATE OR REPLACE FUNCTION public.check_plan_capacity_for_gym(p_plan_id uuid, p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit record;
  v_active_count integer := 0;
  v_status text := 'NO_LIMIT';
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    v_allowed := true;
  ELSE
    v_allowed := EXISTS (
      SELECT 1 FROM public.staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.gym_id = p_gym_id
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_roles orr
      JOIN public.gyms g ON g.chain_id = orr.chain_id
      WHERE orr.user_id = auth.uid()
        AND g.id = p_gym_id
    );
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT max_active_members
  INTO v_limit
  FROM public.plan_location_capacity_limits
  WHERE plan_id = p_plan_id
    AND gym_id = p_gym_id;

  IF v_limit.max_active_members IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'NO_LIMIT',
      'active_count', 0,
      'max_allowed', NULL
    );
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.member_subscriptions ms
  WHERE ms.plan_id = p_plan_id
    AND ms.home_gym_id = p_gym_id
    AND ms.status = 'ACTIVE';

  IF v_active_count > v_limit.max_active_members THEN
    v_status := 'BLOCK_NEW';
  ELSIF v_active_count = v_limit.max_active_members THEN
    v_status := 'AT_CAPACITY';
  ELSE
    v_status := 'OK';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'active_count', v_active_count,
    'max_allowed', v_limit.max_active_members
  );
END;
$$;

-- RLS: members cannot read capacity values; staff can read scoped to gyms; corporate can read chain-wide.
ALTER TABLE public.gym_capacity_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_location_capacity_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gym_capacity_limits_select ON public.gym_capacity_limits;
DROP POLICY IF EXISTS gym_capacity_limits_write ON public.gym_capacity_limits;
DROP POLICY IF EXISTS plan_location_capacity_limits_select ON public.plan_location_capacity_limits;
DROP POLICY IF EXISTS plan_location_capacity_limits_write ON public.plan_location_capacity_limits;

CREATE POLICY gym_capacity_limits_select_staff_org
ON public.gym_capacity_limits
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = gym_capacity_limits.gym_id
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.gyms g ON g.chain_id = orr.chain_id
    WHERE orr.user_id = auth.uid()
      AND g.id = gym_capacity_limits.gym_id
  )
);

CREATE POLICY gym_capacity_limits_write_staff_org
ON public.gym_capacity_limits
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = gym_capacity_limits.gym_id
      AND sr.role IN ('MANAGER', 'ADMIN')
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.gyms g ON g.chain_id = orr.chain_id
    WHERE orr.user_id = auth.uid()
      AND g.id = gym_capacity_limits.gym_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = gym_capacity_limits.gym_id
      AND sr.role IN ('MANAGER', 'ADMIN')
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.gyms g ON g.chain_id = orr.chain_id
    WHERE orr.user_id = auth.uid()
      AND g.id = gym_capacity_limits.gym_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
);

CREATE POLICY plan_location_capacity_limits_select_staff_org
ON public.plan_location_capacity_limits
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = plan_location_capacity_limits.gym_id
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.gyms g ON g.chain_id = orr.chain_id
    WHERE orr.user_id = auth.uid()
      AND g.id = plan_location_capacity_limits.gym_id
  )
);

CREATE POLICY plan_location_capacity_limits_write_corporate_admin
ON public.plan_location_capacity_limits
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_location_capacity_limits.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_location_capacity_limits.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
);

COMMENT ON TABLE public.gym_capacity_limits IS
  'Capacity enforcement must never rely on UI logic. Backend + SQL rules determine allowance.';
