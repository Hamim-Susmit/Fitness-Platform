-- Phase 6: Step 1 - Core workout data foundations

-- Non-functional requirements (documentation only):
/*
  - Workout data must be forward-compatible with logging + goals.
  - Avoid premature fields (calories, heart-rate, recovery metrics).
  - Templates must support reuse + cloning in later steps.
  - Performance should scale to 10k+ exercises.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exercise_category') THEN
    CREATE TYPE public.exercise_category AS ENUM ('strength', 'cardio', 'mobility', 'stretch');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exercise_difficulty') THEN
    CREATE TYPE public.exercise_difficulty AS ENUM ('beginner', 'intermediate', 'advanced');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'muscle_group_category') THEN
    CREATE TYPE public.muscle_group_category AS ENUM ('upper', 'lower', 'core', 'full');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workout_template_owner_type') THEN
    CREATE TYPE public.workout_template_owner_type AS ENUM ('SYSTEM', 'TRAINER', 'MEMBER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workout_goal_type') THEN
    CREATE TYPE public.workout_goal_type AS ENUM ('strength', 'hypertrophy', 'endurance', 'mobility');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workout_weight_unit') THEN
    CREATE TYPE public.workout_weight_unit AS ENUM ('kg', 'lb');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workout_source_type') THEN
    CREATE TYPE public.workout_source_type AS ENUM ('TEMPLATE', 'CUSTOM', 'IMPORT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category public.exercise_category NOT NULL,
  primary_muscle_group text NOT NULL,
  secondary_muscle_groups text[] NOT NULL DEFAULT ARRAY[]::text[],
  equipment text[] NOT NULL DEFAULT ARRAY[]::text[],
  difficulty public.exercise_difficulty NOT NULL,
  is_bodyweight boolean NOT NULL DEFAULT false,
  video_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS exercises_name_unique
  ON public.exercises (name);

CREATE INDEX IF NOT EXISTS exercises_category_idx
  ON public.exercises (category);

CREATE TRIGGER set_exercises_updated_at
BEFORE UPDATE ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.muscle_groups (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  category public.muscle_group_category NOT NULL
);

CREATE TABLE IF NOT EXISTS public.workout_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type public.workout_template_owner_type NOT NULL,
  owner_id uuid REFERENCES public.users (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  target_goal public.workout_goal_type NOT NULL,
  difficulty public.exercise_difficulty NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_templates_owner_idx
  ON public.workout_templates (owner_type, owner_id);

CREATE TRIGGER set_workout_templates_updated_at
BEFORE UPDATE ON public.workout_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.workout_template_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.workout_templates (id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises (id) ON DELETE RESTRICT,
  order_index integer NOT NULL DEFAULT 0,
  default_sets integer NOT NULL DEFAULT 1,
  default_reps integer,
  default_weight_unit public.workout_weight_unit,
  default_rest_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_template_exercises_template_idx
  ON public.workout_template_exercises (template_id);

CREATE TRIGGER set_workout_template_exercises_updated_at
BEFORE UPDATE ON public.workout_template_exercises
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.workout_templates (id) ON DELETE SET NULL,
  title text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  source public.workout_source_type NOT NULL DEFAULT 'CUSTOM'
);

CREATE INDEX IF NOT EXISTS workouts_member_idx
  ON public.workouts (member_id);

-- Seed muscle groups.
INSERT INTO public.muscle_groups (name, category)
VALUES
  ('Chest', 'upper'),
  ('Back', 'upper'),
  ('Shoulders', 'upper'),
  ('Biceps', 'upper'),
  ('Triceps', 'upper'),
  ('Quads', 'lower'),
  ('Hamstrings', 'lower'),
  ('Glutes', 'lower'),
  ('Calves', 'lower'),
  ('Core', 'core'),
  ('Full Body', 'full')
ON CONFLICT (name) DO NOTHING;

-- Seed starter exercises.
INSERT INTO public.exercises (
  name,
  category,
  primary_muscle_group,
  secondary_muscle_groups,
  equipment,
  difficulty,
  is_bodyweight
)
VALUES
  ('Bench Press', 'strength', 'Chest', ARRAY['Triceps', 'Shoulders'], ARRAY['Barbell', 'Bench'], 'intermediate', false),
  ('Squat', 'strength', 'Quads', ARRAY['Glutes', 'Hamstrings'], ARRAY['Barbell'], 'intermediate', false),
  ('Deadlift', 'strength', 'Back', ARRAY['Glutes', 'Hamstrings'], ARRAY['Barbell'], 'advanced', false),
  ('Push-up', 'strength', 'Chest', ARRAY['Triceps', 'Shoulders'], ARRAY[]::text[], 'beginner', true),
  ('Pull-up', 'strength', 'Back', ARRAY['Biceps'], ARRAY['Pull-up Bar'], 'advanced', true),
  ('Shoulder Press', 'strength', 'Shoulders', ARRAY['Triceps'], ARRAY['Dumbbell'], 'intermediate', false),
  ('Plank', 'mobility', 'Core', ARRAY[]::text[], ARRAY[]::text[], 'beginner', true),
  ('Lunges', 'strength', 'Quads', ARRAY['Glutes', 'Hamstrings'], ARRAY['Dumbbell'], 'beginner', false),
  ('Row (Dumbbell)', 'strength', 'Back', ARRAY['Biceps'], ARRAY['Dumbbell'], 'intermediate', false),
  ('Jump Rope', 'cardio', 'Full Body', ARRAY['Calves'], ARRAY['Jump Rope'], 'beginner', true)
ON CONFLICT (name) DO NOTHING;

-- RLS policies
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.muscle_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_template_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;

-- Exercises are globally readable for authenticated users (read-only).
CREATE POLICY exercises_select_authenticated
ON public.exercises
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Muscle groups are globally readable for authenticated users.
CREATE POLICY muscle_groups_select_authenticated
ON public.muscle_groups
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Templates are globally readable for authenticated users; system templates remain read-only.
CREATE POLICY workout_templates_select_authenticated
ON public.workout_templates
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Members can create their own templates.
CREATE POLICY workout_templates_insert_member
ON public.workout_templates
FOR INSERT
WITH CHECK (
  owner_type = 'MEMBER'
  AND owner_id = auth.uid()
);

-- Trainers (staff roles) can create templates (assignment checks added in later steps).
CREATE POLICY workout_templates_insert_trainer
ON public.workout_templates
FOR INSERT
WITH CHECK (
  owner_type = 'TRAINER'
  AND owner_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = auth.uid()
  )
);

-- Template owners can update their templates; system templates are read-only.
CREATE POLICY workout_templates_update_owner
ON public.workout_templates
FOR UPDATE
USING (
  owner_type <> 'SYSTEM'
  AND owner_id = auth.uid()
)
WITH CHECK (
  owner_type <> 'SYSTEM'
  AND owner_id = auth.uid()
);

-- Template owners can delete their templates; system templates are read-only.
CREATE POLICY workout_templates_delete_owner
ON public.workout_templates
FOR DELETE
USING (
  owner_type <> 'SYSTEM'
  AND owner_id = auth.uid()
);

-- Template exercises follow template ownership rules.
CREATE POLICY workout_template_exercises_select_authenticated
ON public.workout_template_exercises
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY workout_template_exercises_insert_owner
ON public.workout_template_exercises
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workout_templates wt
    WHERE wt.id = template_id
      AND wt.owner_id = auth.uid()
      AND wt.owner_type <> 'SYSTEM'
  )
);

CREATE POLICY workout_template_exercises_update_owner
ON public.workout_template_exercises
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.workout_templates wt
    WHERE wt.id = template_id
      AND wt.owner_id = auth.uid()
      AND wt.owner_type <> 'SYSTEM'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workout_templates wt
    WHERE wt.id = template_id
      AND wt.owner_id = auth.uid()
      AND wt.owner_type <> 'SYSTEM'
  )
);

CREATE POLICY workout_template_exercises_delete_owner
ON public.workout_template_exercises
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.workout_templates wt
    WHERE wt.id = template_id
      AND wt.owner_id = auth.uid()
      AND wt.owner_type <> 'SYSTEM'
  )
);

-- Workouts are member-owned instances.
CREATE POLICY workouts_select_owner
ON public.workouts
FOR SELECT
USING (member_id = auth.uid());

CREATE POLICY workouts_insert_owner
ON public.workouts
FOR INSERT
WITH CHECK (member_id = auth.uid());

CREATE POLICY workouts_update_owner
ON public.workouts
FOR UPDATE
USING (member_id = auth.uid())
WITH CHECK (member_id = auth.uid());

CREATE POLICY workouts_delete_owner
ON public.workouts
FOR DELETE
USING (member_id = auth.uid());

-- Manual QA checklist (documentation only):
/*
  - member can create template → only they can edit it
  - trainer can create template → assigned members can use it
  - member cannot edit system template
  - exercises load consistently on web + mobile
  - schema does not duplicate data
*/
