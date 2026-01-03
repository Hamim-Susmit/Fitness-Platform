-- Phase 6 — Step 10: Nutrition & Meal Tracking (Foundations)
-- Safety + privacy: nutrition data is sensitive; totals are derived and recomputable at any time.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nutrition_plan_status') THEN
    CREATE TYPE public.nutrition_plan_status AS ENUM ('ACTIVE', 'ARCHIVED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nutrition_plan_visibility') THEN
    CREATE TYPE public.nutrition_plan_visibility AS ENUM ('PRIVATE', 'SHARED_WITH_TRAINER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meal_type') THEN
    CREATE TYPE public.meal_type AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meal_item_source') THEN
    CREATE TYPE public.meal_item_source AS ENUM ('MANUAL', 'PLAN', 'IMPORT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.nutrition_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  daily_calorie_target numeric,
  protein_target_g numeric,
  carbs_target_g numeric,
  fat_target_g numeric,
  start_date date,
  end_date date,
  status public.nutrition_plan_status NOT NULL DEFAULT 'ACTIVE',
  visibility public.nutrition_plan_visibility NOT NULL DEFAULT 'PRIVATE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nutrition_plans IS
  'Nutrition guidance plans. Private plans are visible only to members; shared plans are visible to assigned trainers.';
COMMENT ON COLUMN public.nutrition_plans.visibility IS
  'PRIVATE plans remain member-only; SHARED_WITH_TRAINER plans allow assigned trainers to view.';

CREATE TRIGGER set_nutrition_plans_updated_at
BEFORE UPDATE ON public.nutrition_plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS nutrition_plans_member_idx
  ON public.nutrition_plans (member_id, status);

CREATE TABLE IF NOT EXISTS public.meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  meal_type public.meal_type NOT NULL,
  meal_date date NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meals IS 'Meal entries per day; items stored in meal_items.';

CREATE INDEX IF NOT EXISTS meals_member_date_idx
  ON public.meals (member_id, meal_date);

CREATE TABLE IF NOT EXISTS public.meal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id uuid NOT NULL REFERENCES public.meals (id) ON DELETE CASCADE,
  name text NOT NULL,
  calories numeric NOT NULL,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  serving_size_label text,
  source public.meal_item_source NOT NULL DEFAULT 'MANUAL',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meal_items IS
  'Foods within a meal. Source indicates manual entry vs plan vs import.';

CREATE INDEX IF NOT EXISTS meal_items_meal_idx
  ON public.meal_items (meal_id);

CREATE TABLE IF NOT EXISTS public.nutrition_daily_totals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  total_date date NOT NULL,
  calories numeric NOT NULL DEFAULT 0,
  protein_g numeric NOT NULL DEFAULT 0,
  carbs_g numeric NOT NULL DEFAULT 0,
  fat_g numeric NOT NULL DEFAULT 0,
  source_recalculated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nutrition_daily_totals IS
  'Cached rollups for dashboards; derived from meal_items and safe to recompute anytime.';

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_daily_totals_unique
  ON public.nutrition_daily_totals (member_id, total_date);

CREATE INDEX IF NOT EXISTS nutrition_daily_totals_member_idx
  ON public.nutrition_daily_totals (member_id, total_date);

CREATE TRIGGER set_nutrition_daily_totals_updated_at
BEFORE UPDATE ON public.nutrition_daily_totals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Rollup helper: recompute totals for a member + date. Idempotent.
CREATE OR REPLACE FUNCTION public.recompute_nutrition_daily_totals(
  p_member_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_totals record;
BEGIN
  SELECT
    COALESCE(SUM(mi.calories), 0) AS calories,
    COALESCE(SUM(mi.protein_g), 0) AS protein_g,
    COALESCE(SUM(mi.carbs_g), 0) AS carbs_g,
    COALESCE(SUM(mi.fat_g), 0) AS fat_g
  INTO v_totals
  FROM public.meals m
  JOIN public.meal_items mi ON mi.meal_id = m.id
  WHERE m.member_id = p_member_id
    AND m.meal_date = p_date;

  INSERT INTO public.nutrition_daily_totals (
    member_id,
    total_date,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    source_recalculated_at
  )
  VALUES (
    p_member_id,
    p_date,
    v_totals.calories,
    v_totals.protein_g,
    v_totals.carbs_g,
    v_totals.fat_g,
    now()
  )
  ON CONFLICT (member_id, total_date)
  DO UPDATE SET
    calories = EXCLUDED.calories,
    protein_g = EXCLUDED.protein_g,
    carbs_g = EXCLUDED.carbs_g,
    fat_g = EXCLUDED.fat_g,
    source_recalculated_at = EXCLUDED.source_recalculated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_nutrition_totals_for_meal(
  p_meal_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meal record;
BEGIN
  SELECT member_id, meal_date INTO v_meal
  FROM public.meals
  WHERE id = p_meal_id;

  IF v_meal.member_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.recompute_nutrition_daily_totals(v_meal.member_id, v_meal.meal_date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_nutrition_daily_totals(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_nutrition_totals_for_meal(uuid) TO authenticated;

ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_daily_totals ENABLE ROW LEVEL SECURITY;

-- Nutrition plans: members control visibility; trainers only see shared plans for assigned clients.
CREATE POLICY nutrition_plans_select_member
ON public.nutrition_plans
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = nutrition_plans.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY nutrition_plans_select_trainer_shared
ON public.nutrition_plans
FOR SELECT
USING (
  nutrition_plans.visibility = 'SHARED_WITH_TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = nutrition_plans.member_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY nutrition_plans_insert_member
ON public.nutrition_plans
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = nutrition_plans.member_id
      AND m.user_id = auth.uid()
  )
  AND nutrition_plans.created_by = auth.uid()
);

CREATE POLICY nutrition_plans_insert_trainer
ON public.nutrition_plans
FOR INSERT
WITH CHECK (
  nutrition_plans.visibility = 'SHARED_WITH_TRAINER'
  AND nutrition_plans.created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = nutrition_plans.member_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY nutrition_plans_update_member
ON public.nutrition_plans
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = nutrition_plans.member_id
      AND m.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = nutrition_plans.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY nutrition_plans_update_trainer
ON public.nutrition_plans
FOR UPDATE
USING (
  nutrition_plans.visibility = 'SHARED_WITH_TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = nutrition_plans.member_id
      AND pt.user_id = auth.uid()
  )
)
WITH CHECK (
  nutrition_plans.visibility = 'SHARED_WITH_TRAINER'
  AND EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = nutrition_plans.member_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY nutrition_plans_delete_member
ON public.nutrition_plans
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = nutrition_plans.member_id
      AND m.user_id = auth.uid()
  )
);

-- Meals: members can manage their own; trainers can view assigned clients only.
CREATE POLICY meals_select_member
ON public.meals
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = meals.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY meals_select_trainer
ON public.meals
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = meals.member_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY meals_insert_member
ON public.meals
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = meals.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY meals_update_member
ON public.meals
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = meals.member_id
      AND m.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = meals.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY meals_delete_member
ON public.meals
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = meals.member_id
      AND m.user_id = auth.uid()
  )
);

-- Meal items: members manage their own; trainers read only.
CREATE POLICY meal_items_select_member
ON public.meal_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.meals m
    JOIN public.members mem ON mem.id = m.member_id
    WHERE m.id = meal_items.meal_id
      AND mem.user_id = auth.uid()
  )
);

