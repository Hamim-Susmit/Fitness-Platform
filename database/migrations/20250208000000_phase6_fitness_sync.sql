-- Phase 6 — Step 9: Fitness Tracker Integrations (Health Sync Pipeline)
-- Privacy + safety: daily aggregates only, tokens never exposed to clients, and trainers can view only assigned clients.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fitness_provider') THEN
    CREATE TYPE public.fitness_provider AS ENUM (
      'APPLE_HEALTH',
      'GOOGLE_FIT',
      'FITBIT',
      'GARMIN',
      'STRAVA'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fitness_account_status') THEN
    CREATE TYPE public.fitness_account_status AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fitness_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  provider public.fitness_provider NOT NULL,
  external_user_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  status public.fitness_account_status NOT NULL DEFAULT 'DISCONNECTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fitness_accounts IS
  'External fitness provider connections. Tokens are stored encrypted; never expose tokens to clients.';
COMMENT ON COLUMN public.fitness_accounts.access_token IS
  'Encrypted access token. MUST NOT be returned to client apps.';
COMMENT ON COLUMN public.fitness_accounts.refresh_token IS
  'Encrypted refresh token (nullable). MUST NOT be returned to client apps.';

CREATE UNIQUE INDEX IF NOT EXISTS fitness_accounts_member_provider_unique
  ON public.fitness_accounts (member_id, provider);

CREATE INDEX IF NOT EXISTS fitness_accounts_member_idx
  ON public.fitness_accounts (member_id);

CREATE TRIGGER set_fitness_accounts_updated_at
BEFORE UPDATE ON public.fitness_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.fitness_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  provider public.fitness_provider NOT NULL,
  metric_date date NOT NULL,
  steps integer,
  distance_km numeric,
  active_minutes integer,
  calories_active numeric,
  avg_heart_rate numeric,
  max_heart_rate numeric,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.fitness_daily_metrics.source_payload IS
  'Raw provider response snapshot for audit; never return directly to clients.';

CREATE UNIQUE INDEX IF NOT EXISTS fitness_daily_metrics_unique
  ON public.fitness_daily_metrics (member_id, provider, metric_date);

CREATE INDEX IF NOT EXISTS fitness_daily_metrics_member_date_idx
  ON public.fitness_daily_metrics (member_id, metric_date);

CREATE TRIGGER set_fitness_daily_metrics_updated_at
BEFORE UPDATE ON public.fitness_daily_metrics
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fitness_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitness_daily_metrics ENABLE ROW LEVEL SECURITY;

-- Members can read/manage their own accounts; trainers never see tokens.
CREATE POLICY fitness_accounts_select_member
ON public.fitness_accounts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_accounts.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY fitness_accounts_insert_member
ON public.fitness_accounts
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_accounts.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY fitness_accounts_update_member
ON public.fitness_accounts
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_accounts.member_id
      AND m.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_accounts.member_id
      AND m.user_id = auth.uid()
  )
);

-- Metrics: members can read their own; trainers can read assigned clients (same trainer-client mapping).
CREATE POLICY fitness_daily_metrics_select_member_or_trainer
ON public.fitness_daily_metrics
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_daily_metrics.member_id
      AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.trainer_clients tc
    JOIN public.personal_trainers pt ON pt.id = tc.trainer_id
    WHERE tc.member_id = fitness_daily_metrics.member_id
      AND pt.user_id = auth.uid()
  )
);

CREATE POLICY fitness_daily_metrics_insert_member
ON public.fitness_daily_metrics
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_daily_metrics.member_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY fitness_daily_metrics_update_member
ON public.fitness_daily_metrics
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_daily_metrics.member_id
      AND m.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = fitness_daily_metrics.member_id
      AND m.user_id = auth.uid()
  )
);

-- Tokens + raw payload are never returned to client apps.
REVOKE SELECT (access_token, refresh_token) ON public.fitness_accounts FROM anon, authenticated;
REVOKE SELECT (source_payload) ON public.fitness_daily_metrics FROM anon, authenticated;

COMMENT ON TABLE public.fitness_daily_metrics IS
  'Daily aggregates only; do not store high-frequency biometric data. Members control visibility.';

-- Non-functional notes:
-- 1) Integrations are optional; core membership flows must not break without a provider.
-- 2) Partial data is expected per provider; missing fields are acceptable.
-- 3) Syncing is resilient + idempotent; never delete historical records.
-- 4) Members control connection + visibility (RLS enforced).

-- QA checklist:
-- - Member connects + disconnects successfully.
-- - Daily data imports without duplicates.
-- - Missing values handled safely.
-- - Trainer can view assigned client metrics only.
-- - Sync does not overwrite older valid records.
