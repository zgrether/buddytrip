-- 035 — Competition engine, Slice B: match play (singles)
--
-- Adds play_groups (the physical foursome / shared card, deferred from Slice A),
-- game_matches (one row per 1v1), game_participants.handicap_strokes (the
-- minimal-net column — NOT games.modifiers.buddy_rules, which is the Slice F
-- framework built on top of this column later), and games.pairings_published_at
-- (gates member visibility of pairings). Per COMPETITION_ENGINE.md. All text IDs.
-- Idempotent.

-- ── play_groups ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.play_groups (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_play_groups_game_id ON public.play_groups (game_id);

-- game_participants.play_group_id existed as nullable text (Slice A context-FK
-- pattern) — now its parent exists, so add the constraint.
ALTER TABLE public.game_participants DROP CONSTRAINT IF EXISTS game_participants_play_group_id_fkey;
ALTER TABLE public.game_participants
  ADD CONSTRAINT game_participants_play_group_id_fkey
  FOREIGN KEY (play_group_id) REFERENCES public.play_groups(id) ON DELETE SET NULL;

-- Minimal-net handicap column (null = 0). The Buddy Rules framework (Slice F)
-- builds on THIS column — do not add games.modifiers.buddy_rules.
ALTER TABLE public.game_participants ADD COLUMN IF NOT EXISTS handicap_strokes integer;

-- ── game_matches ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_matches (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  play_group_id text REFERENCES public.play_groups(id) ON DELETE SET NULL, -- foursome card; both singles matches share it
  match_number integer,
  display_order integer NOT NULL DEFAULT 0,
  side_a jsonb,                              -- {"type":"user","id":"…"} for singles
  side_b jsonb,
  result text CHECK (result IN ('a_win', 'b_win', 'halve')),
  margin text,                               -- "3&2" | "2 UP" | null
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'complete')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_matches_game_id ON public.game_matches (game_id);
CREATE INDEX IF NOT EXISTS idx_game_matches_play_group_id ON public.game_matches (play_group_id);

-- games.pairings_published_at — set on activation; gates member visibility.
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS pairings_published_at timestamptz;

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Members read (the per-match "not announced yet" visibility is enforced in the
-- tRPC read, Task 5); Owner/Organizer write. Scoped through the game's trip.
ALTER TABLE public.play_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS play_groups_select ON public.play_groups;
CREATE POLICY play_groups_select ON public.play_groups FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = play_groups.game_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS play_groups_write ON public.play_groups;
CREATE POLICY play_groups_write ON public.play_groups FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = play_groups.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = play_groups.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])));

DROP POLICY IF EXISTS game_matches_select ON public.game_matches;
CREATE POLICY game_matches_select ON public.game_matches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_matches.game_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS game_matches_write ON public.game_matches;
CREATE POLICY game_matches_write ON public.game_matches FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_matches.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_matches.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])));
