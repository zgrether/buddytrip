-- 079 — Delete-competition cascade (Phase 1: add the DELETE-games branch).
--
-- Product decision: deleting a competition should DELETE its games (default).
-- Today `competitions.delete` is a bare DELETE; the FK
-- `games.competition_id ON DELETE SET NULL` DETACHES games to their trip (scores
-- kept) — i.e. the current behavior already IS "keep games". This adds the
-- delete-games path and makes it the default. The FK stays SET NULL (the choice
-- is RUNTIME, via this RPC — NOT a DB ON DELETE CASCADE) so the future "keep"
-- branch stays possible once the orphan-display UI ships.
--
-- Mirrors the reset_competition_* pattern (mig 063): one atomic plpgsql body
-- (all-or-nothing, which the JS client can't guarantee across the multiple
-- deletes), SECURITY DEFINER + search_path='' + the shared assert_competition_owner
-- guard (owner-only, and closes the direct-PostgREST escalation hole that
-- DEFINER + EXECUTE-to-authenticated would otherwise open). Idempotent.
--
-- ORDERING IS LOAD-BEARING (Phase-0 call-out):
--   1. DELETE the games BY competition_id FIRST — while they can still be found by
--      it. Each game's children cascade via their own game_id FKs
--      (game_participants, score_entries, game_results, match_hole_outcomes,
--      play_groups, game_matches, game_delegates — all ON DELETE CASCADE), so no
--      explicit child deletes are needed.
--   2. THEN DELETE the competition (CASCADE-deletes teams + team_assignments).
--   If the competition were deleted first, its games would immediately be
--   SET NULL-detached and NO LONGER findable by competition_id (orphaned instead
--   of deleted — the exact bug); worse, the teams would cascade away while game
--   rows still hold their no-FK team_id / game_results.entity_id refs, re-creating
--   the audit #2/#4 danglers. Games-by-competition first, competition second.

CREATE OR REPLACE FUNCTION public.delete_competition_cascade(
  p_trip_id text,
  p_competition_id text,
  p_delete_games boolean DEFAULT true
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_competition_owner(p_trip_id, p_competition_id);

  -- (1) Delete the competition's games FIRST (their children cascade via game_id).
  --     Skipped when p_delete_games is false — the deferred "keep" path, where the
  --     competition DELETE below simply SET NULL-detaches the games (today's
  --     behavior). Near-term the caller always passes true; false is implemented so
  --     the RPC is ready but is NOT wired to any UI yet (gated on orphan-display).
  IF p_delete_games THEN
    DELETE FROM public.games WHERE competition_id = p_competition_id;
  END IF;

  -- (2) Then the competition itself (CASCADEs teams + team_assignments). Trip-
  --     scoped, defending against a competition id from another trip.
  DELETE FROM public.competitions WHERE id = p_competition_id AND trip_id = p_trip_id;
END;
$$;

-- Self-guarded (assert_competition_owner inside), so EXECUTE-to-authenticated is
-- safe — the tRPC layer also gates owner, but a direct PostgREST call is caught by
-- the guard. Matches the reset primitives' grant.
GRANT EXECUTE ON FUNCTION public.delete_competition_cascade(text, text, boolean) TO authenticated;
