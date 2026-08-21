-- 139 — `reorder_team_roster` numbers from 0, like the code it replaces.
--
-- Migration 138's version used `WITH ORDINALITY`, which is 1-based. The
-- fan-out it is replacing wrote the array index:
--
--     input.orderedUserIds.map((userId, i) => ... { sort_order: i } ...)
--
-- so a roster that has always been 0,1,2 would have started coming back 1,2,3.
--
-- Nothing about the RENDERED order changes either way — `sort_order` is only a
-- key to sort by, and existing rows would have been renumbered consistently
-- within their own team on the next reorder. But the RPC is meant to be a
-- like-for-like move of an existing capability into a definer, and quietly
-- changing the values it writes is not like-for-like. Mixed 0-based and
-- 1-based rosters across teams is also the sort of thing that reads as
-- meaningful to whoever finds it next.
--
-- Caught by `teamAssignments.test.ts` ("reorder persists a new canonical
-- order"), which asserts the exact values — the assertion earned its keep.
--
-- Corrected here rather than by editing 138, which is already applied to prod
-- (CLAUDE.md Migration Workflow step 4: never edit an applied migration, write
-- a new one). Safe to replace outright: nothing calls this yet. The code that
-- does is the PR after this one, which is why this lands first.

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

  IF NOT (public.has_trip_role(v_trip_id, ARRAY['Owner'::text])
          OR public.is_team_captain(p_team_id)) THEN
    RAISE EXCEPTION 'Only the owner or this team''s captain can reorder it'
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

COMMENT ON FUNCTION public.reorder_team_roster(text, text, text[]) IS
  'Reorder a team''s roster, numbering sort_order from 0 as the code it replaces did (migration 139 corrects 138''s 1-based WITH ORDINALITY). The ONLY roster write a captain gets once the captain arm is removed from team_assignments_update. Re-checks authorization itself because SECURITY DEFINER bypasses RLS, validates the input is a permutation of the current roster, and writes sort_order alone — it contains no statement that can change user_id, team_id or is_captain. A trigger was rejected for this: merge_guest_to_real_user repoints team_assignments.user_id inside the signup trigger, and triggers fire even for SECURITY DEFINER.';
