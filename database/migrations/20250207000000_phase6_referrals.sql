-- Phase 6: Step 7 - Referrals & rewards system

-- Non-functional notes (documentation only):
/*
  - Do not auto-apply billing discounts yet (Stripe integration later).
  - Reward engine must support future promo codes, loyalty tiers, and campaigns.
  - Avoid fraud vectors: self-referral, duplicate device signups, repeated email aliases.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_status') THEN
    CREATE TYPE public.referral_status AS ENUM ('INVITED', 'SIGNED_UP', 'ACTIVATED', 'REWARDED', 'FAILED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_reward_type') THEN
    CREATE TYPE public.referral_reward_type AS ENUM ('FREE_MONTH', 'CREDITS', 'POINTS', 'DISCOUNT_TOKEN');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_reward_status') THEN
    CREATE TYPE public.referral_reward_status AS ENUM ('PENDING', 'ISSUED', 'REDEEMED', 'EXPIRED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  referred_email text NOT NULL,
  referred_member_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  referral_code text NOT NULL,
  status public.referral_status NOT NULL DEFAULT 'INVITED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS referrals_unique_email
  ON public.referrals (referrer_member_id, referred_email);

CREATE INDEX IF NOT EXISTS referrals_code_idx
  ON public.referrals (referral_code);

CREATE INDEX IF NOT EXISTS referrals_referred_member_idx
  ON public.referrals (referred_member_id);

CREATE TRIGGER set_referrals_updated_at
BEFORE UPDATE ON public.referrals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  referred_member_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  reward_type public.referral_reward_type NOT NULL,
  reward_value numeric,
  issued_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  status public.referral_reward_status NOT NULL DEFAULT 'PENDING',
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx
  ON public.referral_rewards (referrer_member_id);

CREATE INDEX IF NOT EXISTS referral_rewards_referred_idx
  ON public.referral_rewards (referred_member_id);

CREATE TABLE IF NOT EXISTS public.referral_click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code text NOT NULL,
  ip_hash text,
  user_agent text,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_click_events ENABLE ROW LEVEL SECURITY;

-- Members can view referrals they participate in (referrer or referred).
CREATE POLICY referrals_select_participants
ON public.referrals
FOR SELECT
USING (
  referrer_member_id = auth.uid()
  OR referred_member_id = auth.uid()
);

-- Members can create referral invites for themselves (status stays INVITED).
CREATE POLICY referrals_insert_referrer
ON public.referrals
FOR INSERT
WITH CHECK (
  referrer_member_id = auth.uid()
  AND status = 'INVITED'
);

-- Prevent members from arbitrarily modifying referral status.
-- Admin/service roles should update state transitions.
CREATE POLICY referrals_update_admin
ON public.referrals
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Rewards are visible to participants but issued by admin/service only.
CREATE POLICY referral_rewards_select_participants
ON public.referral_rewards
FOR SELECT
USING (
  referrer_member_id = auth.uid()
  OR referred_member_id = auth.uid()
);

CREATE POLICY referral_rewards_insert_admin
ON public.referral_rewards
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

CREATE POLICY referral_rewards_update_admin
ON public.referral_rewards
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'owner'
  )
);

-- Click events are insert-only (analytics) with no public select.
CREATE POLICY referral_click_events_insert
ON public.referral_click_events
FOR INSERT
WITH CHECK (true);

-- Manual QA checklist (documentation only):
/*
  - referral link → signup → activation flows correctly
  - duplicate referral to same email blocked
  - rewards issued exactly once
  - referrer can see referral history but not other emails
  - UI matches web + mobile behavior
*/
