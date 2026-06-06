-- ────────────────────────────────────────────────────────────────────────
-- Migration 024 — Architecture anchors for the post-launch competition build
-- ────────────────────────────────────────────────────────────────────────
--
-- This migration lays down the structural anchors the gaming/competition
-- engine will grow into, and retires the dead `series` feature. Everything
-- here is additive (new tables/columns + reference seed data) EXCEPT the
-- `series` drop, which is safe: the table is empty and no trip references it.
--
-- Ordering matters:
--   1. Re-point merge_guest_to_real_user OFF series (lockstep rule, CLAUDE.md)
--   2. Drop trips.series_id (the only FK into series) then DROP TABLE series
--   3. Create the circle_* anchor tables
--   4. Add trips.circle_id / trips.thread_type
--   5. Create game_type_templates + seed the 4 v1 game types
--
-- Idempotent throughout (IF EXISTS / IF NOT EXISTS / DROP POLICY + CREATE),
-- so it is safe on a fresh DB and a no-op if re-applied.

-- ── 1. Keep merge_guest_to_real_user in lockstep with the schema ────────────
-- migration 023 fixed this function; we are about to drop public.series, so its
-- `UPDATE public.series SET owner_id = …` line must go in the SAME migration or
-- the next signup-with-matching-guest would raise "relation does not exist"
-- inside the on_auth_user_created trigger and roll the signup back. (This is the
-- exact failure mode CLAUDE.md warns about.)
CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.trip_members     SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.team_assignments SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.idea_votes       SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.date_poll_votes  SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expense_splits   SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.messages         SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses         SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.quick_info_tiles SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.users            SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.invites          SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;

-- ── 2. Retire the dead `series` feature ─────────────────────────────────────
-- series was a "linked trips over the years" grouping that never shipped a UI.
-- Confirmed empty (0 rows) and unreferenced (0 trips with series_id) at launch.
ALTER TABLE public.trips DROP COLUMN IF EXISTS series_id;  -- drops trips_series_id_fkey with it
DROP TABLE IF EXISTS public.series;

-- ── 3. circles — the persistent buddy group above individual trips ──────────
-- A circle is the long-lived social container (a recurring crew). Trips will
-- belong to a circle (trips.circle_id below). These are ANCHOR STUBS: just
-- enough shape + RLS to build on post-launch; columns will be filled in by the
-- competition build. No app code reads them yet.
CREATE TABLE IF NOT EXISTS public.circles (
  id          text        NOT NULL DEFAULT gen_random_uuid()::text,
  name        text        NOT NULL,
  created_by  text        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
COMMENT ON TABLE public.circles IS
  'Anchor stub (migration 024): the persistent buddy group above trips. The '
  'post-launch competition build fills this out. No app reads yet.';
ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;
-- NB: the circles_select policy references circle_members, so it is created
-- below, after that table exists (a policy can't reference a not-yet-created
-- relation within the same transactional migration).

-- ── circle_members — who is in a circle, and their role there ───────────────
CREATE TABLE IF NOT EXISTS public.circle_members (
  circle_id  text        NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id    text        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'Member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);
COMMENT ON TABLE public.circle_members IS
  'Anchor stub (migration 024): circle membership + role. Mirrors trip_members.';
CREATE INDEX IF NOT EXISTS idx_circle_members_user_id ON public.circle_members (user_id);
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;
-- A user sees their own membership rows (avoids recursion with circles_select).
DROP POLICY IF EXISTS circle_members_select ON public.circle_members;
CREATE POLICY circle_members_select ON public.circle_members
  FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text);

-- circles_select (deferred from the circles block above — references circle_members).
-- A user sees circles they belong to.
DROP POLICY IF EXISTS circles_select ON public.circles;
CREATE POLICY circles_select ON public.circles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.circle_members m
    WHERE m.circle_id = circles.id AND m.user_id = (auth.uid())::text
  ));

