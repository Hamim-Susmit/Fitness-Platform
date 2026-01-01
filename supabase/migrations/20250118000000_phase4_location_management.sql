-- Phase 4: Step 7 - Location management console primitives

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_audit_event_type') THEN
    CREATE TYPE public.gym_audit_event_type AS ENUM (
      'GYM_UPDATED',
      'HOURS_UPDATED',
      'HOLIDAY_ADDED',
      'HOLIDAY_REMOVED',
      'AMENITY_ADDED',
      'AMENITY_REMOVED',
      'STAFF_ASSIGNED',
      'STAFF_ROLE_CHANGED',
      'STAFF_REMOVED',
      'NOTE_ADDED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.gym_amenities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  label text NOT NULL,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gym_amenities IS 'Configurable amenity list displayed for each gym location.';

CREATE TABLE IF NOT EXISTS public.gym_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gym_notes IS 'Internal staff notes recorded for gym locations (private, staff-only).';

CREATE TABLE IF NOT EXISTS public.gym_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  event_type public.gym_audit_event_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gym_audit_events IS 'Audit log for gym location changes, staff updates, and operational events.';

CREATE INDEX IF NOT EXISTS gym_audit_events_gym_created_idx
  ON public.gym_audit_events (gym_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.can_read_gym(p_user_id uuid, p_gym_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = p_user_id
      AND sr.gym_id = p_gym_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.organization_roles orr
    JOIN public.gyms g ON g.chain_id = orr.chain_id
    WHERE orr.user_id = p_user_id
      AND g.id = p_gym_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_gym(p_user_id uuid, p_gym_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = p_user_id
      AND sr.gym_id = p_gym_id
      AND sr.role IN ('MANAGER', 'ADMIN')
  );
$$;

ALTER TABLE public.gym_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_audit_events ENABLE ROW LEVEL SECURITY;

-- Gyms: staff + org roles can read; only manager/admin can write.
DROP POLICY IF EXISTS gyms_select_multi_gym ON public.gyms;
DROP POLICY IF EXISTS gyms_update_staff ON public.gyms;
DROP POLICY IF EXISTS gyms_insert_staff ON public.gyms;
DROP POLICY IF EXISTS gyms_delete_staff ON public.gyms;

CREATE POLICY gyms_select_staff_org
ON public.gyms
FOR SELECT
USING (public.can_read_gym(auth.uid(), id));

CREATE POLICY gyms_update_manager_admin
ON public.gyms
FOR UPDATE
USING (public.can_manage_gym(auth.uid(), id))
WITH CHECK (public.can_manage_gym(auth.uid(), id));

CREATE POLICY gyms_insert_manager_admin
ON public.gyms
FOR INSERT
WITH CHECK (public.can_manage_gym(auth.uid(), id));

CREATE POLICY gyms_delete_manager_admin
ON public.gyms
FOR DELETE
USING (public.can_manage_gym(auth.uid(), id));

-- Gym hours & holidays: read-only unless manager/admin.
DROP POLICY IF EXISTS gym_hours_select_staff ON public.gym_hours;
DROP POLICY IF EXISTS gym_hours_write_staff ON public.gym_hours;
DROP POLICY IF EXISTS gym_holidays_select_staff ON public.gym_holidays;
DROP POLICY IF EXISTS gym_holidays_write_staff ON public.gym_holidays;

CREATE POLICY gym_hours_select_staff_org
ON public.gym_hours
FOR SELECT
USING (public.can_read_gym(auth.uid(), gym_id));

CREATE POLICY gym_hours_write_manager_admin
ON public.gym_hours
FOR INSERT
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_hours_update_manager_admin
ON public.gym_hours
FOR UPDATE
USING (public.can_manage_gym(auth.uid(), gym_id))
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_hours_delete_manager_admin
ON public.gym_hours
FOR DELETE
USING (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_holidays_select_staff_org
ON public.gym_holidays
FOR SELECT
USING (public.can_read_gym(auth.uid(), gym_id));

CREATE POLICY gym_holidays_write_manager_admin
ON public.gym_holidays
FOR INSERT
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_holidays_update_manager_admin
ON public.gym_holidays
FOR UPDATE
USING (public.can_manage_gym(auth.uid(), gym_id))
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_holidays_delete_manager_admin
ON public.gym_holidays
FOR DELETE
USING (public.can_manage_gym(auth.uid(), gym_id));

-- Amenities: read-only unless manager/admin.
CREATE POLICY gym_amenities_select_staff_org
ON public.gym_amenities
FOR SELECT
USING (public.can_read_gym(auth.uid(), gym_id));

CREATE POLICY gym_amenities_write_manager_admin
ON public.gym_amenities
FOR INSERT
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_amenities_update_manager_admin
ON public.gym_amenities
FOR UPDATE
USING (public.can_manage_gym(auth.uid(), gym_id))
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_amenities_delete_manager_admin
ON public.gym_amenities
FOR DELETE
USING (public.can_manage_gym(auth.uid(), gym_id));

-- Staff roles: org + local staff can read; only manager/admin can write.
DROP POLICY IF EXISTS staff_roles_select_same_gym ON public.staff_roles;
DROP POLICY IF EXISTS staff_roles_write_manager_admin ON public.staff_roles;

CREATE POLICY staff_roles_select_staff_org
ON public.staff_roles
FOR SELECT
USING (public.can_read_gym(auth.uid(), staff_roles.gym_id));

CREATE POLICY staff_roles_write_manager_admin
ON public.staff_roles
FOR INSERT
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY staff_roles_update_manager_admin
ON public.staff_roles
FOR UPDATE
USING (public.can_manage_gym(auth.uid(), gym_id))
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY staff_roles_delete_manager_admin
ON public.staff_roles
FOR DELETE
USING (public.can_manage_gym(auth.uid(), gym_id));

-- Gym notes: staff + org roles can read; only manager/admin can write.
CREATE POLICY gym_notes_select_staff_org
ON public.gym_notes
FOR SELECT
USING (public.can_read_gym(auth.uid(), gym_id));

CREATE POLICY gym_notes_write_manager_admin
ON public.gym_notes
FOR INSERT
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_notes_update_manager_admin
ON public.gym_notes
FOR UPDATE
USING (public.can_manage_gym(auth.uid(), gym_id))
WITH CHECK (public.can_manage_gym(auth.uid(), gym_id));

CREATE POLICY gym_notes_delete_manager_admin
ON public.gym_notes
FOR DELETE
USING (public.can_manage_gym(auth.uid(), gym_id));

-- Audit log: read-only for staff + org roles.
CREATE POLICY gym_audit_events_select_staff_org
ON public.gym_audit_events
FOR SELECT
USING (public.can_read_gym(auth.uid(), gym_id));
