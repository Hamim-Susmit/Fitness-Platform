-- Phase 4: Multi-gym core schema + RLS foundation

-- NOTE: This migration is additive and preserves Phase 1-3 behavior.
-- TODO: Backfill existing single-gym records to new tables before enforcing stricter RLS.
-- TODO: Map all current members to a default HOME gym in member_gym_access.
-- TODO: Roll out in a dual-mode compatibility window (members table + member_gym_access).
-- TODO: Apply staff->staff_roles backfill before deprecating staff table.

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_gym_access_type') THEN
    CREATE TYPE public.member_gym_access_type AS ENUM ('HOME', 'SECONDARY', 'ALL_ACCESS');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staff_role_type') THEN
    CREATE TYPE public.staff_role_type AS ENUM ('STAFF', 'MANAGER', 'ADMIN', 'INSTRUCTOR');
  END IF;
END $$;

-- Core chain table
CREATE TABLE IF NOT EXISTS public.gym_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Extend gyms for multi-location fields (preserve existing rows)
ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS chain_id uuid REFERENCES public.gym_chains (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS address jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS gyms_code_unique
  ON public.gyms (code)
  WHERE code IS NOT NULL;

-- Member access table (multi-gym)
CREATE TABLE IF NOT EXISTS public.member_gym_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  access_type public.member_gym_access_type NOT NULL DEFAULT 'HOME',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_gym_access_home_unique
  ON public.member_gym_access (member_id)
  WHERE access_type = 'HOME';

CREATE INDEX IF NOT EXISTS member_gym_access_member_idx
  ON public.member_gym_access (member_id);

CREATE INDEX IF NOT EXISTS member_gym_access_gym_idx
  ON public.member_gym_access (gym_id);

-- Staff roles table (multi-gym)
CREATE TABLE IF NOT EXISTS public.staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  role public.staff_role_type NOT NULL DEFAULT 'STAFF',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_unique
  ON public.staff_roles (user_id, gym_id, role);

CREATE INDEX IF NOT EXISTS staff_roles_user_idx
  ON public.staff_roles (user_id);

CREATE INDEX IF NOT EXISTS staff_roles_gym_idx
  ON public.staff_roles (gym_id);

-- Gym hours & holidays
CREATE TABLE IF NOT EXISTS public.gym_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week between 0 and 6),
  open_time time NOT NULL,
  close_time time NOT NULL,
  CONSTRAINT gym_hours_time_order_check CHECK (close_time > open_time)
);

CREATE TABLE IF NOT EXISTS public.gym_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES public.gyms (id) ON DELETE CASCADE,
  date date NOT NULL,
  label text
);

CREATE UNIQUE INDEX IF NOT EXISTS gym_holidays_unique
  ON public.gym_holidays (gym_id, date);

-- Reference updates (nullable for safety)
-- TODO: Backfill gym_id for legacy rows before making NOT NULL.
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_instances
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_schedules
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_bookings
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

-- TODO: add gym_id to payments once billing model migrates to multi-gym.

-- Utility functions
CREATE OR REPLACE FUNCTION public.get_member_active_gyms(p_user_id uuid)
RETURNS TABLE (gym_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Returns gyms a member can access (HOME, SECONDARY). ALL_ACCESS returns all active gyms.
  SELECT mga.gym_id
  FROM public.member_gym_access mga
  JOIN public.members m ON m.id = mga.member_id
  WHERE m.user_id = p_user_id
    AND mga.access_type IN ('HOME', 'SECONDARY')
  UNION
  SELECT g.id
  FROM public.gyms g
  WHERE EXISTS (
    SELECT 1
    FROM public.member_gym_access mga
    JOIN public.members m ON m.id = mga.member_id
    WHERE m.user_id = p_user_id
      AND mga.access_type = 'ALL_ACCESS'
  )
    AND g.active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_user_staff_roles(p_user_id uuid)
RETURNS TABLE (gym_id uuid, role public.staff_role_type)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sr.gym_id, sr.role
  FROM public.staff_roles sr
  WHERE sr.user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.has_gym_access(p_user_id uuid, p_gym_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.get_member_active_gyms(p_user_id) g WHERE g.gym_id = p_gym_id
  )
  OR EXISTS (
    SELECT 1 FROM public.staff_roles sr WHERE sr.user_id = p_user_id AND sr.gym_id = p_gym_id
  );
$$;

-- Enable RLS
ALTER TABLE public.gym_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_gym_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_holidays ENABLE ROW LEVEL SECURITY;

-- RLS policies
-- Gyms: read-only access scoped by member access or staff roles.
CREATE POLICY gyms_select_multi_gym
ON public.gyms
FOR SELECT
USING (public.has_gym_access(auth.uid(), id));

-- Member gym access: members can read their own, staff can read within gym.
CREATE POLICY member_gym_access_select_self
ON public.member_gym_access
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = member_id
      AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = gym_id
  )
);

-- Staff roles: staff can read roles scoped to their gym assignments.
CREATE POLICY staff_roles_select_same_gym
ON public.staff_roles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
      AND sr.gym_id = staff_roles.gym_id
  )
);

-- Class instances: members read only for gyms they can access, staff roles read by gym.
CREATE POLICY class_instances_select_multi_gym
ON public.class_instances
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

-- Checkins: members/staff limited to their gyms.
CREATE POLICY checkins_select_multi_gym
ON public.checkins
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

-- Attendance (stored on class_bookings): members/staff limited to their gyms.
CREATE POLICY class_bookings_select_multi_gym
ON public.class_bookings
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

-- RLS test queries
/*
  -- Member should only see gyms they can access
  select * from public.gyms;

  -- Member should only see checkins from allowed gyms
  select * from public.checkins;

  -- Staff should see roles for their gym only
  select * from public.staff_roles;

  -- Denied access should return zero rows
  select * from public.class_instances where gym_id = '00000000-0000-0000-0000-000000000000';

  -- RLS enforced on joins
  select ci.id, g.name
  from public.class_instances ci
  join public.gyms g on g.id = ci.gym_id;
*/
