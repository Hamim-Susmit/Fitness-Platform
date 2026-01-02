-- Phase 6: Step 6 - Social, friends & activity feed

-- Non-functional notes (documentation only):
/*
  - Social features must NOT pressure unhealthy competition.
  - Feed should reward encouragement, not comparison.
  - Private mode must always be respected.
  - Blocking must remove visibility both ways.
  - Index created_at for feed performance.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'friend_status') THEN
    CREATE TYPE public.friend_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'BLOCKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feed_event_type') THEN
    CREATE TYPE public.feed_event_type AS ENUM ('WORKOUT_COMPLETED', 'ACHIEVEMENT_EARNED', 'GOAL_COMPLETED', 'CHECKIN');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feed_visibility') THEN
    CREATE TYPE public.feed_visibility AS ENUM ('PUBLIC', 'FRIENDS_ONLY', 'PRIVATE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status public.friend_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS friends_pair_unique
  ON public.friends (LEAST(requester_id, receiver_id), GREATEST(requester_id, receiver_id));

CREATE INDEX IF NOT EXISTS friends_requester_idx
  ON public.friends (requester_id);

CREATE INDEX IF NOT EXISTS friends_receiver_idx
  ON public.friends (receiver_id);

CREATE TRIGGER set_friends_updated_at
BEFORE UPDATE ON public.friends
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.activity_feed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  event_type public.feed_event_type NOT NULL,
  related_id uuid,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility public.feed_visibility NOT NULL DEFAULT 'FRIENDS_ONLY',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_feed_events_member_idx
  ON public.activity_feed_events (member_id);

CREATE INDEX IF NOT EXISTS activity_feed_events_type_idx
  ON public.activity_feed_events (event_type);

CREATE INDEX IF NOT EXISTS activity_feed_events_created_idx
  ON public.activity_feed_events (created_at DESC);

CREATE TABLE IF NOT EXISTS public.feed_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.activity_feed_events (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS feed_likes_unique
  ON public.feed_likes (event_id, member_id);

CREATE TABLE IF NOT EXISTS public.feed_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.activity_feed_events (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_feed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_comments ENABLE ROW LEVEL SECURITY;

-- Friend relationships: only participants can view/manage.
CREATE POLICY friends_select_participants
ON public.friends
FOR SELECT
USING (requester_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY friends_insert_requester
ON public.friends
FOR INSERT
WITH CHECK (requester_id = auth.uid() AND requester_id <> receiver_id);

CREATE POLICY friends_update_participants
ON public.friends
FOR UPDATE
USING (requester_id = auth.uid() OR receiver_id = auth.uid())
WITH CHECK (requester_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY friends_delete_participants
ON public.friends
FOR DELETE
USING (requester_id = auth.uid() OR receiver_id = auth.uid());

-- Feed visibility:
-- PUBLIC events visible to all authenticated users.
-- FRIENDS_ONLY events visible only to accepted friends; blocked relationships hide both ways.
-- PRIVATE events visible only to the event owner.
CREATE POLICY activity_feed_events_select
ON public.activity_feed_events
FOR SELECT
USING (
  member_id = auth.uid()
  OR (
    visibility = 'PUBLIC'
    AND NOT EXISTS (
      SELECT 1 FROM public.friends f
      WHERE (f.requester_id = activity_feed_events.member_id AND f.receiver_id = auth.uid())
         OR (f.receiver_id = activity_feed_events.member_id AND f.requester_id = auth.uid())
        AND f.status = 'BLOCKED'
    )
  )
  OR (
    visibility = 'FRIENDS_ONLY'
    AND EXISTS (
      SELECT 1 FROM public.friends f
      WHERE ((f.requester_id = activity_feed_events.member_id AND f.receiver_id = auth.uid())
          OR (f.receiver_id = activity_feed_events.member_id AND f.requester_id = auth.uid()))
        AND f.status = 'ACCEPTED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.friends f
      WHERE (f.requester_id = activity_feed_events.member_id AND f.receiver_id = auth.uid())
         OR (f.receiver_id = activity_feed_events.member_id AND f.requester_id = auth.uid())
        AND f.status = 'BLOCKED'
    )
  )
);

-- Members can publish their own feed events.
CREATE POLICY activity_feed_events_insert_owner
ON public.activity_feed_events
FOR INSERT
WITH CHECK (member_id = auth.uid());

-- Likes/comments only on visible events.
CREATE POLICY feed_likes_select
ON public.feed_likes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.activity_feed_events e
    WHERE e.id = feed_likes.event_id
      AND (
        e.member_id = auth.uid()
        OR (
          e.visibility = 'PUBLIC'
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
        OR (
          e.visibility = 'FRIENDS_ONLY'
          AND EXISTS (
            SELECT 1 FROM public.friends f
            WHERE ((f.requester_id = e.member_id AND f.receiver_id = auth.uid())
                OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid()))
              AND f.status = 'ACCEPTED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
      )
  )
);

CREATE POLICY feed_likes_insert
ON public.feed_likes
FOR INSERT
WITH CHECK (
  member_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.activity_feed_events e
    WHERE e.id = feed_likes.event_id
      AND (
        e.member_id = auth.uid()
        OR (
          e.visibility = 'PUBLIC'
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
        OR (
          e.visibility = 'FRIENDS_ONLY'
          AND EXISTS (
            SELECT 1 FROM public.friends f
            WHERE ((f.requester_id = e.member_id AND f.receiver_id = auth.uid())
                OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid()))
              AND f.status = 'ACCEPTED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
      )
  )
);

CREATE POLICY feed_comments_select
ON public.feed_comments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.activity_feed_events e
    WHERE e.id = feed_comments.event_id
      AND (
        e.member_id = auth.uid()
        OR (
          e.visibility = 'PUBLIC'
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
        OR (
          e.visibility = 'FRIENDS_ONLY'
          AND EXISTS (
            SELECT 1 FROM public.friends f
            WHERE ((f.requester_id = e.member_id AND f.receiver_id = auth.uid())
                OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid()))
              AND f.status = 'ACCEPTED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
      )
  )
);

CREATE POLICY feed_comments_insert
ON public.feed_comments
FOR INSERT
WITH CHECK (
  member_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.activity_feed_events e
    WHERE e.id = feed_comments.event_id
      AND (
        e.member_id = auth.uid()
        OR (
          e.visibility = 'PUBLIC'
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
        OR (
          e.visibility = 'FRIENDS_ONLY'
          AND EXISTS (
            SELECT 1 FROM public.friends f
            WHERE ((f.requester_id = e.member_id AND f.receiver_id = auth.uid())
                OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid()))
              AND f.status = 'ACCEPTED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.friends f
            WHERE (f.requester_id = e.member_id AND f.receiver_id = auth.uid())
               OR (f.receiver_id = e.member_id AND f.requester_id = auth.uid())
              AND f.status = 'BLOCKED'
          )
        )
      )
  )
);

-- Manual QA checklist (documentation only):
/*
  - friend request requires approval
  - FRIENDS_ONLY posts do not appear to strangers
  - PRIVATE events visible only to creator
  - blocked users cannot see each other’s events
  - likes/comments only work when user has visibility
  - feed syncs across web + mobile
*/
