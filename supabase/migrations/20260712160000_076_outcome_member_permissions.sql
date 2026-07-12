-- 076 — Refactor B3: hole-outcome entry, member-tier permissions
--
-- B2 built match_hole_outcomes with an ELEVATED-TIER-ONLY write policy
-- (owner/organizer/delegate — mig 075), deliberately deferring the member tier:
-- ctx.supabase in tRPC procedures is a user-scoped, RLS-ENFORCING client (not
-- service-role), so a member-tier app check without the matching RLS widening
-- would pass the check and then fail the actual write — a broken half-permission
-- state. This migration + the matchOutcomes.ts mutation change land TOGETHER.
--
-- can_score_match — "is the CALLER on either side of THIS match?" (the MEMBER
-- tier only; owner/organizer/delegate are the policy's other OR-branches).
-- Mirrors can_score_unit's 1v1/2v2 match-membership branches (mig 072), but
-- resolves the match DIRECTLY by id — an outcome is match-scoped, not
-- participant-scoped, so there's no participant_type dispatch to do.
CREATE OR REPLACE FUNCTION public.can_score_match(
  p_game_id text,
  p_match_id text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me text := (auth.uid())::text;
BEGIN
  IF me IS NULL THEN
    RETURN false;
  END IF;

  -- 1v1: the caller is a user-side of this match.
  IF EXISTS (
    SELECT 1 FROM game_matches gm
    WHERE gm.id = p_match_id AND gm.game_id = p_game_id
      AND ((gm.side_a->>'type' = 'user' AND gm.side_a->>'id' = me)
        OR (gm.side_b->>'type' = 'user' AND gm.side_b->>'id' = me))
  ) THEN
    RETURN true;
  END IF;

  -- 2v2: the caller is in a play_group that is a side of this match.
  RETURN EXISTS (
    SELECT 1
    FROM game_matches gm
    JOIN game_participants gp
      ON gp.game_id = gm.game_id AND gp.user_id = me
    WHERE gm.id = p_match_id AND gm.game_id = p_game_id
      AND gp.play_group_id IN (gm.side_a->>'id', gm.side_b->>'id')
  );
END;
$$;

-- Widen the write policy: elevated (unchanged) OR a member scoring their OWN
-- match, once scoring is enabled — the same shape score_entries_write uses.
DROP POLICY IF EXISTS match_hole_outcomes_write ON public.match_hole_outcomes;
CREATE POLICY match_hole_outcomes_write ON public.match_hole_outcomes FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = match_hole_outcomes.game_id
        AND is_trip_member(g.trip_id)
        AND (
          has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND can_score_match(match_hole_outcomes.game_id, match_hole_outcomes.match_id))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = match_hole_outcomes.game_id
        AND is_trip_member(g.trip_id)
        AND (
          has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND can_score_match(match_hole_outcomes.game_id, match_hole_outcomes.match_id))
        )
    )
  );
