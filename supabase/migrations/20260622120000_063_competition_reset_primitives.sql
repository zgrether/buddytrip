-- 063 — Competition reset primitives (WS4 "reset primitives" pattern).
--
-- Two reusable, TRANSACTIONAL operations over every game in a competition, by
-- blast radius. A reset is all-or-nothing per competition (a plpgsql function is
-- atomic by default), which the Supabase JS client cannot guarantee across the
-- multiple deletes/updates involved — so the logic lives here, called by thin
-- tRPC procedures (competitions.resetScoring / resetToSkeleton).
--
-- The buckets (Phase-0 audit, per game type):
--   IDENTITY  (never cleared): the game shell — id, name, type, competition,
--             point VALUE (points_total / per-match value), schedule; teams +
--             team_assignments (competition-level).
--   CONFIG    (skeleton clears): pairings (game_matches rows), roster
--             (game_participants), foursomes/pairs (play_groups), course
--             (course_id + scorecard_schema), modifiers, rules_for_today,
--             competition_format, pairings_published_at, and the placement SPLIT
--             (points_distribution for placement games — the per-match value is
--             identity and is kept).
--   SCORING   (both clear): game_results, score_entries, the RESULT columns on
--             game_matches (result/margin/status — NOT the pairing columns),
--             games.status/corrections_open.
--
-- The clears are TYPE-AGNOSTIC: each game type simply lacks the buckets it does
-- not use, so an absent table/column is a no-op (e.g. a stroke game has no
-- game_matches; a non-golf manual game has no participants/course/score_entries).
-- The per-type table in the audit is the correctness proof, not a branch.
--
-- reset_to_skeleton CALLS reset_scoring (superset by blast radius — results can't
-- outlive their config), it does NOT reimplement the result-clearing.
--
-- SECURITY DEFINER + an internal trip-Owner check: the op is owner-only (matching
-- the tRPC requireCompetitionRole('owner') gate). DEFINER lets one atomic function
-- clear across all the competition's games without per-table RLS friction; the
-- internal auth.uid() check closes the direct-PostgREST escalation hole that
-- DEFINER + EXECUTE-to-authenticated would otherwise open. Idempotent (CREATE OR
-- REPLACE).

-- ── Shared guard: caller must be the trip Owner, and the competition must belong
--    to the named trip (defends against a competition id from another trip). ────
CREATE OR REPLACE FUNCTION public.assert_competition_owner(p_trip_id text, p_competition_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members tm
    WHERE tm.trip_id = p_trip_id
      AND tm.user_id = (auth.uid())::text
      AND tm.role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'Only the trip owner can reset a competition' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = p_competition_id AND c.trip_id = p_trip_id
  ) THEN
    RAISE EXCEPTION 'Competition % not found in trip %', p_competition_id, p_trip_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- ── reset_competition_scoring — clears the SCORING bucket for every game in the
--    competition; keeps full config + identity. Games become re-scoreable
--    (config-intact, unscored): status → pending, corrections closed,
--    scoring_enabled KEPT (the game stays armed). ────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_competition_scoring(p_trip_id text, p_competition_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  v_game_ids text[];
BEGIN
  PERFORM public.assert_competition_owner(p_trip_id, p_competition_id);

  SELECT array_agg(id) INTO v_game_ids
  FROM public.games
  WHERE competition_id = p_competition_id;

  IF v_game_ids IS NULL THEN
    RETURN; -- no games — nothing to clear
  END IF;

  -- Results + raw scores (all game types that score).
  DELETE FROM public.game_results WHERE game_id = ANY(v_game_ids);
  DELETE FROM public.score_entries WHERE game_id = ANY(v_game_ids);

  -- Match-play RESULT columns only — keep the pairings (side_a/side_b). For
  -- non-match types there are no game_matches rows, so this is a no-op.
  UPDATE public.game_matches
    SET result = NULL, margin = NULL, status = 'pending'
    WHERE game_id = ANY(v_game_ids);

  -- Unscored lifecycle: drop active/complete back to pending, close corrections.
  -- scoring_enabled is intentionally KEPT (the game stays armed / re-scoreable).
  -- Dropped (abandoned) games stay dropped — un-dropping is a separate action.
  UPDATE public.games
    SET status = 'pending', corrections_open = false
    WHERE competition_id = p_competition_id AND status <> 'dropped';
END;
$$;

-- ── reset_competition_to_skeleton — SUPERSET of reset_scoring: clears scoring
--    (by CALLING it), then additionally clears the CONFIG bucket, leaving the
--    identity shell (+ teams) only. Games return to the setting-up/bones state:
--    scoring_enabled → false (un-armed). Golf types lose pairings/roster/course
--    and so derive back to "setting-up"; a non-golf manual game has no such
--    config, so it keeps its point value (identity) and reads "ready" — by
--    design, a manual game has nothing to set up beyond its name + value. ─────
CREATE OR REPLACE FUNCTION public.reset_competition_to_skeleton(p_trip_id text, p_competition_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  v_game_ids text[];
BEGIN
  -- Built ON reset_scoring (which also runs the owner guard) — NOT reimplemented.
  PERFORM public.reset_competition_scoring(p_trip_id, p_competition_id);

  SELECT array_agg(id) INTO v_game_ids
  FROM public.games
  WHERE competition_id = p_competition_id;

  IF v_game_ids IS NULL THEN
    RETURN;
  END IF;

  -- Config rows: pairings, roster, foursomes/pairs. (game_matches results were
  -- already nulled by reset_scoring; here the rows go entirely.)
  DELETE FROM public.game_matches WHERE game_id = ANY(v_game_ids);
  DELETE FROM public.game_participants WHERE game_id = ANY(v_game_ids);
  DELETE FROM public.play_groups WHERE game_id = ANY(v_game_ids);

  -- Per-game config columns. The point VALUE survives (identity): for placement
  -- games clear only the SPLIT (points_distribution → NULL, keep points_total);
  -- a per-match distribution holds the value itself, so it is kept untouched.
  UPDATE public.games
    SET course_id = NULL,
        scorecard_schema = NULL,
        modifiers = '{}'::jsonb,
        rules_for_today = NULL,
        competition_format = NULL,
        pairings_published_at = NULL,
        scoring_enabled = false,
        points_distribution = CASE
          WHEN points_distribution->>'type' = 'placement' THEN NULL
          ELSE points_distribution
        END
    WHERE competition_id = p_competition_id AND status <> 'dropped';
END;
$$;

-- The functions self-guard (owner check inside), so EXECUTE-to-authenticated is
-- safe — the tRPC layer also gates owner, but a direct PostgREST call is caught
-- by assert_competition_owner.
GRANT EXECUTE ON FUNCTION public.assert_competition_owner(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_competition_scoring(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_competition_to_skeleton(text, text) TO authenticated;
