-- 152 — a pick'em game can be given a points total, at any time.
--
-- Phase 4 §2. `games.points_total` had no picker anywhere in pick'em, so it sat
-- at its creation default and every match was worth 0.00 — the pairing grid
-- looked right and awarded nothing. Silent-wrong, and the cause was simply that
-- nothing ever set it.
--
-- ══ Why this is NOT a new key on save_pickem_config's frozen payload ═══════
--
-- `save_pickem_config` refuses everything once picks are open (`SLATE_LOCKED`),
-- because the slate and the two scoring SETTINGS are frozen together at that
-- instant — spec §4, and the reason is that everyone has already ranked against
-- them.
--
-- The points total is not like that. It changes what the game is WORTH to the
-- competition; it changes nothing a participant has already decided. Nobody
-- ranked their picks differently because the game was worth 8 instead of 6, and
-- there is no version of "the runner set the stakes after people picked" that
-- disadvantages anyone. In practice setting it later is the COMMON case: the
-- total is a competition-level judgement the runner makes once the cup's shape
-- is clear, and nothing in the flow forces it earlier.
--
-- Putting it behind the freeze would mean the only way to fix a 0-point game
-- discovered mid-trip is `reopen` — which clears every ranking. That is the
-- same trap migration 151's `unlock` was written to remove, and it would be
-- worse here, because the runner would be destroying sixteen sheets to correct
-- a number that never affected them.
--
-- So: its own function, its own gate, no freeze.
--
-- ══ Why a function at all, rather than an UPDATE through RLS ═══════════════
--
-- `games` has an UPDATE policy, but the predicate that decides who may edit a
-- GAME is `assert_game_edit` (Owner / Organizer / this game's delegate), and it
-- is the one every other pick'em write already goes through. A second
-- expression of the same rule is how the two drift — CLAUDE.md's recurring
-- shape. One gate, reused.
--
-- SECURITY DEFINER, and it satisfies CLAUDE.md #28's test: the body reaches
-- `auth.uid()` through `assert_game_edit`, so its answer depends on who is
-- asking. It is not a container-fact helper.

CREATE OR REPLACE FUNCTION public.set_pickem_points_total(p_game_id text, p_total numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  -- NULL is a legitimate value and means "not decided yet" — distinct from 0,
  -- which means "decided, and worth nothing". The settings row surfaces both as
  -- a warning once matches exist, but they are different states and the column
  -- keeps them apart.
  IF p_total IS NOT NULL AND p_total < 0 THEN
    RAISE EXCEPTION 'BAD_TOTAL: points cannot be negative'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.games
     SET points_total = p_total
   WHERE id = p_game_id
     AND game_type_id = 'gtt_pickem';

  -- Scoped to pick'em deliberately. Every other format sets its total through
  -- `save_game_config`'s draft, which carries validation this function does not
  -- — a stray call naming a match-play game must not become a second, thinner
  -- write path into the same column.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND: no pick''em game with that id'
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_pickem_points_total(text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_pickem_points_total(text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_pickem_points_total(text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pickem_points_total(text, numeric) TO service_role;

COMMENT ON FUNCTION public.set_pickem_points_total(text, numeric) IS
  'Sets games.points_total for a pick''em game. Deliberately NOT part of save_pickem_config''s frozen payload: the total changes what the game is worth, not anything a participant already decided, and locking it behind the freeze would make a mid-trip 0-point game fixable only by reopen — which clears every ranking (migration 152).';
