-- 072 — Score-entry permissions (scoped, SERVER-enforced) + RLS defense-in-depth
--
-- Prior rule (mig 068): ANY trip member could write ANY score once the game had
-- scoring_enabled — so anyone could POST directly to /rest/v1/score_entries and
-- overwrite anyone's card, bypassing tRPC. This tightens the write path to the
-- scoped model (mirrors the tRPC guard in scores.upsertEntry/deleteEntry):
--   Owner / Organizer (comp owner/co-admin)  → any unit, any time.
--   Delegate of THIS game                    → any unit, any time.
--   Member                                   → only the match/group they play in,
--                                              and only once scoring is enabled.
--   Non-participant member                   → nothing.
-- SELECT (reading scores) is unchanged — viewing a card is not the concern.

-- can_score_unit — per-format "is the CALLER in the unit this score belongs to?"
-- (the MEMBER tier only; owner/organizer/delegate are handled by the policy's
-- other OR-branches). The unit is resolved from game_matches + game_participants,
-- never a format literal — mirrors src/lib/scoreUnit.ts::memberCanScoreUnit.
--   • 2v2  (participant_type 'play_group'): caller is in a side group of the match
--          containing p_participant_id.
--   • 1v1  (participant_type 'user', a user-side of a match): caller is the other
--          (or same) user-side of that match.
--   • rack (participant_type 'user', target has a play_group): caller shares it.
--   • stroke (participant_type 'user', no match/group): p_participant_id = caller,
--          and the caller is a participant.
-- SECURITY DEFINER + pinned search_path, like is_trip_member / is_game_delegate,
-- so it's usable inside the RLS policy. Reads only; leaks nothing (a boolean about
-- the caller's own access), so it is not REVOKEd from authenticated (the policy
-- needs to execute it).
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

  -- rack: the target user is in a play_group (cart) → the caller must share it.
  SELECT play_group_id INTO v_target_pg
  FROM game_participants
  WHERE game_id = p_game_id AND user_id = p_participant_id;
  IF v_target_pg IS NOT NULL THEN
    SELECT play_group_id INTO v_my_pg
    FROM game_participants
    WHERE game_id = p_game_id AND user_id = me;
    RETURN v_my_pg IS NOT NULL AND v_my_pg = v_target_pg;
  END IF;

  -- stroke: no match/group → the unit is the individual. The caller scores only
  -- their own row, and must be a participant.
  RETURN p_participant_id = me AND EXISTS (
    SELECT 1 FROM game_participants WHERE game_id = p_game_id AND user_id = me
  );
END;
$$;

-- Tighten the write policy to the scoped model. USING (existing rows: UPDATE/
-- DELETE) and WITH CHECK (new/updated rows: INSERT/UPDATE) use the SAME
-- expression, so the unit a member may clear == the unit they may enter.
DROP POLICY IF EXISTS score_entries_write ON public.score_entries;
CREATE POLICY score_entries_write ON public.score_entries FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = score_entries.game_id
        AND is_trip_member(g.trip_id)
        AND (
          -- Elevated: owner/organizer or this game's delegate — any unit, any time.
          has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR is_game_delegate(g.id)
          -- Member: only their own unit, and only once scoring is enabled.
          OR (g.scoring_enabled = true
              AND can_score_unit(score_entries.game_id, score_entries.participant_id, score_entries.participant_type))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = score_entries.game_id
        AND is_trip_member(g.trip_id)
        AND (
          has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND can_score_unit(score_entries.game_id, score_entries.participant_id, score_entries.participant_type))
        )
    )
  );
