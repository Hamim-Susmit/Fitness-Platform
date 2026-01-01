-- Phase 4: Step 10 - Multi-gym QA, migration safety & sanity checks

/*
  RLS verification checklist (manual):
  - Members with multi-gym access can only read their own data.
  - Staff assigned to gym A cannot read gym B data.
  - Corporate roles can read chain-wide analytics but cannot mutate restricted resources.

  Suggested queries:
  - select * from public.member_gym_access where member_id != <member_id>;
  - select * from public.class_bookings where gym_id != <staff_gym_id>;
  - select * from public.gym_audit_events where gym_id not in (<corp_chain_gyms>);

  TODO: automate RLS verification with SQL tests.
  TODO: add CI checks for multi-tenant access regressions.
*/

-- One-time helper to backfill single-gym deployments into multi-gym schema.
CREATE OR REPLACE FUNCTION public.backfill_single_gym_to_multi_gym(
  p_chain_id uuid,
  p_gym_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_gym_id uuid;
  v_gym_count integer := 0;
BEGIN
  -- WARNING: this helper is intended for controlled environments only.
  -- Ensure this runs during a maintenance window with full backups.

  SELECT count(*) INTO v_gym_count FROM public.gyms;

  SELECT id INTO v_existing_gym_id
  FROM public.gyms
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_gym_id IS NULL THEN
    RAISE EXCEPTION 'no gyms available for backfill';
  END IF;

  -- If the desired gym id is missing, clone the existing gym row into p_gym_id.
  IF NOT EXISTS (SELECT 1 FROM public.gyms WHERE id = p_gym_id) THEN
  INSERT INTO public.gyms (id, owner_id, name, code, timezone, address, latitude, longitude, chain_id, created_at, updated_at)
    SELECT p_gym_id, owner_id, name, code, timezone, address, latitude, longitude, p_chain_id, created_at, updated_at
    FROM public.gyms
    WHERE id = v_existing_gym_id;
  END IF;

  -- Update gyms to ensure chain_id consistency.
  UPDATE public.gyms
  SET chain_id = p_chain_id
  WHERE id = p_gym_id;

  -- Backfill nullable gym references.
  UPDATE public.members SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.staff SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.checkins SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.class_schedules SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.class_instances SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.class_bookings SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.member_subscriptions SET home_gym_id = p_gym_id WHERE home_gym_id IS NULL;
  UPDATE public.membership_plans SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.gym_hours SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.gym_holidays SET gym_id = p_gym_id WHERE gym_id IS NULL;
  UPDATE public.member_gym_access SET gym_id = p_gym_id WHERE gym_id IS NULL;

  -- Seed HOME access for members that lack member_gym_access rows.
  INSERT INTO public.member_gym_access (member_id, gym_id, access_type, status, access_source)
  SELECT m.id, p_gym_id, 'HOME', 'ACTIVE', 'MANUAL_OVERRIDE'
  FROM public.members m
  WHERE NOT EXISTS (
    SELECT 1 FROM public.member_gym_access mga WHERE mga.member_id = m.id
  );

  RETURN jsonb_build_object(
    'gym_count', v_gym_count,
    'primary_gym_id', v_existing_gym_id,
    'target_gym_id', p_gym_id
  );
END;
$$;

-- Diagnostic view for missing or invalid gym references.
CREATE OR REPLACE VIEW public.invalid_gym_references_v AS
SELECT 'members' AS table_name, m.id AS record_id, m.gym_id AS bad_gym_id, 'MISSING_GYM_ID' AS issue
FROM public.members m
WHERE m.gym_id IS NULL
UNION ALL
SELECT 'members', m.id, m.gym_id, 'INVALID_GYM_ID'
FROM public.members m
LEFT JOIN public.gyms g ON g.id = m.gym_id
WHERE m.gym_id IS NOT NULL AND g.id IS NULL
UNION ALL
SELECT 'checkins', c.id, c.gym_id, 'MISSING_GYM_ID'
FROM public.checkins c
WHERE c.gym_id IS NULL
UNION ALL
SELECT 'checkins', c.id, c.gym_id, 'INVALID_GYM_ID'
FROM public.checkins c
LEFT JOIN public.gyms g ON g.id = c.gym_id
WHERE c.gym_id IS NOT NULL AND g.id IS NULL
UNION ALL
SELECT 'class_schedules', cs.id, cs.gym_id, 'MISSING_GYM_ID'
FROM public.class_schedules cs
WHERE cs.gym_id IS NULL
UNION ALL
SELECT 'class_schedules', cs.id, cs.gym_id, 'INVALID_GYM_ID'
FROM public.class_schedules cs
LEFT JOIN public.gyms g ON g.id = cs.gym_id
WHERE cs.gym_id IS NOT NULL AND g.id IS NULL
UNION ALL
SELECT 'class_instances', ci.id, ci.gym_id, 'MISSING_GYM_ID'
FROM public.class_instances ci
WHERE ci.gym_id IS NULL
UNION ALL
SELECT 'class_instances', ci.id, ci.gym_id, 'INVALID_GYM_ID'
FROM public.class_instances ci
LEFT JOIN public.gyms g ON g.id = ci.gym_id
WHERE ci.gym_id IS NOT NULL AND g.id IS NULL
UNION ALL
SELECT 'member_subscriptions', ms.id, ms.home_gym_id, 'MISSING_GYM_ID'
FROM public.member_subscriptions ms
WHERE ms.home_gym_id IS NULL
UNION ALL
SELECT 'member_subscriptions', ms.id, ms.home_gym_id, 'INVALID_GYM_ID'
FROM public.member_subscriptions ms
LEFT JOIN public.gyms g ON g.id = ms.home_gym_id
WHERE ms.home_gym_id IS NOT NULL AND g.id IS NULL;

-- Orphaned member access entries.
CREATE OR REPLACE VIEW public.orphaned_member_access_v AS
SELECT mga.member_id, mga.gym_id, 'MEMBER_MISSING' AS reason
FROM public.member_gym_access mga
LEFT JOIN public.members m ON m.id = mga.member_id
WHERE m.id IS NULL
UNION ALL
SELECT mga.member_id, mga.gym_id, 'GYM_MISSING' AS reason
FROM public.member_gym_access mga
LEFT JOIN public.gyms g ON g.id = mga.gym_id
WHERE g.id IS NULL
UNION ALL
SELECT mga.member_id, mga.gym_id, 'GYM_INACTIVE' AS reason
FROM public.member_gym_access mga
JOIN public.gyms g ON g.id = mga.gym_id
WHERE g.active = false;

-- Subscription vs access mismatches.
CREATE OR REPLACE VIEW public.inconsistent_access_vs_subscription_v AS
SELECT
  m.id AS member_id,
  mga.gym_id,
  EXISTS (
    SELECT 1 FROM public.member_subscriptions ms
    WHERE ms.member_id = m.id
      AND ms.status = 'ACTIVE'
  ) AS has_active_subscription,
  EXISTS (
    SELECT 1 FROM public.member_gym_access mga2
    WHERE mga2.member_id = m.id
      AND mga2.gym_id = mga.gym_id
      AND mga2.status = 'ACTIVE'
  ) AS has_active_access,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.member_gym_access mga2
      WHERE mga2.member_id = m.id
        AND mga2.gym_id = mga.gym_id
        AND mga2.status = 'ACTIVE'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.member_subscriptions ms
      WHERE ms.member_id = m.id
        AND ms.status = 'ACTIVE'
    ) THEN 'NO_SUBSCRIPTION_HAS_ACCESS'
    WHEN EXISTS (
      SELECT 1 FROM public.member_subscriptions ms
      WHERE ms.member_id = m.id
        AND ms.status = 'ACTIVE'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.member_gym_access mga2
      WHERE mga2.member_id = m.id
        AND mga2.gym_id = mga.gym_id
        AND mga2.status = 'ACTIVE'
    ) THEN 'HAS_SUBSCRIPTION_NO_ACCESS'
    ELSE 'OK'
  END AS mismatch_type
