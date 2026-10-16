-- Migration 216 — a trip and its Owner are created in ONE transaction (#991)
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
-- `trips.create` made a trip in two statements through the caller's own
-- client: insert the `trips` row, then insert the caller's Owner row. Between
-- them the trip had no members, and migration 128 left `trip_members_insert`
-- admitting "yourself, as Owner, on a trip with no members" because that is
-- the only way the second statement can pass RLS. 128 said so and accepted it:
--
--   "A trip with ZERO members could still be claimed as Owner by any
--    authenticated caller. That window is the gap between `trips.create`'s two
--    inserts, and `trips.create` deletes the trip if the second one fails."
--
-- The second sentence is not true. The clean-up delete runs through the same
-- caller's client, and `trips_delete` is `has_trip_role(id, 'Owner')` — false
-- for a trip with no members. So the delete removes nothing and reports no
-- error, and a failed create leaves a trip with no members behind for good,
-- claimable by whoever names its id. Not only a window, then: a lasting state,
-- reached through the failure path of the very procedure meant to prevent it.
--
-- #991 proposed a `trips.created_by` column for the policy to compare against.
-- This does something smaller and closes more: when creation is one
-- transaction, the empty state is never visible to anyone else and never
-- survives a failure, so there is nothing left for the self-insert arm to
-- serve. No backfill, and no "creator or current owner" choice to make.
--
-- ── This migration ADDS; the arm is removed in a later one ────────────────
--
-- The code that calls this function must be deployed before the arm it
-- replaces can go: drop the arm first and every trip creation fails until the
-- new code lands (CLAUDE.md, Migration Workflow step 3b). So this migration
-- only adds `create_trip`. The follow-up drops the bootstrap arm of
-- `trip_members_insert` and the user-scoped `trips_insert`, once nothing
-- inserts a trip except this function.

CREATE OR REPLACE FUNCTION public.create_trip(
  p_id text,
  p_title text,
  p_description text,
  p_location text,
  p_start_date date,
  p_end_date date,
  p_comparison_mode boolean,
  p_locked_destination_title text,
  p_locked_destination_location text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid text := (auth.uid())::text;
  v_locked boolean := p_locked_destination_title IS NOT NULL
                      AND p_locked_destination_location IS NOT NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CREATE_TRIP_NOT_SIGNED_IN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.trips (
    id, title, description, location, start_date, end_date, comparison_mode,
    locked_destination_title, locked_destination_location, locked_destination_at
  ) VALUES (
    p_id,
    p_title,
    COALESCE(p_description, ''),
    p_location,
    p_start_date,
    p_end_date,
    COALESCE(p_comparison_mode, false),
    CASE WHEN v_locked THEN p_locked_destination_title END,
    CASE WHEN v_locked THEN p_locked_destination_location END,
    -- A locked destination is what moves a trip out of the idea phase.
    CASE WHEN v_locked THEN now() END
  );

  -- The caller, and only the caller, as Owner. Any failure here rolls the
  -- trip back with it: there is no state in which the trip exists unowned.
  INSERT INTO public.trip_members (trip_id, user_id, role)
  VALUES (p_id, v_uid, 'Owner');
END;
$function$;

COMMENT ON FUNCTION public.create_trip(text, text, text, text, date, date, boolean, text, text) IS
  'Creates a trip and makes the caller its Owner in one transaction, so a trip never exists without an Owner, even when the second insert fails (#991, migration 216).';

-- Identity comes from auth.uid(), so anon could only ever be refused; it is
-- not granted at all, which keeps it off the anon-callable surface.
REVOKE ALL ON FUNCTION public.create_trip(text, text, text, text, date, date, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip(text, text, text, text, date, date, boolean, text, text) TO authenticated, service_role;
