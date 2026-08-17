-- 124 — HOTFIX: migration 123 broke deleting a trip that has an Organizer on it
--
-- ── The regression ─────────────────────────────────────────────────────────
-- Deleting a trip cascades one DELETE per `trip_members` row. Migration 123
-- narrowed the DELETE free-pass to `role = 'Member'`, so an ORGANIZER row now
-- reaches the Owner check — and within that same cascading statement the
-- OWNER's membership row may already be gone, so `has_trip_role(...,'Owner')`
-- returns FALSE and the whole delete raises:
--
--   Only the trip owner can grant, change, or remove a member role
--
-- Reproduced directly: an Owner deleting a trip with one Organizer on it fails,
-- the trip row survives, and both membership rows remain. 122 never hit this
-- because Organizer rows passed through its DELETE arm untouched; 123 is what
-- put them in front of the check.
--
-- ── Why the existing tests missed it ───────────────────────────────────────
-- `trips.test.ts`'s delete case builds a trip whose only member is the Owner,
-- and 123's own tests delete MEMBERSHIPS rather than a TRIP. The cascade is a
-- writer neither enumerated. Pinned now in `tripMembers.removeScoping.test.ts`.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- If the parent trip is already gone, this DELETE is a cascade rather than
-- someone removing a person, and the roster rules do not apply — there is no
-- roster left to protect. Postgres deletes the parent row before running the
-- FK cascade, so "the trip row is missing" is a reliable tell, and it cannot be
-- forged by a direct caller: a user deleting a membership on a LIVE trip still
-- sees the trip row, so every rule below still applies to them.
--
-- Ordering above is untouched and still load-bearing (see 122): the
-- role-unchanged early exit and the NULL-uid arm stay first, which is what
-- keeps the trigger inert during handle_new_user -> merge_guest_to_real_user.

CREATE OR REPLACE FUNCTION public.enforce_trip_member_role_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_trip_id text;
  v_has_owner boolean;
BEGIN
  -- STEP 1 — THE EARLY EXIT. MUST COME FIRST. Do not hoist the auth check
  -- above it: `merge_guest_to_real_user` repoints memberships (SET user_id,
  -- never role) inside the `handle_new_user` signup trigger, where the acting
  -- identity is the new user. Full reasoning in migration 122.
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  v_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);

  -- STEP 1b — trusted infrastructure. No JWT ⇒ not a user acting. RLS is the
  -- outer gate and rejects anon before this runs. See migration 122.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- STEP 1c — CASCADE FROM A TRIP DELETE (migration 124, the fix).
  -- The parent row is deleted before the FK cascade runs, so a missing trip
  -- means "this whole trip is going away", not "someone is removing a person".
  -- Roster rules have nothing to protect at that point. A caller acting on a
  -- LIVE trip still sees the trip row and is still held to every rule below.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.trips WHERE id = v_trip_id) THEN
    RETURN OLD;
  END IF;

  -- STEP 2 — 'Member' grants nothing, so anyone RLS admits may create one.
  IF TG_OP = 'INSERT' AND NEW.role = 'Member' THEN
    RETURN NEW;
  END IF;

  -- STEP 3 — bootstrap: the FIRST Owner of a brand-new trip (`trips.create`
  -- inserts its creator as Owner when no Owner row exists yet).
  IF TG_OP = 'INSERT' AND NEW.role = 'Owner' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = NEW.trip_id AND role = 'Owner'
    ) INTO v_has_owner;
    IF NOT v_has_owner THEN
      RETURN NEW;
    END IF;
  END IF;

  -- STEP 4 — Members (and ghosts, which are Members) may be removed by any
  -- Organizer. Removing an Owner or a fellow Organizer may not (mig 122/123).
  IF TG_OP = 'DELETE' AND OLD.role = 'Member' THEN
    RETURN OLD;
  END IF;

  -- STEP 5 — everything left touches who is trusted. Owner only.
  IF NOT public.has_trip_role(v_trip_id, ARRAY['Owner'::text]) THEN
    RAISE EXCEPTION 'Only the trip owner can grant, change, or remove a member role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_trip_member_role_write() IS
  'Guards trip_members.role so RLS can admit Organizers for roster writes '
  '(#824/#786). Organizers add/remove MEMBERS only; granting a role, and '
  'removing an Owner or fellow Organizer, stay Owner-only (mig 123). A DELETE '
  'whose parent trip is already gone is a cascade and passes (mig 124). The '
  'role-unchanged early exit MUST stay first — it keeps the trigger inert '
  'during handle_new_user -> merge_guest_to_real_user.';
