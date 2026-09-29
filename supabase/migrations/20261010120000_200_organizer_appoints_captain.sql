-- Migration 200 — an Organizer can appoint a team captain (PR 8 permissions pass).
--
-- REVERSES migration 064's "Owner-gated" captain appointment (its header:
-- set_team_captain "authorization checked HERE" via assert_competition_owner).
-- Why now: the principle ruled 2026-09-29 is that you can hand out powers you
-- already hold. Since migration 199 an Organizer holds every roster right a
-- captain gets (rename, reorder, add, remove) and more, so letting them appoint
-- one grants nothing they could not do themselves. It also follows the rule 199
-- applied to renaming: the less consequential action follows the more
-- consequential one. An Organizer who can delete a team can name its captain.
--
-- Mechanics. set_team_captain called the SHARED assert_competition_owner, which
-- also guards reset_competition_scoring, reset_competition_to_skeleton and
-- delete_competition_cascade. Widening that assert would widen competition
-- delete, which stays Owner-only (organizerParity.guards.test.ts "4 —
-- competitions.delete"). So the function gets its own gate, carrying the
-- assert's second half (the competition belongs to the trip) with it. Nothing
-- else in the body moves. The shared assert is untouched.
--
-- Grants. The function was executable by PUBLIC and anon. It answers about the
-- caller (CLAUDE.md #28), and anon has no auth.uid() so it was always refused,
-- but there is no reason for anon to hold it: tightened to authenticated.

CREATE OR REPLACE FUNCTION public.set_team_captain(p_trip_id text, p_competition_id text, p_team_id text, p_user_id text, p_is_captain boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Owner OR Organizer (migration 200). Its OWN gate rather than the shared
  -- assert_competition_owner, which also guards the competition reset and
  -- delete paths and must stay Owner-only.
  IF auth.uid() IS NULL
     OR NOT public.has_trip_role(p_trip_id, ARRAY['Owner'::text, 'Organizer'::text]) THEN
    RAISE EXCEPTION 'Only an organizer can appoint a team captain'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = p_competition_id AND c.trip_id = p_trip_id
  ) THEN
    RAISE EXCEPTION 'Competition % not found in trip %', p_competition_id, p_trip_id
      USING ERRCODE = 'P0002';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.set_team_captain(text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_team_captain(text, text, text, text, boolean) TO authenticated;