-- ── circle_courses — golf courses a circle plays (stub) ─────────────────────
CREATE TABLE IF NOT EXISTS public.circle_courses (
  id         text        NOT NULL DEFAULT gen_random_uuid()::text,
  circle_id  text        NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
COMMENT ON TABLE public.circle_courses IS
  'Anchor stub (migration 024): courses associated with a circle. To be expanded '
  'by the competition build.';
CREATE INDEX IF NOT EXISTS idx_circle_courses_circle_id ON public.circle_courses (circle_id);
ALTER TABLE public.circle_courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circle_courses_select ON public.circle_courses;
CREATE POLICY circle_courses_select ON public.circle_courses
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.circle_members m
    WHERE m.circle_id = circle_courses.circle_id AND m.user_id = (auth.uid())::text
  ));

-- ── circle_events — circle-level events/competitions (stub) ─────────────────
CREATE TABLE IF NOT EXISTS public.circle_events (
  id         text        NOT NULL DEFAULT gen_random_uuid()::text,
  circle_id  text        NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
COMMENT ON TABLE public.circle_events IS
  'Anchor stub (migration 024): circle-level events/competitions spanning trips. '
  'To be expanded by the competition build.';
CREATE INDEX IF NOT EXISTS idx_circle_events_circle_id ON public.circle_events (circle_id);
ALTER TABLE public.circle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circle_events_select ON public.circle_events;
CREATE POLICY circle_events_select ON public.circle_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.circle_members m
    WHERE m.circle_id = circle_events.circle_id AND m.user_id = (auth.uid())::text
  ));

-- ── 4. Anchor columns on trips ──────────────────────────────────────────────
-- circle_id: which circle this trip belongs to (nullable until backfilled by
--   the competition build). ON DELETE SET NULL so deleting a circle doesn't take
--   its trips with it.
-- thread_type: anchor for the unified messaging model (chat threads will be
--   typed, e.g. 'trip' vs circle-level threads). Nullable text, no constraint
--   yet — the closed set lands with the messaging refactor.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS circle_id   text REFERENCES public.circles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thread_type text;
CREATE INDEX IF NOT EXISTS idx_trips_circle_id ON public.trips (circle_id);

-- ── 5. game_type_templates — catalog of competition game formats ────────────
-- Reference/config data (a lookup table), NOT user mock data, so it is seeded
-- here in the migration rather than in seed.sql. `key` matches the existing
-- events.scoring_format enum values so the engine can join templates to events.
CREATE TABLE IF NOT EXISTS public.game_type_templates (
  id          text        NOT NULL DEFAULT gen_random_uuid()::text,
  key         text        NOT NULL,
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (key)
);
COMMENT ON TABLE public.game_type_templates IS
  'Catalog of competition game formats (reference data, seeded in migration). '
  'key matches events.scoring_format so the competition engine can join.';
ALTER TABLE public.game_type_templates ENABLE ROW LEVEL SECURITY;
-- Reference data: readable by any authenticated user. No write policy (seeded
-- via migration / service role only).
DROP POLICY IF EXISTS game_type_templates_select ON public.game_type_templates;
CREATE POLICY game_type_templates_select ON public.game_type_templates
  FOR SELECT TO authenticated
  USING (true);

-- Seed the 4 v1 game types (the formats with shipped UI labels in
-- EventsPanel.FORMAT_LABELS). ON CONFLICT keeps this idempotent and lets the
-- name/description/sort_order be refreshed on re-apply without dup rows.
INSERT INTO public.game_type_templates (key, name, description, sort_order) VALUES
  ('scramble',   'Scramble',   'Team format: everyone tees off, the team plays the best ball each shot.', 1),
  ('stableford', 'Stableford', 'Points-based scoring rewarding strong holes; highest total wins.',       2),
  ('skins',      'Skins',      'Each hole is worth a skin; win it outright to claim, ties carry over.',  3),
  ('match_play', 'Match Play', 'Head-to-head by holes won rather than total strokes.',                   4)
ON CONFLICT (key) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      sort_order  = EXCLUDED.sort_order;
