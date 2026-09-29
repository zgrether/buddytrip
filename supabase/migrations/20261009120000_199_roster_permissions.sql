-- 199 — Roster permissions (PR 8's permissions pass, ruled 2026-09-28)
--
-- ── 1 · Organizers rename and reorder teams ─────────────────────────────────
-- Team create / delete are Organizer-level (server `co_admin` = trip Organizer,
-- RLS Owner/Organizer). Rename and reorder were Owner-or-captain only, so an
-- Organizer could DELETE a team but not RENAME it. Ruled: whoever can delete a
-- team can rename it. `update_team_identity` (138) and `reorder_team_roster`
-- (139) are redefined from their current bodies with only the auth line and its
-- sentence changed.
--
-- ── 2 · Captains: add unassigned players, remove their own — until the lock ──
-- Ruled: before the race has results, a captain may add UNASSIGNED players to
-- their own team and remove their own team's players; after results, nothing.
-- "Results" is the EXISTING roster lock (`game_started` across the competition's
-- games), so a captain's rights end at the same moment the roster freezes — one
-- moment, not two (Zach). The lock's known gaps are tracked, not re-decided
-- here: manual placements (#1525) and the bracket (#1413) are not yet in
-- `game_started`.
--
-- Pulling someone off ANOTHER team is a TRADE: it touches two teams, it is
-- Organizer-level, and the captain path refuses it.
--
-- Captains are not Organizers, so the table's RLS (Owner/Organizer) refuses
-- their direct writes. Both paths are therefore SECURITY DEFINER functions that
-- check everything themselves — the pattern `reorder_team_roster` set for the
-- captain's reorder. Each answers about the CALLER (`auth.uid()` must captain
-- this team), so exposing them to `authenticated` leaks nothing (CLAUDE.md #28).
--
-- ── 3 · Delegation grants no roster rights ──────────────────────────────────
-- Stated, not changed: a game's delegate is not a captain and not an
-- Organizer, so neither path admits them. Pinned by a test.

CREATE OR REPLACE FUNCTION public.update_team_identity(
  p_team_id    text,
  p_name       text DEFAULT NULL,
  p_short_name text DEFAULT NULL,
  p_color      text DEFAULT NULL,
  p_color_dim  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_trip_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.trip_id INTO v_trip_id
    FROM public.teams t
    JOIN public.competitions c ON c.id = t.competition_id
   WHERE t.id = p_team_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Team not found' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Migration 199: Organizer too. Whoever can delete a team can rename it (and
  -- reorder it); an Organizer could delete but not rename (PR 8 permissions pass).
  IF NOT (public.has_trip_role(v_trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_team_captain(p_team_id)) THEN
    RAISE EXCEPTION 'Only an organizer or this team''s captain can edit its identity'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- NULL means "leave alone", matching the optional fields on teams.update.
  -- competition_id is absent from this statement by construction: a captain
  -- cannot move their team to another cup through here, which is F9.
  UPDATE public.teams
     SET name       = COALESCE(p_name,       name),
         short_name = COALESCE(p_short_name, short_name),
         color      = COALESCE(p_color,      color),
         color_dim  = COALESCE(p_color_dim,  color_dim)
   WHERE id = p_team_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_team_roster(
  p_competition_id text,
  p_team_id        text,
  p_ordered_user_ids text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_trip_id text;
  v_current text[];
  v_given   text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.trip_id INTO v_trip_id
    FROM public.competitions c
    JOIN public.teams t ON t.competition_id = c.id
   WHERE c.id = p_competition_id AND t.id = p_team_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Team not found in that competition'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Migration 199: Organizer too. Whoever can delete a team can rename it (and
  -- reorder it); an Organizer could delete but not rename (PR 8 permissions pass).
  IF NOT (public.has_trip_role(v_trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_team_captain(p_team_id)) THEN
    RAISE EXCEPTION 'Only an organizer or this team''s captain can reorder it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT array_agg(ta.user_id ORDER BY ta.user_id) INTO v_current
    FROM public.team_assignments ta
   WHERE ta.competition_id = p_competition_id AND ta.team_id = p_team_id;

  SELECT array_agg(u ORDER BY u) INTO v_given
    FROM unnest(p_ordered_user_ids) AS u;

  IF coalesce(v_current, ARRAY[]::text[]) IS DISTINCT FROM coalesce(v_given, ARRAY[]::text[]) THEN
    RAISE EXCEPTION 'Order must be exactly this team''s current roster'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_ordered_user_ids IS NULL OR cardinality(p_ordered_user_ids) = 0 THEN
    RETURN;
  END IF;

  -- `ord - 1`: 0-based, matching the array index the replaced code wrote.
  UPDATE public.team_assignments ta
     SET sort_order = x.ord - 1
    FROM (
      SELECT u AS uid, ord
        FROM unnest(p_ordered_user_ids) WITH ORDINALITY AS t(u, ord)
    ) x
   WHERE ta.competition_id = p_competition_id
     AND ta.team_id        = p_team_id
     AND ta.user_id        = x.uid;
END;
$function$;

-- Is this competition's roster locked? The same predicate as `rosterLock.ts`'s
-- `competitionHasScore` (any game of the competition in `game_started`).
-- Answers about a competition, not the caller, so it is NOT exposed: only the
-- two captain functions below call it.
CREATE OR REPLACE FUNCTION public._competition_roster_locked(p_competition_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.game_started s
    JOIN public.games g ON g.id = s.game_id
    WHERE g.competition_id = p_competition_id
  )
$$;

REVOKE ALL ON FUNCTION public._competition_roster_locked(text) FROM PUBLIC, anon, authenticated;

-- A captain adds an UNASSIGNED trip member to their own team.
CREATE OR REPLACE FUNCTION public.captain_add_player(
  p_competition_id text,
  p_team_id        text,
  p_user_id        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
    RAISE EXCEPTION 'Results are in, so only an organizer can change rosters now.'
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
$$;

-- A captain removes one of THEIR OWN team's players.
CREATE OR REPLACE FUNCTION public.captain_remove_player(
  p_competition_id text,
  p_team_id        text,
  p_user_id        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
    RAISE EXCEPTION 'Results are in, so only an organizer can change rosters now.'
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
$$;

REVOKE ALL ON FUNCTION public.captain_add_player(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.captain_remove_player(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captain_add_player(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.captain_remove_player(text, text, text) TO authenticated;
