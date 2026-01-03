-- Phase 4: Step 8 - Location-based pricing + membership access scope

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_billing_period') THEN
    CREATE TYPE public.membership_billing_period AS ENUM ('MONTHLY', 'YEARLY');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_access_scope') THEN
    CREATE TYPE public.membership_access_scope AS ENUM ('SINGLE_GYM', 'REGION', 'ALL_LOCATIONS');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_subscription_status') THEN
    CREATE TYPE public.member_subscription_status AS ENUM ('ACTIVE', 'CANCELED', 'PAST_DUE', 'INACTIVE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES public.gym_chains (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.regions IS 'Logical regions for grouping gyms under a chain (pricing + access).';

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES public.regions (id) ON DELETE SET NULL;

ALTER TABLE public.membership_plans
  ADD COLUMN IF NOT EXISTS chain_id uuid REFERENCES public.gym_chains (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS billing_period public.membership_billing_period,
  ADD COLUMN IF NOT EXISTS base_price_cents integer,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS access_scope public.membership_access_scope NOT NULL DEFAULT 'SINGLE_GYM',
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.membership_plans.access_scope IS
  'Defines allowed gym access for subscriptions derived from this plan.';
COMMENT ON COLUMN public.membership_plans.base_price_cents IS
  'Default price for the plan before gym/region overrides.';

UPDATE public.membership_plans mp
SET chain_id = g.chain_id
FROM public.gyms g
WHERE mp.chain_id IS NULL
  AND mp.gym_id = g.id;

UPDATE public.membership_plans
SET base_price_cents = price_cents
WHERE base_price_cents IS NULL;

UPDATE public.membership_plans
SET billing_period = CASE interval
  WHEN 'monthly' THEN 'MONTHLY'
  WHEN 'yearly' THEN 'YEARLY'
  ELSE 'MONTHLY'
END
WHERE billing_period IS NULL;

UPDATE public.membership_plans
SET is_active = active
WHERE is_active IS NULL;

CREATE TABLE IF NOT EXISTS public.plan_gym_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.membership_plans (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  stripe_price_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_gym_overrides IS
  'Overrides plan pricing for a specific gym (location-based pricing).';

CREATE UNIQUE INDEX IF NOT EXISTS plan_gym_overrides_unique
  ON public.plan_gym_overrides (plan_id, gym_id);

CREATE TABLE IF NOT EXISTS public.plan_region_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.membership_plans (id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES public.regions (id) ON DELETE CASCADE,
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  stripe_price_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_region_overrides IS
  'Overrides plan pricing for an entire region of gyms.';

CREATE UNIQUE INDEX IF NOT EXISTS plan_region_overrides_unique
  ON public.plan_region_overrides (plan_id, region_id);

ALTER TABLE public.member_subscriptions
  ADD COLUMN IF NOT EXISTS home_gym_id uuid REFERENCES public.gyms (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS access_scope public.membership_access_scope NOT NULL DEFAULT 'SINGLE_GYM',
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

ALTER TABLE public.member_subscriptions
  DROP CONSTRAINT IF EXISTS member_subscriptions_status_check;

ALTER TABLE public.member_subscriptions
  ALTER COLUMN status TYPE public.member_subscription_status
  USING CASE
    WHEN status = 'active' THEN 'ACTIVE'::public.member_subscription_status
    ELSE 'INACTIVE'::public.member_subscription_status
  END;

ALTER TABLE public.member_subscriptions
  ALTER COLUMN status SET DEFAULT 'INACTIVE';

UPDATE public.member_subscriptions ms
SET home_gym_id = COALESCE(ms.home_gym_id, m.home_gym_id, m.gym_id)
FROM public.members m
WHERE ms.member_id = m.id;

UPDATE public.member_subscriptions ms
SET access_scope = COALESCE(ms.access_scope, mp.access_scope)
FROM public.membership_plans mp
WHERE ms.plan_id = mp.id;

COMMENT ON COLUMN public.member_subscriptions.access_scope IS
  'Tracks access scope derived from the linked membership plan.';

COMMENT ON COLUMN public.plan_gym_overrides.price_cents IS
  'Gym-level override used when displaying pricing for a specific location.';

-- Derive membership access from subscription configuration.
CREATE OR REPLACE FUNCTION public.derive_member_gym_access_from_subscription(
  p_member_id uuid,
  p_subscription_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription record;
  v_plan record;
  v_home_gym_id uuid;
  v_allowed_gym_ids uuid[];
  v_removed uuid[];
  v_added uuid[];
BEGIN
  SELECT ms.*, mp.chain_id, mp.access_scope
  INTO v_subscription
  FROM public.member_subscriptions ms
  JOIN public.membership_plans mp ON mp.id = ms.plan_id
  WHERE ms.id = p_subscription_id
    AND ms.member_id = p_member_id;

  IF v_subscription.id IS NULL THEN
    RETURN jsonb_build_object('error', 'subscription_not_found');
  END IF;

  v_home_gym_id := v_subscription.home_gym_id;

  IF v_home_gym_id IS NULL THEN
    SELECT m.gym_id INTO v_home_gym_id
    FROM public.members m
    WHERE m.id = p_member_id;
  END IF;

  IF v_subscription.access_scope = 'ALL_LOCATIONS' THEN
    v_allowed_gym_ids := ARRAY(
      SELECT g.id FROM public.gyms g WHERE g.chain_id = v_subscription.chain_id AND g.active = true
    );

    UPDATE public.member_gym_access
    SET status = 'EXPIRED'
    WHERE member_id = p_member_id
      AND access_source = 'PLAN';

    INSERT INTO public.member_gym_access (member_id, gym_id, access_type, status, access_source)
    VALUES (p_member_id, v_home_gym_id, 'ALL_ACCESS', 'ACTIVE', 'PLAN')
    ON CONFLICT (member_id)
    WHERE access_type = 'HOME'
    DO UPDATE SET gym_id = EXCLUDED.gym_id;

    RETURN jsonb_build_object('access_scope', 'ALL_LOCATIONS', 'gym_ids', v_allowed_gym_ids);
  END IF;

  IF v_subscription.access_scope = 'REGION' THEN
    v_allowed_gym_ids := ARRAY(
      SELECT g.id
      FROM public.gyms g
      WHERE g.region_id = (SELECT region_id FROM public.gyms WHERE id = v_home_gym_id)
        AND g.chain_id = v_subscription.chain_id
        AND g.active = true
    );
  ELSE
    v_allowed_gym_ids := ARRAY[v_home_gym_id];
  END IF;

  v_removed := ARRAY(
    SELECT gym_id
    FROM public.member_gym_access
    WHERE member_id = p_member_id
      AND access_source = 'PLAN'
      AND gym_id <> ALL(v_allowed_gym_ids)
  );

  UPDATE public.member_gym_access
  SET status = 'EXPIRED'
  WHERE member_id = p_member_id
    AND access_source = 'PLAN'
    AND gym_id <> ALL(v_allowed_gym_ids);

  INSERT INTO public.member_gym_access (member_id, gym_id, access_type, status, access_source)
  SELECT p_member_id, gym_id, 'SECONDARY', 'ACTIVE', 'PLAN'
  FROM unnest(v_allowed_gym_ids) AS gym_id
  ON CONFLICT DO NOTHING;

  UPDATE public.member_gym_access
  SET access_type = 'HOME', status = 'ACTIVE'
  WHERE member_id = p_member_id
    AND gym_id = v_home_gym_id
    AND access_source = 'PLAN';

  v_added := ARRAY(
    SELECT gym_id
    FROM public.member_gym_access
    WHERE member_id = p_member_id
      AND access_source = 'PLAN'
      AND status = 'ACTIVE'
  );

  RETURN jsonb_build_object(
    'access_scope', v_subscription.access_scope,
    'gym_ids', v_added,
    'removed', v_removed
  );
END;
$$;

-- RLS: plans + overrides must be scoped to the user chain.
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_gym_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_region_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS membership_plans_select ON public.membership_plans;
DROP POLICY IF EXISTS membership_plans_write_owner ON public.membership_plans;
DROP POLICY IF EXISTS membership_plans_update_owner ON public.membership_plans;
DROP POLICY IF EXISTS membership_plans_delete_owner ON public.membership_plans;

CREATE POLICY membership_plans_select_chain
ON public.membership_plans
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    JOIN public.gyms g ON g.id = m.gym_id
    WHERE m.user_id = auth.uid()
      AND g.chain_id = membership_plans.chain_id
  )
  OR EXISTS (
    SELECT 1 FROM public.staff_roles sr
    JOIN public.gyms g ON g.id = sr.gym_id
    WHERE sr.user_id = auth.uid()
      AND g.chain_id = membership_plans.chain_id
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_roles orr
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = membership_plans.chain_id
  )
);

CREATE POLICY membership_plans_write_corporate_admin
ON public.membership_plans
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = membership_plans.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
);

CREATE POLICY membership_plans_update_corporate_admin
ON public.membership_plans
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = membership_plans.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = membership_plans.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
);

CREATE POLICY membership_plans_delete_corporate_admin
ON public.membership_plans
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = membership_plans.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
);

CREATE POLICY plan_gym_overrides_select_chain
ON public.plan_gym_overrides
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.membership_plans mp
    JOIN public.staff_roles sr ON sr.gym_id = plan_gym_overrides.gym_id
    WHERE mp.id = plan_gym_overrides.plan_id
      AND sr.user_id = auth.uid()
      AND mp.chain_id = (SELECT g.chain_id FROM public.gyms g WHERE g.id = plan_gym_overrides.gym_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_gym_overrides.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
  )
);

CREATE POLICY plan_gym_overrides_write_corporate_admin
ON public.plan_gym_overrides
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_gym_overrides.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_gym_overrides.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
);

CREATE POLICY plan_region_overrides_select_chain
ON public.plan_region_overrides
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_region_overrides.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
  )
);

CREATE POLICY plan_region_overrides_write_corporate_admin
ON public.plan_region_overrides
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_region_overrides.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_roles orr
    JOIN public.membership_plans mp ON mp.id = plan_region_overrides.plan_id
    WHERE orr.user_id = auth.uid()
      AND orr.chain_id = mp.chain_id
      AND orr.role = 'CORPORATE_ADMIN'
  )
);

COMMENT ON TABLE public.member_subscriptions IS
  'Member subscriptions drive member_gym_access; access_scope is derived from active plan configuration.';
