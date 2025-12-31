-- Phase 4: Location-aware scheduling & classes

-- Ensure gym_id is present and required for all scheduling artifacts.
-- Every class artifact is scoped to a single gym.

ALTER TABLE public.class_types
  ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES public.gyms (id) ON DELETE CASCADE;

ALTER TABLE public.class_types
  ALTER COLUMN gym_id SET NOT NULL;

ALTER TABLE public.instructors
  ALTER COLUMN gym_id SET NOT NULL;

ALTER TABLE public.class_schedules
  ALTER COLUMN gym_id SET NOT NULL;

ALTER TABLE public.class_instances
  ALTER COLUMN gym_id SET NOT NULL;

-- Composite keys to enforce gym consistency across schedules and instances.
CREATE UNIQUE INDEX IF NOT EXISTS class_types_id_gym_idx
  ON public.class_types (id, gym_id);

CREATE UNIQUE INDEX IF NOT EXISTS class_schedules_id_gym_idx
  ON public.class_schedules (id, gym_id);

ALTER TABLE public.class_schedules
  DROP CONSTRAINT IF EXISTS class_schedules_class_type_gym_fkey;

ALTER TABLE public.class_schedules
  ADD CONSTRAINT class_schedules_class_type_gym_fkey
  FOREIGN KEY (class_type_id, gym_id)
  REFERENCES public.class_types (id, gym_id)
  ON DELETE CASCADE;

ALTER TABLE public.class_instances
  DROP CONSTRAINT IF EXISTS class_instances_schedule_gym_fkey;

ALTER TABLE public.class_instances
  ADD CONSTRAINT class_instances_schedule_gym_fkey
  FOREIGN KEY (schedule_id, gym_id)
  REFERENCES public.class_schedules (id, gym_id)
  ON DELETE CASCADE;

-- Ensure instructor belongs to same gym as schedule.
CREATE OR REPLACE FUNCTION public.enforce_schedule_instructor_gym()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_instructor_gym uuid;
begin
  if new.instructor_id is null then
    return new;
  end if;

  select gym_id
    into v_instructor_gym
  from public.instructors
  where id = new.instructor_id;

  if v_instructor_gym is null then
    raise exception 'instructor_not_found';
  end if;

  if v_instructor_gym <> new.gym_id then
    raise exception 'instructor_gym_mismatch';
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS class_schedules_instructor_gym_check ON public.class_schedules;
CREATE TRIGGER class_schedules_instructor_gym_check
BEFORE INSERT OR UPDATE ON public.class_schedules
FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_instructor_gym();

-- Indexes
CREATE INDEX IF NOT EXISTS class_types_gym_id_idx
  ON public.class_types (gym_id);

CREATE INDEX IF NOT EXISTS instructors_gym_id_idx
  ON public.instructors (gym_id);

CREATE INDEX IF NOT EXISTS class_schedules_gym_id_idx
  ON public.class_schedules (gym_id);

CREATE INDEX IF NOT EXISTS class_instances_gym_id_date_idx
  ON public.class_instances (gym_id, class_date);

-- RLS policy hardening for gym-scoped scheduling.
-- Members can only read rows where they have gym access.
-- Staff can mutate only within assigned gyms.
-- Edge Functions remain the preferred mutation path for sensitive operations.

DROP POLICY IF EXISTS class_types_select_member ON public.class_types;
DROP POLICY IF EXISTS class_types_insert_staff ON public.class_types;
DROP POLICY IF EXISTS class_types_update_staff ON public.class_types;
DROP POLICY IF EXISTS class_types_delete_staff ON public.class_types;

CREATE POLICY class_types_select_gym
ON public.class_types
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY class_types_write_staff
ON public.class_types
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_types_update_staff
ON public.class_types
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_types_delete_staff
ON public.class_types
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

DROP POLICY IF EXISTS instructors_select_member ON public.instructors;
DROP POLICY IF EXISTS instructors_insert_staff ON public.instructors;
DROP POLICY IF EXISTS instructors_update_staff ON public.instructors;
DROP POLICY IF EXISTS instructors_delete_staff ON public.instructors;

CREATE POLICY instructors_select_gym
ON public.instructors
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY instructors_write_staff
ON public.instructors
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY instructors_update_staff
ON public.instructors
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY instructors_delete_staff
ON public.instructors
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

DROP POLICY IF EXISTS class_schedules_select_member ON public.class_schedules;
DROP POLICY IF EXISTS class_schedules_insert_staff ON public.class_schedules;
DROP POLICY IF EXISTS class_schedules_update_staff ON public.class_schedules;
DROP POLICY IF EXISTS class_schedules_delete_staff ON public.class_schedules;

CREATE POLICY class_schedules_select_gym
ON public.class_schedules
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY class_schedules_write_staff
ON public.class_schedules
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_schedules_update_staff
ON public.class_schedules
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_schedules_delete_staff
ON public.class_schedules
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

DROP POLICY IF EXISTS class_instances_select_member ON public.class_instances;
DROP POLICY IF EXISTS class_instances_insert_staff ON public.class_instances;
DROP POLICY IF EXISTS class_instances_update_staff ON public.class_instances;
DROP POLICY IF EXISTS class_instances_delete_staff ON public.class_instances;

CREATE POLICY class_instances_select_gym
ON public.class_instances
FOR SELECT
USING (public.has_gym_access(auth.uid(), gym_id));

CREATE POLICY class_instances_write_staff
ON public.class_instances
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_instances_update_staff
ON public.class_instances
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

CREATE POLICY class_instances_delete_staff
ON public.class_instances
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.get_user_staff_roles(auth.uid()) r WHERE r.gym_id = gym_id)
);

COMMENT ON TABLE public.class_types IS 'Class types are scoped to a single gym.';
COMMENT ON TABLE public.instructors IS 'Instructors are scoped to a single gym.';
COMMENT ON TABLE public.class_schedules IS 'Schedules belong to a single gym and must align with class type + instructor gym.';
COMMENT ON TABLE public.class_instances IS 'Class instances are scoped to a single gym and inherit gym from schedule.';
