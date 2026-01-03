-- Phase 6: Step 2 - Workout builder & logging

-- Non-functional notes (documentation only):
/*
  - Logging must tolerate frequent edits while preserving history.
  - Logs should be append-only (avoid destructive rewrites in app logic).
  - PRs must be recomputed safely if history changes.
  - Avoid premature metrics like calories or heart-rate.
*/

CREATE TABLE IF NOT EXISTS public.workout_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES public.workouts (id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises (id) ON DELETE RESTRICT,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_exercises_workout_idx
  ON public.workout_exercises (workout_id);

CREATE INDEX IF NOT EXISTS workout_exercises_exercise_idx
  ON public.workout_exercises (exercise_id);

CREATE TRIGGER set_workout_exercises_updated_at
BEFORE UPDATE ON public.workout_exercises
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.workout_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id uuid NOT NULL REFERENCES public.workout_exercises (id) ON DELETE CASCADE,
  set_number integer NOT NULL DEFAULT 1,
  reps integer,
  weight numeric,
  weight_unit public.workout_weight_unit,
  rpe numeric,
  notes text,
  logged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_logs_logged_at_idx
  ON public.workout_logs (logged_at);

CREATE TABLE IF NOT EXISTS public.workout_prs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises (id) ON DELETE CASCADE,
  pr_type text NOT NULL CHECK (pr_type IN ('1RM', 'MAX_WEIGHT', 'MAX_REPS')),
  value numeric NOT NULL,
  achieved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_prs_member_idx
  ON public.workout_prs (member_id);

CREATE INDEX IF NOT EXISTS workout_prs_exercise_idx
  ON public.workout_prs (exercise_id);

-- RLS policies
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_prs ENABLE ROW LEVEL SECURITY;

-- Members can view only their workout exercises.
CREATE POLICY workout_exercises_select_owner
ON public.workout_exercises
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workouts w
    WHERE w.id = workout_id
      AND w.member_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.workouts w
    JOIN public.members m ON m.user_id = w.member_id
    JOIN public.staff_roles sr ON sr.gym_id = m.gym_id
    WHERE w.id = workout_id
      AND sr.user_id = auth.uid()
  )
);

-- Members can insert workout exercises for their own workouts.
CREATE POLICY workout_exercises_insert_owner
ON public.workout_exercises
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workouts w
    WHERE w.id = workout_id
      AND w.member_id = auth.uid()
  )
);

-- Members can update workout exercises for their own workouts.
CREATE POLICY workout_exercises_update_owner
ON public.workout_exercises
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.workouts w
    WHERE w.id = workout_id
      AND w.member_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workouts w
    WHERE w.id = workout_id
      AND w.member_id = auth.uid()
  )
);

-- Members can delete workout exercises for their own workouts.
CREATE POLICY workout_exercises_delete_owner
ON public.workout_exercises
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.workouts w
    WHERE w.id = workout_id
      AND w.member_id = auth.uid()
  )
);

-- Members can view only their workout logs; trainers may view assigned members (same gym).
CREATE POLICY workout_logs_select_owner
ON public.workout_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workout_exercises we
    JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_exercise_id
      AND w.member_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.workout_exercises we
    JOIN public.workouts w ON w.id = we.workout_id
    JOIN public.members m ON m.user_id = w.member_id
    JOIN public.staff_roles sr ON sr.gym_id = m.gym_id
    WHERE we.id = workout_exercise_id
      AND sr.user_id = auth.uid()
  )
);

-- Members can insert workout logs for their own workouts.
CREATE POLICY workout_logs_insert_owner
ON public.workout_logs
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workout_exercises we
    JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_exercise_id
      AND w.member_id = auth.uid()
  )
);

-- Members can update workout logs for their own workouts (edits allowed).
CREATE POLICY workout_logs_update_owner
ON public.workout_logs
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.workout_exercises we
    JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_exercise_id
      AND w.member_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workout_exercises we
    JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_exercise_id
      AND w.member_id = auth.uid()
  )
);

-- Members can delete workout logs for their own workouts (discourage destructive deletes in app).
CREATE POLICY workout_logs_delete_owner
ON public.workout_logs
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.workout_exercises we
    JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_exercise_id
      AND w.member_id = auth.uid()
  )
);

-- PR table is read-only for clients; system updates use service role.
CREATE POLICY workout_prs_select_owner
ON public.workout_prs
FOR SELECT
USING (
  member_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.members m
    JOIN public.staff_roles sr ON sr.gym_id = m.gym_id
    WHERE m.user_id = workout_prs.member_id
      AND sr.user_id = auth.uid()
  )
);

-- Manual QA checklist (documentation only):
/*
  - member logs workout → only they can view/edit
  - trainer views member workout history
  - PR triggers only on true improvements
  - offline logging syncs correctly after reconnect
  - partial workout resumes properly
*/
