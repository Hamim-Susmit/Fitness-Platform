-- Phase 5: Step 6 - Custom reports & scheduled reporting

-- Permissions & privacy notes (documentation only):
/*
  - Reports must enforce RLS: users may only see data they are allowed to access.
  - Corporate users may generate cross-location reports if their role allows it.
  - Emails should avoid sensitive PII unless strictly necessary.
  - Consider watermarking PDF exports in a later phase.
*/

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  entity_type text NOT NULL CHECK (entity_type IN ('members', 'attendance', 'revenue', 'classes')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  visualization jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_owner_user_id_idx
  ON public.reports (owner_user_id);

CREATE INDEX IF NOT EXISTS reports_entity_type_idx
  ON public.reports (entity_type);

CREATE TRIGGER set_reports_updated_at
BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports (id) ON DELETE CASCADE,
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  timezone text NOT NULL DEFAULT 'UTC',
  last_run_at timestamptz,
  next_run_at timestamptz,
  delivery_emails text[] NOT NULL DEFAULT ARRAY[]::text[],
  format text NOT NULL CHECK (format IN ('csv', 'pdf', 'xlsx')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_schedules_report_id_idx
  ON public.report_schedules (report_id);

CREATE INDEX IF NOT EXISTS report_schedules_next_run_idx
  ON public.report_schedules (next_run_at);

CREATE TRIGGER set_report_schedules_updated_at
BEFORE UPDATE ON public.report_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_select_owner
ON public.reports
FOR SELECT
USING (owner_user_id = auth.uid());

CREATE POLICY reports_insert_owner
ON public.reports
FOR INSERT
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY reports_update_owner
ON public.reports
FOR UPDATE
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY reports_delete_owner
ON public.reports
FOR DELETE
USING (owner_user_id = auth.uid());

CREATE POLICY report_schedules_select_owner
ON public.report_schedules
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.reports r
    WHERE r.id = report_id
      AND r.owner_user_id = auth.uid()
  )
);

CREATE POLICY report_schedules_insert_owner
ON public.report_schedules
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.reports r
    WHERE r.id = report_id
      AND r.owner_user_id = auth.uid()
  )
);

CREATE POLICY report_schedules_update_owner
ON public.report_schedules
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.reports r
    WHERE r.id = report_id
      AND r.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.reports r
    WHERE r.id = report_id
      AND r.owner_user_id = auth.uid()
  )
);

CREATE POLICY report_schedules_delete_owner
ON public.report_schedules
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.reports r
    WHERE r.id = report_id
      AND r.owner_user_id = auth.uid()
  )
);

-- Manual QA checklist (documentation only):
/*
  - create report → save → run → download
  - create schedule → verify email send (stub ok)
  - verify staff cannot access other user's reports
  - verify exported CSV/XLSX contents match preview
*/
