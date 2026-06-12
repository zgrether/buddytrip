-- 043 · Slice D1 (2a) — additive: competition–game unification, Phase 1.
--
-- ADDITIVE ONLY — no removals, no repoints, no drops (those are later staged
-- migrations: 2b formats, 2c backfill, 2d repoint, 2e drop). Every column added
-- here is NULLABLE: the Phase-1 competition "shell" (competition_id + game_type
-- + name + points_distribution + status) must be a fully valid game with every
-- Phase-2 field (course, schema, pairings, schedule_item…) still null. (§3)
--
-- Idempotent (IF NOT EXISTS / DROP+ADD CONSTRAINT) so it is safe to re-apply.

-- ── games.points_distribution ────────────────────────────────────────────────
-- Ordered points by place, e.g. [9,6,4,2]. A COMPETITION-LAYER fact, so its own
-- column — NOT games.config (engine config) and NOT games.modifiers. Null for
-- standalone / non-competition games. (§2a)
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS points_distribution jsonb;

-- ── games.status += 'dropped' ────────────────────────────────────────────────
-- A game pulled for time is `dropped`, not deleted — kept, reversible, and
-- excluded from points-available / win number / leaderboard total. (§4)
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_status_check;
ALTER TABLE public.games ADD CONSTRAINT games_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'complete'::text, 'dropped'::text]));

-- ── games.schedule_item_id (optional agenda link) ────────────────────────────
-- Nullable, one-directional, NEVER a gate (§9). Deliberately `uuid` to match
-- schedule_items.id — an intentional exception to the app-wide text-PK norm
-- (schedule_items predates it). game→item is the cleaner direction than the
-- legacy schedule_items.competition_event_id (retired in 2d).
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS schedule_item_id uuid
  REFERENCES public.schedule_items(id) ON DELETE SET NULL;

-- ── game_organizers (per-game delegation) ────────────────────────────────────
-- "Brad tells BJ you run pick'em" — a GAME-SCOPED organizer grant, not a
-- trip-wide role bump. The edit-resolution rule (canEdit || isGameOrganizer)
-- is wired into the game-edit gate + games/game_results RLS in a later step;
-- this is the data + its own RLS. (§8)
CREATE TABLE IF NOT EXISTS public.game_organizers (
  game_id    text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  granted_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

ALTER TABLE public.game_organizers ENABLE ROW LEVEL SECURITY;

-- Any trip member may SEE who runs which game; only trip owner/organizer may
-- grant/revoke (the act of delegating is itself a trip-organizer action).
DROP POLICY IF EXISTS game_organizers_select ON public.game_organizers;
CREATE POLICY game_organizers_select ON public.game_organizers
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_organizers.game_id AND is_trip_member(g.trip_id)
  ));

DROP POLICY IF EXISTS game_organizers_write ON public.game_organizers;
CREATE POLICY game_organizers_write ON public.game_organizers
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_organizers.game_id
      AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_organizers.game_id
      AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
  ));

-- ── competitions.defending_team_id (retain case) ─────────────────────────────
-- Optional. When set, that team clinches at EXACTLY half (a tie retains);
-- null (default) = everyone must EXCEED half. The field + the threshold tweak,
-- nothing more. (§6)
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS defending_team_id text
  REFERENCES public.teams(id) ON DELETE SET NULL;
