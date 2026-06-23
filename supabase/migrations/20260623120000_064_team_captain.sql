-- 064 — Team captain (Rosters PR b): the captain flag + atomic setter.
--
-- Captain is a PERMISSION TIER, not just a badge. Team data splits two ways:
--   structure (owner-only): create/delete teams, assign/remove players;
--   identity  (owner OR the team's captain): name, short name, color.
-- This migration adds the flag the identity tier keys off and the owner-gated,
-- atomic setter. The identity-edit re-gating (teams.update) is the next PR (b2).
--
-- is_captain lives on team_assignments (not a pointer on teams): captaincy is a
-- property of THIS user's membership on THIS team, and rides the assignment's
-- lifecycle — unassign the player and the captaincy goes with the row.

ALTER TABLE public.team_assignments
  ADD COLUMN IF NOT EXISTS is_captain boolean NOT NULL DEFAULT false;

-- One captain per team, enforced declaratively. The partial predicate lets every
-- non-captain row coexist while capping is_captain=true at one per (comp, team).
CREATE UNIQUE INDEX IF NOT EXISTS team_assignments_one_captain_per_team
  ON public.team_assignments (competition_id, team_id)
  WHERE is_captain;

-- ── set_team_captain — owner-only, ATOMIC ────────────────────────────────────
-- Appointing a captain is a structure act (the owner appoints; the captain does
-- not pass it on), so this is owner-gated via assert_competition_owner (mig 063).
-- SECURITY DEFINER for the one atomic swap; the internal owner check closes the
-- direct-PostgREST hole that DEFINER + EXECUTE-to-authenticated would open.
--
-- p_is_captain = true  → make p_user_id the captain: CLEAR the team's current
--   captain first, then SET — so the one-per-team unique index never sees two.
-- p_is_captain = false → unmark JUST p_user_id (never touches a different
--   captain). Tapping the current ★ off leaves the team with no captain (allowed).
-- Throws if the target isn't assigned to the team.
CREATE OR REPLACE FUNCTION public.set_team_captain(
  p_trip_id text,
  p_competition_id text,
  p_team_id text,
  p_user_id text,
  p_is_captain boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_competition_owner(p_trip_id, p_competition_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.team_assignments
    WHERE competition_id = p_competition_id AND team_id = p_team_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'User % is not assigned to team %', p_user_id, p_team_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_is_captain THEN
    -- Atomic swap: clear the prior captain, then set the new one.
    UPDATE public.team_assignments
      SET is_captain = false
      WHERE competition_id = p_competition_id AND team_id = p_team_id AND is_captain;
    UPDATE public.team_assignments
      SET is_captain = true
      WHERE competition_id = p_competition_id AND team_id = p_team_id AND user_id = p_user_id;
  ELSE
    -- Unmark only this user (leaves any other captain alone — though one-per-team
    -- means there isn't one; defensive).
    UPDATE public.team_assignments
      SET is_captain = false
      WHERE competition_id = p_competition_id AND team_id = p_team_id AND user_id = p_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_team_captain(text, text, text, text, boolean) TO authenticated;
