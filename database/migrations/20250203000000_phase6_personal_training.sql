-- Phase 6: Step 3 - Personal training & coaching

-- Non-functional notes (documentation only):
/*
  - Trainer data must not leak across trainers.
  - Coaching tools should reuse workout + progress data (no duplication).
  - Scale to 10k+ trainer-client relationships.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trainer_session_status') THEN
    CREATE TYPE public.trainer_session_status AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trainer_note_visibility') THEN
    CREATE TYPE public.trainer_note_visibility AS ENUM ('TRAINER_ONLY', 'SHARED_WITH_MEMBER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.personal_trainers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  bio text NOT NULL DEFAULT '',
  certifications text[] NOT NULL DEFAULT ARRAY[]::text[],
  specialties text[] NOT NULL DEFAULT ARRAY[]::text[],
  hourly_rate numeric NOT NULL DEFAULT 0,
  profile_photo_url text,
  rating_avg numeric NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS personal_trainers_user_unique
  ON public.personal_trainers (user_id);

CREATE TRIGGER set_personal_trainers_updated_at
BEFORE UPDATE ON public.personal_trainers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.trainer_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES public.personal_trainers (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trainer_clients_unique
  ON public.trainer_clients (trainer_id, member_id);

CREATE TABLE IF NOT EXISTS public.trainer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES public.personal_trainers (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  session_start timestamptz NOT NULL,
  session_end timestamptz NOT NULL,
  status public.trainer_session_status NOT NULL DEFAULT 'SCHEDULED',
  location text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_sessions_trainer_idx
  ON public.trainer_sessions (trainer_id);

CREATE INDEX IF NOT EXISTS trainer_sessions_member_idx
  ON public.trainer_sessions (member_id);

CREATE TABLE IF NOT EXISTS public.trainer_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES public.personal_trainers (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  package_name text NOT NULL,
  total_sessions integer NOT NULL DEFAULT 1,
  sessions_used integer NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_packages_trainer_idx
  ON public.trainer_packages (trainer_id);

CREATE INDEX IF NOT EXISTS trainer_packages_member_idx
  ON public.trainer_packages (member_id);

CREATE TABLE IF NOT EXISTS public.trainer_progress_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES public.personal_trainers (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  workout_id uuid REFERENCES public.workouts (id) ON DELETE SET NULL,
  note text NOT NULL,
  visibility public.trainer_note_visibility NOT NULL DEFAULT 'TRAINER_ONLY',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_progress_notes_trainer_idx
  ON public.trainer_progress_notes (trainer_id);

CREATE INDEX IF NOT EXISTS trainer_progress_notes_member_idx
  ON public.trainer_progress_notes (member_id);

-- RLS policies
ALTER TABLE public.personal_trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_progress_notes ENABLE ROW LEVEL SECURITY;

-- Admin override (support) for owner role.
CREATE POLICY personal_trainers_select_authenticated
ON public.personal_trainers
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY personal_trainers_upsert_owner
ON public.personal_trainers
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY personal_trainers_update_owner
ON public.personal_trainers
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Trainer-client relationships are visible to trainers, members, and owners.
CREATE POLICY trainer_clients_select
ON public.trainer_clients
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR member_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY trainer_clients_insert_trainer
ON public.trainer_clients
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Trainers may manage their sessions; members can view their own.
CREATE POLICY trainer_sessions_select
ON public.trainer_sessions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR member_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY trainer_sessions_modify_trainer
ON public.trainer_sessions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY trainer_sessions_update_trainer
ON public.trainer_sessions
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Packages are visible to trainers and members.
CREATE POLICY trainer_packages_select
ON public.trainer_packages
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR member_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY trainer_packages_modify_trainer
ON public.trainer_packages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY trainer_packages_update_trainer
ON public.trainer_packages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Trainer progress notes: trainers see all their notes; members see only shared notes.
CREATE POLICY trainer_progress_notes_select
ON public.trainer_progress_notes
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR (
    member_id = auth.uid()
    AND visibility = 'SHARED_WITH_MEMBER'
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY trainer_progress_notes_insert_trainer
ON public.trainer_progress_notes
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY trainer_progress_notes_update_trainer
ON public.trainer_progress_notes
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.personal_trainers pt
    WHERE pt.id = trainer_id
      AND pt.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Manual QA checklist (documentation only):
/*
  - trainer sees only their clients
  - member can see only their own sessions
  - shared vs private notes behave correctly
  - package sessions decrement properly
  - scheduling updates reflect across web + mobile
*/
