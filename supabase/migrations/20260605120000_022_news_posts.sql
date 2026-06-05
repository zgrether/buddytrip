-- ────────────────────────────────────────────────────────────────────────
-- Migration 022 — News (the Trip Board): posts + read tracking
-- ────────────────────────────────────────────────────────────────────────
--
-- News is the owner/organizer announcement channel. Owner + Planner post
-- updates to the whole crew; everyone reads. A post is an ordered stack of
-- "blocks" (six closed types: text / crew / teams / media / steps / callout),
-- stored as a JSONB array — the block shape is a discriminated union owned by
-- the app layer (src/lib/news.ts), so it can evolve without a schema change.
--
-- Read tracking mirrors chat_reads (migration 010): one row per (trip, user)
-- holding the timestamp the user last opened the News panel. Unread count =
-- posts with created_at > last_read_at authored by someone else.
--
-- Idempotent (IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE) so it is safe on
-- a fresh database and a no-op if re-applied. trips/users FKs cascade so a
-- deleted trip or merged-away user cleans up its posts + read rows.

-- ── news_posts ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.news_posts (
  id          text        NOT NULL DEFAULT gen_random_uuid()::text,
  trip_id     text        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  author_id   text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocks      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  pinned      boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Feed order is (pinned DESC, created_at DESC); this index covers the scan.
CREATE INDEX IF NOT EXISTS news_posts_trip_feed
  ON public.news_posts (trip_id, pinned DESC, created_at DESC);

COMMENT ON TABLE public.news_posts IS
  'Owner/Planner announcements broadcast to all trip crew. A post is an ordered '
  'JSONB stack of blocks (text/crew/teams/media/steps/callout). Pinned posts '
  'sort above unpinned in the feed.';

ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;

-- Any trip member may read posts for their trips.
DROP POLICY IF EXISTS news_posts_select ON public.news_posts;
CREATE POLICY news_posts_select ON public.news_posts
  FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

-- Only Owner / Planner may post (and only as themselves).
DROP POLICY IF EXISTS news_posts_insert ON public.news_posts;
CREATE POLICY news_posts_insert ON public.news_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (auth.uid())::text
    AND has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text])
  );

-- Owner / Planner may edit any post (pin/unpin, edit blocks). Since only
-- Owner/Planner can create posts, every author is already covered here, which
-- satisfies "author edits own + organizers edit any".
DROP POLICY IF EXISTS news_posts_update ON public.news_posts;
CREATE POLICY news_posts_update ON public.news_posts
  FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]))
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));

-- Owner / Planner may delete posts.
DROP POLICY IF EXISTS news_posts_delete ON public.news_posts;
CREATE POLICY news_posts_delete ON public.news_posts
  FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));

-- ── news_reads ───────────────────────────────────────────────────────────
--
-- One row per (trip, user). Upserted to now() when the user opens the News
-- panel. Unread = news_posts.count WHERE created_at > last_read_at AND
-- author_id != me. Same pattern as chat_reads.

CREATE TABLE IF NOT EXISTS public.news_reads (
  trip_id      text        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id      text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

COMMENT ON TABLE public.news_reads IS
  'Per-user last-read timestamp for trip News. Drives the unread badge on the '
  'News title-bar button. Source of truth across devices.';

ALTER TABLE public.news_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS news_reads_select ON public.news_reads;
CREATE POLICY news_reads_select ON public.news_reads
  FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text AND is_trip_member(trip_id));

DROP POLICY IF EXISTS news_reads_insert ON public.news_reads;
CREATE POLICY news_reads_insert ON public.news_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text AND is_trip_member(trip_id));

DROP POLICY IF EXISTS news_reads_update ON public.news_reads;
CREATE POLICY news_reads_update ON public.news_reads
  FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text AND is_trip_member(trip_id))
  WITH CHECK (user_id = (auth.uid())::text AND is_trip_member(trip_id));
