-- Migration 201 — drop competitions.roster_setup (#1530 step 2), and the two
-- refusal-text fixes that were deliberately held for "the next migration going
-- out" (TRACKER.md; Zach: no migration of its own for copy almost nobody can
-- reach, but always fix it when a migration is going out anyway).
--
-- 1 · DROP roster_setup. Added by migration 058 for the board's roster-build
--     signposts; #445 removed the last signpost that read it, and its only
--     remaining reader was the Rosters overlay's "Save rosters" button deciding
--     whether to show itself. #1529 replaced that with "Done" and stopped the
--     code writing it (#1530 step 1), and that code is deployed before this runs
--     — CLAUDE.md 3b: a removal lands the code first, then the drop.
--     Schema Cleanup Rule: the only dependent object, locally and in production,
--     is the column's own CHECK (competitions_roster_setup_chk), which goes with
--     the column. No function, view, policy, trigger or index names it.
--     Not a person reference, so merge_guest_to_real_user is unaffected.
--
-- 2 · captain_add_player / captain_remove_player (migration 199): "only AN
--     organizer" -> "only organizers". The Owner can change rosters too; the
--     client note already says "organizers" (#1529).
--
-- 3 · assert_competition_owner: its refusal said "reset" while also guarding
--     competition DELETE (and, until migration 200, captain appointment). A
--     shared check's message names no single caller.
--
-- Each function below is regenerated from its current body with ONLY that string
-- changed; nothing else in any body moves.

ALTER TABLE public.competitions DROP COLUMN IF EXISTS roster_setup;

CREATE OR REPLACE FUNCTION public.captain_add_player(p_competition_id text, p_team_id text, p_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_trip_id  text;
  v_existing text;
  v_next     integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.trip_id INTO v_trip_id
    FROM public.competitions c
    JOIN public.teams t ON t.competition_id = c.id
   WHERE c.id = p_competition_id AND t.id = p_team_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Team not found in that competition' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT public.is_team_captain(p_team_id) THEN
    RAISE EXCEPTION 'Only this team''s captain or an organizer can add players to it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public._competition_roster_locked(p_competition_id) THEN
    RAISE EXCEPTION 'Results are in, so only organizers can change rosters now.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members tm WHERE tm.trip_id = v_trip_id AND tm.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'That person isn''t on this trip' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ta.team_id INTO v_existing
    FROM public.team_assignments ta
   WHERE ta.competition_id = p_competition_id AND ta.user_id = p_user_id;
  IF v_existing = p_team_id THEN
    RETURN; -- already on this team: nothing to do
  END IF;
  IF v_existing IS NOT NULL THEN
    -- A TRADE: it touches another team. Organizer-level (ruled).
    RAISE EXCEPTION 'That player is on another team. Moving them is a trade, so ask an organizer.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The same two fields the Organizer path writes beyond the team: the end of
  -- this team's order, and when the new teammate became visible.
  SELECT coalesce(max(ta.sort_order), -1) + 1 INTO v_next
    FROM public.team_assignments ta
   WHERE ta.competition_id = p_competition_id AND ta.team_id = p_team_id;

  INSERT INTO public.team_assignments (competition_id, user_id, team_id, sort_order, team_visible_from)
  VALUES (p_competition_id, p_user_id, p_team_id, v_next, now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.captain_remove_player(p_competition_id text, p_team_id text, p_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_trip_id text;
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.trip_id INTO v_trip_id
    FROM public.competitions c
    JOIN public.teams t ON t.competition_id = c.id
   WHERE c.id = p_competition_id AND t.id = p_team_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Team not found in that competition' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT public.is_team_captain(p_team_id) THEN
    RAISE EXCEPTION 'Only this team''s captain or an organizer can remove players from it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public._competition_roster_locked(p_competition_id) THEN
    RAISE EXCEPTION 'Results are in, so only organizers can change rosters now.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_user_id = auth.uid()::text THEN
    -- Removing yourself would leave the team with no captain; that is an
    -- organizer's call, not the captain's.
    RAISE EXCEPTION 'You''re this team''s captain. Ask an organizer to take you off it.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Scoped to THIS team: a player on another team is not the captain's to remove.
  DELETE FROM public.team_assignments ta
   WHERE ta.competition_id = p_competition_id AND ta.team_id = p_team_id AND ta.user_id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'That player isn''t on your team' USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_competition_owner(p_trip_id text, p_competition_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members tm
    WHERE tm.trip_id = p_trip_id
      AND tm.user_id = (auth.uid())::text
      AND tm.role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'Only the trip owner can do this.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = p_competition_id AND c.trip_id = p_trip_id
  ) THEN
    RAISE EXCEPTION 'Competition % not found in trip %', p_competition_id, p_trip_id USING ERRCODE = 'P0002';
  END IF;
END;
$function$;