FROM public.members m
JOIN public.member_gym_access mga ON mga.member_id = m.id
WHERE EXISTS (
  SELECT 1 FROM public.member_subscriptions ms
  WHERE ms.member_id = m.id
    AND ms.status = 'ACTIVE'
)
OR EXISTS (
  SELECT 1 FROM public.member_gym_access mga2
  WHERE mga2.member_id = m.id
    AND mga2.status = 'ACTIVE'
);

-- Repair helpers
CREATE OR REPLACE FUNCTION public.repair_inconsistent_access_for_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription record;
  v_actions jsonb := '[]'::jsonb;
BEGIN
  SELECT ms.id
  INTO v_subscription
  FROM public.member_subscriptions ms
  WHERE ms.member_id = p_member_id
    AND ms.status = 'ACTIVE'
  ORDER BY ms.created_at DESC
  LIMIT 1;

  IF v_subscription.id IS NULL THEN
    UPDATE public.member_gym_access
    SET status = 'EXPIRED'
    WHERE member_id = p_member_id;

    RETURN jsonb_build_object('member_id', p_member_id, 'action', 'expired_access');
  END IF;

  -- Re-derive access from current subscription.
  PERFORM public.derive_member_gym_access_from_subscription(p_member_id, v_subscription.id);

  RETURN jsonb_build_object('member_id', p_member_id, 'action', 'rederived_access');
END;
$$;

CREATE OR REPLACE FUNCTION public.repair_all_inconsistent_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member record;
  v_count integer := 0;
BEGIN
  -- WARNING: schedule off-peak to reduce lock contention.
  -- Process in small batches to avoid long-running transactions.
  FOR v_member IN
    SELECT DISTINCT member_id
    FROM public.inconsistent_access_vs_subscription_v
    WHERE mismatch_type <> 'OK'
    LIMIT 200
  LOOP
    PERFORM public.repair_inconsistent_access_for_member(v_member.member_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_count);
END;
$$;

-- Informational view for potential cross-gym anomalies.
CREATE OR REPLACE VIEW public.suspicious_cross_gym_activity_v AS
SELECT
  m.id AS member_id,
  m.home_gym_id,
  COUNT(DISTINCT c.gym_id) AS gyms_visited_count,
  ARRAY_AGG(DISTINCT c.gym_id) AS distinct_gym_ids,
  COUNT(*) AS checkins_last_30_days,
  MAX(c.checked_in_at) AS last_checkin_at
FROM public.members m
JOIN public.checkins c ON c.member_id = m.id
WHERE c.checked_in_at >= now() - interval '30 days'
GROUP BY m.id, m.home_gym_id
HAVING COUNT(DISTINCT c.gym_id) > 3;

COMMENT ON VIEW public.suspicious_cross_gym_activity_v IS
  'Informational only; do not automate enforcement without manual review.';
