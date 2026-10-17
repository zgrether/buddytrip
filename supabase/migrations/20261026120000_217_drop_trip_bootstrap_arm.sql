-- Migration 217 — nobody adds themselves to a trip; trips are made by create_trip (#991)
--
-- PUSH THIS ONLY AFTER the code that calls `create_trip` (this migration's PR)
-- is DEPLOYED. Until then the deployed `trips.create` still inserts the trip
-- and its Owner itself and needs both arms removed here; pushing early fails
-- every trip creation (CLAUDE.md, Migration Workflow step 3b).
--
-- ── What this reverses ────────────────────────────────────────────────────
--
-- Migration 128 narrowed `trip_members_insert`'s self arm to a bootstrap:
--
--   "A caller may add THEMSELVES only as the first Owner of a trip that has
--    no roster yet — the bootstrap trips.create performs."
--
-- and accepted the residual knowingly: any signed-in caller could claim a
-- trip with no members as its Owner. It judged that a passing window, because
-- "`trips.create` deletes the trip if the second one fails". That delete ran
-- as the caller and `trips_delete` needs the Owner role, so it never removed
-- anything; the window could become permanent.
--
-- 128 was right that the bootstrap had exactly one legitimate caller. Since
-- migration 216 that caller makes the trip and its Owner in one transaction,
-- inside a SECURITY DEFINER function that RLS does not gate. So the arm serves
-- nobody, and it goes rather than being narrowed further.
--
-- ── What changes ──────────────────────────────────────────────────────────
--
--  1. `trip_members_insert`: Owners and Organizers add people. Nothing else.
--  2. `trips_insert` (`WITH CHECK (true)`) is dropped. A trip made directly
--     through PostgREST, outside `create_trip`, is a trip with no Owner, and
--     nothing in the app makes one that way any more. Tests and seeds insert
--     trips with the service role, which RLS does not apply to.
--  3. `trip_has_any_member` is dropped. Its only reader was the arm in (1);
--     checked in local and production (functions, policies and views) on
--     2026-10-16 before writing this.

DROP POLICY IF EXISTS trip_members_insert ON public.trip_members;
CREATE POLICY trip_members_insert ON public.trip_members
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_trip_planner(trip_id));

COMMENT ON POLICY trip_members_insert ON public.trip_members IS
  'An Owner or Organizer may add anyone. Nobody adds themselves: a trip''s first Owner is written by create_trip, in the same transaction as the trip (migrations 216 and 217, removing the bootstrap arm migration 128 kept).';

DROP POLICY IF EXISTS trips_insert ON public.trips;

DROP FUNCTION IF EXISTS public.trip_has_any_member(text);
