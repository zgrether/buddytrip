-- 123 — an Organizer may not remove another Organizer
--
-- Extends migration 122's role guard one tier down. 122 protected Owner rows
-- from deletion by a non-Owner; this adds the peer tier.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- `PERMISSIONS.md` line 186 keeps `updateRole` Owner-only on the principle that
-- **only the Owner changes who is trusted**. Removal is a stronger form of the
-- same act, and after #786 widened `tripMembers.remove` to Organizer the two
-- were inconsistent in the worst direction: an Organizer could not DEMOTE a
-- peer, but could DELETE them outright — the same outcome, reached by the
-- door that wasn't watched.
--
-- ── Why at the database, again ─────────────────────────────────────────────
-- Same threat model as 122 and unchanged by it: the anon key ships in the
-- browser, so an Organizer with a real JWT can call PostgREST directly and no
-- tRPC guard is in that path. The application layer supplies the readable
-- message (`tripMembers.remove`); this is what actually enforces it.
--
-- ── Ordering, still load-bearing ───────────────────────────────────────────
-- The role-unchanged early exit and the NULL-uid (service-role) arm are
-- untouched and MUST stay first. See 122 for the full reasoning: the signup
-- path (`handle_new_user` -> `merge_guest_to_real_user`) repoints memberships
-- with `SET user_id`, never `role`, and reaching an auth check before that exit
-- breaks account creation for anyone with a colliding placeholder.
--
-- This migration changes exactly ONE line of the DELETE arm — the role set that
-- passes through freely — and nothing above it.
--
-- ── What still deletes cleanly ─────────────────────────────────────────────
--   • Members and ghosts, by an Organizer — the roster capability #786 grants.
--   • Anyone, by the Owner.
--   • The merge's collision-row DELETE inside signup: it removes a GUEST row,
--     and no guest holds a non-Member role (verified in prod), so it never
--     reaches this branch. Pinned by the regression tests from 122, which are
--     re-run against this change.

CREATE OR REPLACE FUNCTION public.enforce_trip_member_role_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_trip_id text;
  v_has_owner boolean;
BEGIN
  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 1 — THE EARLY EXIT. THIS MUST COME FIRST. DO NOT HOIST THE AUTH
  -- CHECK ABOVE IT. An UPDATE that does not change `role` must return before
  -- any auth.uid() / has_trip_role() evaluation, or `handle_new_user` ->
  -- `merge_guest_to_real_user` (which repoints `user_id`, never `role`) raises
  -- and signup fails for every invited user with a colliding placeholder.
  -- Full reasoning in migration 122.
  -- ════════════════════════════════════════════════════════════════════════
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  v_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);

  -- STEP 1b — trusted infrastructure. No JWT ⇒ not a user acting. Safe, and
  -- not an anon hole: RLS is the outer gate and rejects anon before this runs,
  -- so only the service-role key arrives here. See migration 122.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- STEP 2 — 'Member' grants nothing, so anyone RLS admits may create one.
  IF TG_OP = 'INSERT' AND NEW.role = 'Member' THEN
    RETURN NEW;
  END IF;

  -- STEP 3 — bootstrap: the FIRST Owner of a brand-new trip. `trips.create`
  -- inserts its creator as Owner when no Owner row exists yet, so the auth
  -- check below would refuse every trip creation without this.
  IF TG_OP = 'INSERT' AND NEW.role = 'Owner' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = NEW.trip_id AND role = 'Owner'
    ) INTO v_has_owner;
    IF NOT v_has_owner THEN
      RETURN NEW;
    END IF;
  END IF;

  -- STEP 4 — THE CHANGE IN THIS MIGRATION.
  --
  -- Was: `OLD.role <> 'Owner'` — only Owner rows were protected from deletion.
  -- Now: 'Member' only. Removing an ORGANIZER is removing someone trusted, and
  -- line 186 reserves changing who is trusted to the Owner; without this an
  -- Organizer cannot demote a peer but can delete them, which is the same
  -- outcome through an unwatched door.
  --
  -- Ghost/placeholder crew are 'Member', so removing them is unaffected.
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
  '(#824/#786). Organizers may add/remove MEMBERS only; granting a role, and '
  'removing an Owner or a fellow Organizer, stay Owner-only (mig 123). The '
  'role-unchanged early exit MUST stay first — it is what keeps the trigger '
  'inert during handle_new_user -> merge_guest_to_real_user.';