CREATE POLICY meal_items_select_trainer
ON public.meal_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.meals m
    JOIN public.trainer_clients tc ON tc.member_id = m.member_id
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE m.id = meal_items.meal_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY meal_items_insert_member
ON public.meal_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.meals m
    JOIN public.members mem ON mem.id = m.member_id
    WHERE m.id = meal_items.meal_id
      AND mem.user_id = auth.uid()
  )
);

CREATE POLICY meal_items_update_member
ON public.meal_items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.meals m
    JOIN public.members mem ON mem.id = m.member_id
    WHERE m.id = meal_items.meal_id
      AND mem.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.meals m
    JOIN public.members mem ON mem.id = m.member_id
    WHERE m.id = meal_items.meal_id
      AND mem.user_id = auth.uid()
  )
);

CREATE POLICY meal_items_delete_member
ON public.meal_items
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.meals m
    JOIN public.members mem ON mem.id = m.member_id
    WHERE m.id = meal_items.meal_id
      AND mem.user_id = auth.uid()
  )
);

-- Daily totals: read-only for members/trainers. Writes happen via security definer functions.
CREATE POLICY nutrition_daily_totals_select_member
ON public.nutrition_daily_totals
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = nutrition_daily_totals.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY nutrition_daily_totals_select_trainer
ON public.nutrition_daily_totals
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = nutrition_daily_totals.member_id
      AND pt.user_id = auth.uid()
  )
);

-- Non-functional notes:
-- 1) Nutrition features should not encourage unhealthy restriction; emphasize sustainable progress.
-- 2) Totals are derived from meal_items and are safe to recompute at any time.
-- 3) Avoid unverified nutrition database entries; manual entry only in this phase.
-- 4) Future integrations will sync into meal_items (read-only).

-- QA checklist:
-- - Member logs meals → totals recompute.
-- - Trainer can view only assigned client logs.
-- - Private plans hidden from trainer.
-- - Deleting meal updates totals correctly.
-- - Nutrition UI matches web + mobile behavior.
