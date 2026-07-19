-- 090 — can_score_unit: detect RACK cart-scoping by GAME TYPE, not by play_group presence.
--
-- The RLS score-write guard (`can_score_unit`, mig 072) inferred "rack" from the target
-- user having a `play_group_id` (its unit is the cart, so a cart-mate may score them). That
-- inference was only safe while STROKE participants were ungrouped. Migration 089 made
-- stroke groupings MANDATORY — so a grouped stroke player now also has a `play_group_id`,
-- and the old inference would let a stroke cart-mate score your individual row (a real
-- permission leak: stroke's unit is the INDIVIDUAL, not the group).
--
-- Fix: branch on the game TYPE. Only `gtt_rack_n_stack` is cart-scoped; every other
-- user-unit format (stroke) is individual-scoped — the caller may score only their own row.
-- Mirrors the pure `memberCanScoreUnit` (`src/lib/scoreUnit.ts`) which gained a `groupScoped`
-- flag set from the game type. The 2v2 (`play_group` participant) and 1v1 (match) branches
-- are unchanged — they resolve via `game_matches`, which rack/stroke don't have.
--
-- 072 applied and immutable; this is a new migration (CREATE OR REPLACE the function body).

CREATE OR REPLACE FUNCTION public.can_score_unit(
  p_game_id text,
  p_participant_id text,
  p_participant_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me text := (auth.uid())::text;
  v_my_pg text;
  v_target_pg text;
BEGIN
  IF me IS NULL THEN
    RETURN false;
  END IF;

  -- 2v2: participant is a SIDE (play_group). The caller must be in a play_group
  -- that is a side of the match containing that side (either side = same card).
  IF p_participant_type = 'play_group' THEN
    RETURN EXISTS (
      SELECT 1
      FROM game_matches gm
      JOIN game_participants gp
        ON gp.game_id = gm.game_id AND gp.user_id = me
      WHERE gm.game_id = p_game_id
        AND (gm.side_a->>'id' = p_participant_id OR gm.side_b->>'id' = p_participant_id)
        AND gp.play_group_id IN (gm.side_a->>'id', gm.side_b->>'id')
    );
  END IF;

  -- participant_type = 'user'

  -- 1v1: participant is a user-side of a match → the caller must be a user-side
  -- of that same match (their own match, both players).
  IF EXISTS (
    SELECT 1 FROM game_matches gm
    WHERE gm.game_id = p_game_id
      AND ((gm.side_a->>'type' = 'user' AND gm.side_a->>'id' = p_participant_id)
        OR (gm.side_b->>'type' = 'user' AND gm.side_b->>'id' = p_participant_id))
  ) THEN
    RETURN EXISTS (
      SELECT 1 FROM game_matches gm
      WHERE gm.game_id = p_game_id
        AND (gm.side_a->>'id' = p_participant_id OR gm.side_b->>'id' = p_participant_id)
        AND (gm.side_a->>'id' = me OR gm.side_b->>'id' = me)
    );
  END IF;

  -- rack (BY GAME TYPE, 090): the target user is in a play_group (cart) → the caller
  -- must share it. Gated on the game being rack, NOT merely on the target being grouped —
  -- stroke is grouped now too, and must fall through to the individual rule below.
  IF (SELECT game_type_id FROM games WHERE id = p_game_id) = 'gtt_rack_n_stack' THEN
    SELECT play_group_id INTO v_target_pg
    FROM game_participants
    WHERE game_id = p_game_id AND user_id = p_participant_id;
    IF v_target_pg IS NULL THEN
      RETURN false; -- an ungrouped rack target isn't a scorable unit for a member
    END IF;
    SELECT play_group_id INTO v_my_pg
    FROM game_participants
    WHERE game_id = p_game_id AND user_id = me;
    RETURN v_my_pg IS NOT NULL AND v_my_pg = v_target_pg;
  END IF;

  -- stroke (and any other non-match, non-rack user unit): the unit is the individual.
  -- The caller scores only their own row, and must be a participant — regardless of
  -- which group they're in.
  RETURN p_participant_id = me AND EXISTS (
    SELECT 1 FROM game_participants WHERE game_id = p_game_id AND user_id = me
  );
END;
$$;
