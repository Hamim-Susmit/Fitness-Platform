-- Phase 6: Step 4 - Goal setting & progress tracking

-- Non-functional notes (documentation only):
/*
  - Goals should not be tightly coupled to one feature.
  - Progress entries are append-only for auditability.
  - Goals must support multi-year timelines.
  - Avoid storing derived values; compute when needed.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_type') THEN
    CREATE TYPE public.goal_type AS ENUM ('WEIGHT', 'STRENGTH', 'ENDURANCE', 'CUSTOM');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_status') THEN
    CREATE TYPE public.goal_status AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_visibility') THEN
    CREATE TYPE public.goal_visibility AS ENUM ('PRIVATE', 'SHARED_WITH_TRAINER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_progress_source') THEN
    CREATE TYPE public.goal_progress_source AS ENUM ('MANUAL', 'WORKOUT', 'PR_EVENT', 'TRAINER_UPDATE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users (id) ON DELETE SET NULL,
  goal_type public.goal_type NOT NULL,
  title text NOT NULL,
  description text,
  metric_key text NOT NULL,
  unit text NOT NULL,
  target_value numeric NOT NULL,
  start_value numeric,
  current_value numeric,
  target_date date,
  status public.goal_status NOT NULL DEFAULT 'ACTIVE',
  visibility public.goal_visibility NOT NULL DEFAULT 'PRIVATE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goals_member_idx
  ON public.goals (member_id);

CREATE INDEX IF NOT EXISTS goals_metric_key_idx
  ON public.goals (metric_key);

CREATE TRIGGER set_goals_updated_at
BEFORE UPDATE ON public.goals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.goal_progress_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals (id) ON DELETE CASCADE,
  value numeric NOT NULL,
  note text,
  source public.goal_progress_source NOT NULL DEFAULT 'MANUAL',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goal_progress_entries_goal_idx
  ON public.goal_progress_entries (goal_id);

CREATE INDEX IF NOT EXISTS goal_progress_entries_recorded_idx
  ON public.goal_progress_entries (recorded_at);

-- RLS policies
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_progress_entries ENABLE ROW LEVEL SECURITY;

-- Members can manage their own goals.
CREATE POLICY goals_select_owner
ON public.goals
FOR SELECT
USING (member_id = auth.uid());

CREATE POLICY goals_insert_owner
ON public.goals
FOR INSERT
WITH CHECK (member_id = auth.uid());

CREATE POLICY goals_update_owner
ON public.goals
FOR UPDATE
USING (member_id = auth.uid())
WITH CHECK (member_id = auth.uid());

CREATE POLICY goals_delete_owner
ON public.goals
FOR DELETE
USING (member_id = auth.uid());

-- Trainers may view/edit goals for assigned clients, except PRIVATE goals.
CREATE POLICY goals_select_trainer
ON public.goals
FOR SELECT
USING (
  visibility = 'SHARED_WITH_TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = goals.member_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY goals_insert_trainer
ON public.goals
FOR INSERT
WITH CHECK (
  visibility = 'SHARED_WITH_TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = member_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY goals_update_trainer
ON public.goals
FOR UPDATE
USING (
  visibility = 'SHARED_WITH_TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = goals.member_id
      AND pt.user_id = auth.uid()
  )
)
WITH CHECK (
  visibility = 'SHARED_WITH_TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = goals.member_id
      AND pt.user_id = auth.uid()
  )
);

-- Admin (owner role) may read for support, not modify.
CREATE POLICY goals_select_admin
ON public.goals
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Progress entries are append-only; members and trainers can insert when allowed.
CREATE POLICY goal_progress_select_owner
ON public.goal_progress_entries
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.goals g
    WHERE g.id = goal_id
      AND g.member_id = auth.uid()
  )
);

CREATE POLICY goal_progress_select_trainer
ON public.goal_progress_entries
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.goals g
    JOIN public.trainer_clients tc ON tc.member_id = g.member_id
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE g.id = goal_id
      AND g.visibility = 'SHARED_WITH_TRAINER'
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY goal_progress_insert_owner
ON public.goal_progress_entries
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.goals g
    WHERE g.id = goal_id
      AND g.member_id = auth.uid()
      AND g.status = 'ACTIVE'
  )
);

CREATE POLICY goal_progress_insert_trainer
ON public.goal_progress_entries
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.goals g
    JOIN public.trainer_clients tc ON tc.member_id = g.member_id
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE g.id = goal_id
      AND g.status = 'ACTIVE'
      AND g.visibility = 'SHARED_WITH_TRAINER'
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY goal_progress_select_admin
ON public.goal_progress_entries
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Manual QA checklist (documentation only):
/*
  - member creates goal → trainer cannot see if PRIVATE
  - trainer adds progress → only for assigned client
  - PR event updates matching strength goal correctly
  - manual entry overrides automated assumption
  - marking goal COMPLETE freezes progress editing
*/
