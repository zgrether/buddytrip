-- 075 — Refactor B1: hole-outcome entry mode (storage only; no member write path yet)
--
-- Adds the per-game entry-mode toggle + the outcome store. The engine
-- (matchState/gloriousHoles) is already outcome-based (DecidedHole[] in, no score
-- coupling) — this migration only adds where an OUTCOME-mode game's decided holes
-- come from, as an alternative to score_entries + buildDecided.
--
-- A concession is NOT a data type here — "conceded" and "won by 3 net strokes" are
-- indistinguishable to the app: someone won the hole, or it was halved. There is no
-- concession/gimme flag and no "decided hole with no gross" special case.
--
-- Phased build (Refactor B): B1 (this migration) is storage + the finish-time
-- compute only — no entry UI, no member write path. B2 adds the entry surfaces +
-- durability; B3 adds the member-tier RLS policy (mirroring can_score_unit()),
-- presence-signal awareness, and the setup-page toggle. Until B3, this table's
-- write policy is elevated-tier only (owner/organizer/delegate) — sufficient for
-- server-side writes and tests; no member has a path to it yet.

-- Entry mode: 'score' (today's gross-entry path, unchanged default) or 'outcome'
-- (record who won each hole directly — no score_entries rows). Match-play only in
-- practice (the UI never offers this toggle for other formats), but kept a generic
-- games column (like scoring_enabled) rather than a match-play-specific table.
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'score';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_entry_mode_check'
  ) THEN
    ALTER TABLE public.games
      ADD CONSTRAINT games_entry_mode_check CHECK (entry_mode IN ('score', 'outcome'));
  END IF;
END $$;

-- One row per DECIDED hole per match. A hole with no row is simply undecided
-- (gap-tolerant, same contract as buildDecided's undecided-hole handling) — there is
-- no "cleared" state to distinguish from "never entered."
CREATE TABLE IF NOT EXISTS public.match_hole_outcomes (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  match_id text NOT NULL REFERENCES public.game_matches(id) ON DELETE CASCADE,
  hole_number integer NOT NULL,
  result text NOT NULL CHECK (result IN ('side_a', 'side_b', 'halved')),
  submitted_by text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, hole_number)
);

CREATE INDEX IF NOT EXISTS idx_match_hole_outcomes_game_id ON public.match_hole_outcomes(game_id);

ALTER TABLE public.match_hole_outcomes ENABLE ROW LEVEL SECURITY;

-- SELECT: any trip member (read parity with score_entries — viewing a card is not
-- the concern).
DROP POLICY IF EXISTS match_hole_outcomes_select ON public.match_hole_outcomes;
CREATE POLICY match_hole_outcomes_select ON public.match_hole_outcomes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = match_hole_outcomes.game_id AND is_trip_member(g.trip_id)
    )
  );

-- WRITE: elevated tier only for now (owner/organizer or this game's delegate) — the
-- SAME elevated OR-branch score_entries_write grants unconditionally. The member
-- tier (can_score_unit's match-membership check, reused) is B3's job; until then no
-- member has any path to this table, so there is nothing to under-protect.
DROP POLICY IF EXISTS match_hole_outcomes_write ON public.match_hole_outcomes;
CREATE POLICY match_hole_outcomes_write ON public.match_hole_outcomes FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = match_hole_outcomes.game_id
        AND is_trip_member(g.trip_id)
        AND (has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text]) OR is_game_delegate(g.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = match_hole_outcomes.game_id
        AND is_trip_member(g.trip_id)
        AND (has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text]) OR is_game_delegate(g.id))
    )
  );
