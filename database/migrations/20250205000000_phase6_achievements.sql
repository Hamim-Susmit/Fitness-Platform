-- Phase 6: Step 5 - Achievements, badges & gamification

-- Non-functional notes (documentation only):
/*
  - Achievements must NOT encourage unsafe workout behavior.
  - Reward consistency over volume.
  - System must tolerate retroactive recalculation later.
  - context_json allows flexible metadata without schema churn.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'achievement_category') THEN
    CREATE TYPE public.achievement_category AS ENUM ('STREAK', 'WORKOUT', 'GOAL', 'ATTENDANCE', 'CHALLENGE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'achievement_source') THEN
    CREATE TYPE public.achievement_source AS ENUM ('SYSTEM', 'TRAINER', 'ADMIN');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'streak_type') THEN
    CREATE TYPE public.streak_type AS ENUM ('CHECKINS', 'WORKOUTS');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  category public.achievement_category NOT NULL,
  icon_key text NOT NULL,
  points_awarded integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_achievements_updated_at
BEFORE UPDATE ON public.achievements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.member_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES public.achievements (id) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  source public.achievement_source NOT NULL DEFAULT 'SYSTEM',
  context_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_achievements_unique
  ON public.member_achievements (member_id, achievement_id);

CREATE INDEX IF NOT EXISTS member_achievements_member_idx
  ON public.member_achievements (member_id);

CREATE TABLE IF NOT EXISTS public.streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  streak_type public.streak_type NOT NULL,
  current_count integer NOT NULL DEFAULT 0,
  longest_count integer NOT NULL DEFAULT 0,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS streaks_member_type_unique
  ON public.streaks (member_id, streak_type);

CREATE INDEX IF NOT EXISTS streaks_member_idx
  ON public.streaks (member_id);

CREATE INDEX IF NOT EXISTS streaks_type_idx
  ON public.streaks (streak_type);

CREATE TRIGGER set_streaks_updated_at
BEFORE UPDATE ON public.streaks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default achievements.
INSERT INTO public.achievements (code, title, description, category, icon_key, points_awarded)
VALUES
  ('WORKOUT_1', 'First Workout', 'Logged your first workout.', 'WORKOUT', 'workout-1', 10),
  ('WORKOUT_10', '10 Workouts', 'Completed ten workouts.', 'WORKOUT', 'workout-10', 25),
  ('WORKOUT_50', '50 Workouts', 'Completed fifty workouts.', 'WORKOUT', 'workout-50', 50),
  ('STREAK_7', '7-Day Streak', 'Stayed active for 7 days in a row.', 'STREAK', 'streak-7', 20),
  ('STREAK_30', '30-Day Streak', 'Stayed active for 30 days in a row.', 'STREAK', 'streak-30', 60),
  ('CHECKIN_10', '10 Gym Visits', 'Checked in 10 times.', 'ATTENDANCE', 'checkin-10', 15),
  ('CHECKIN_100', '100 Gym Visits', 'Checked in 100 times.', 'ATTENDANCE', 'checkin-100', 75),
  ('GOAL_COMPLETE', 'First Goal Achieved', 'Completed a goal.', 'GOAL', 'goal-complete', 30)
ON CONFLICT (code) DO NOTHING;

-- RLS policies
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;

-- Achievements catalog is readable by authenticated users.
CREATE POLICY achievements_select_authenticated
ON public.achievements
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Members can view their own achievements.
CREATE POLICY member_achievements_select_owner
ON public.member_achievements
FOR SELECT
USING (member_id = auth.uid());

-- Trainers can view achievements for assigned clients only.
CREATE POLICY member_achievements_select_trainer
ON public.member_achievements
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = member_achievements.member_id
      AND pt.user_id = auth.uid()
  )
);

-- Trainers may award achievements to assigned clients (source must be TRAINER).
CREATE POLICY member_achievements_insert_trainer
ON public.member_achievements
FOR INSERT
WITH CHECK (
  source = 'TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = member_id
      AND pt.user_id = auth.uid()
  )
);

-- Admin may award achievements for support (source must be ADMIN).
CREATE POLICY member_achievements_insert_admin
ON public.member_achievements
FOR INSERT
WITH CHECK (
  source = 'ADMIN'
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Members can view their own streaks.
CREATE POLICY streaks_select_owner
ON public.streaks
FOR SELECT
USING (member_id = auth.uid());

-- Trainers can view streaks for assigned clients only.
CREATE POLICY streaks_select_trainer
ON public.streaks
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = streaks.member_id
      AND pt.user_id = auth.uid()
  )
);

-- Admin read-only access to achievements and streaks for support.
CREATE POLICY streaks_select_admin
ON public.streaks
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY member_achievements_select_admin
ON public.member_achievements
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Manual QA checklist (documentation only):
/*
  - member earns workout achievements gradually
  - streak resets correctly when gap occurs
  - duplicate achievement does NOT re-award
  - trainer cannot see other-trainer clients
  - achievements sync across web + mobile
*/
