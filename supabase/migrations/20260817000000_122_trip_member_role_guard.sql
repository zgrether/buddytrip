-- 122 — role-column guard on trip_members, then widen roster RLS to Organizer
--
-- ── What this fixes, and what was never true ────────────────────────────────
-- Migration 030 named a role-column trigger as the fix for a limitation it had
-- just run into, and migration 101 restated it ("The fix is a BEFORE INSERT OR
-- UPDATE trigger on trip_members..."). NEITHER BUILT IT. `pg_trigger` returned
-- nothing for this table until this migration. Everything downstream — #786's
-- blocked-procedure table, #824, PERMISSIONS.md — reasoned about the trigger's
-- BEHAVIOUR rather than its EXISTENCE. Recording that here because the cost was
-- real: several rounds of work treated "blocked on the trigger" as a fact.
--
-- ── The actual problem ─────────────────────────────────────────────────────
-- RLS is row-granular, not column-granular. `trip_members` INSERT/UPDATE/DELETE
-- are Owner-only, so the six Organizer roster procedures (#786) cannot be
-- widened: relaxing the policy to `is_trip_planner` would also let an Organizer
-- set `role`. And the anon/authenticated key ships in the browser, so an
-- Organizer can call PostgREST directly — the tRPC guard is not in that path.
-- Defending the column has to happen HERE, not in application code. (This is the
-- opposite conclusion to #957's guard, and deliberately: there the threat was a
-- user taking a legitimate action with an unintended consequence, so intent —
-- which only exists in the app — was the thing to check. Here the threat is a
-- caller who never traverses the app at all.)
--
-- ── ORDERING INSIDE THE FUNCTION IS A CORRECTNESS REQUIREMENT ──────────────
-- See the comment on the early exit below. It is the single most important line
-- in this migration and the one most likely to be "tidied" into a bug.

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
  -- CHECK ABOVE IT.
  --
  -- An UPDATE that does not change `role` is none of this trigger's business,
  -- and must return BEFORE any auth.uid() / has_trip_role() evaluation.
  --
  -- WHY: `merge_guest_to_real_user` repoints memberships with
  --   UPDATE public.trip_members SET user_id = <real> WHERE user_id = <ghost>
  -- and that runs INSIDE the `handle_new_user` signup trigger. During signup the
  -- acting identity is the brand-new user, who is not that trip's Owner — so an
  -- auth check reached before this early exit would RAISE, and account creation
  -- would fail for every invited user with a colliding placeholder.
  --
  -- The repoint changes `user_id`, never `role`, so this exit makes the trigger
  -- inert across the entire signup/merge path. That inertness is a property of
  -- the ORDERING, not of the trigger's existence: move the auth check up and
  -- signup breaks, with no test failing that names signup.
  -- ════════════════════════════════════════════════════════════════════════
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  v_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);

  -- STEP 1b — trusted infrastructure. No JWT ⇒ not a user acting.
  --
  -- The service-role key has no `auth.uid()`, so `has_trip_role` would return
  -- FALSE for it and this guard would refuse legitimate backend and migration
  -- writes. Found by running the tests, not by reading: the suite's own
  -- `addTripMember` helper (service role) was refused when granting 'Organizer'.
  --
  -- Skipping is safe, and specifically NOT a hole for anon: an unauthenticated
  -- PostgREST caller also has a NULL uid, but never reaches this trigger,
  -- because the RLS policies below require `user_id = auth.uid()` (no match for
  -- NULL) or `is_trip_planner()` (false) — RLS is the outer gate. The only
  -- callers that arrive here with a NULL uid are ones that bypassed RLS by
  -- holding the service-role key, which is full-privilege by design; a trigger
  -- cannot meaningfully constrain it, since it can run arbitrary SQL anyway.
  --
  -- No production code currently writes trip_members via the admin client
  -- (verified: `createAdminClient` reaches only auth.admin + push/notify
  -- tables), so this arm is about not breaking the harness and staying robust
  -- if that changes.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- STEP 2 — writes that do not touch the trust boundary.
  -- 'Member' grants nothing, so anyone RLS already admits may create one. This
  -- is what lets an Organizer add crew (tripMembers.add / ghostCrew.create)
  -- once the policies below widen.
  IF TG_OP = 'INSERT' AND NEW.role = 'Member' THEN
    RETURN NEW;
  END IF;

  -- STEP 3 — bootstrap: the FIRST Owner of a brand-new trip.
  -- `trips.create` inserts its creator as Owner immediately after creating the
  -- trip, at which point has_trip_role(trip,'Owner') is FALSE because no row
  -- exists yet. Without this arm the guard would refuse every trip creation —
  -- the INSERT-side twin of the signup trap above, and just as total.
  IF TG_OP = 'INSERT' AND NEW.role = 'Owner' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = NEW.trip_id AND role = 'Owner'
    ) INTO v_has_owner;
    IF NOT v_has_owner THEN
      RETURN NEW;
    END IF;
  END IF;

  -- STEP 4 — everything left touches who is trusted. Owner only.
  --   • granting/changing any role (INSERT of Organizer/Owner, any role UPDATE)
  --   • DELETING an Owner's membership — "only the Owner changes who is
  --     trusted" (PERMISSIONS.md exception 1) has to include removing one.
  --     Without this arm, widening the DELETE policy below would let an
  --     Organizer remove the Owner and strand the trip with none (#957's
  --     orphan state, reached from a layer #957's application guard cannot
  --     see). Scoped to Owner rows ONLY, so the merge's collision-row DELETE —
  --     which removes a GUEST row, and no guest holds a non-Member role — is
  --     untouched.
  IF TG_OP = 'DELETE' AND OLD.role <> 'Owner' THEN
    RETURN OLD;
  END IF;

  IF NOT public.has_trip_role(v_trip_id, ARRAY['Owner'::text]) THEN
    RAISE EXCEPTION 'Only the trip owner can grant, change, or remove a member role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trip_members_role_guard ON public.trip_members;
CREATE TRIGGER trip_members_role_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.trip_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_trip_member_role_write();

-- ── Now the policies can widen ─────────────────────────────────────────────
-- The column is defended, so roster writes may admit Organizers. The self arm
-- (`user_id = auth.uid()`) is preserved exactly as-is: members still write
-- their OWN row (join, travel, status, nickname), and the trigger stops that
-- arm being used to self-elevate.
--
-- What an Organizer can now do DIRECTLY via PostgREST, bypassing tRPC:
--   • INSERT a member row with role='Member'      (refused for Organizer/Owner)
--   • UPDATE any member's non-role columns        (role changes refused)
--   • DELETE any non-Owner member's row           (Owner rows refused)
-- That is the intended Organizer roster capability and nothing wider.

DROP POLICY IF EXISTS trip_members_insert ON public.trip_members;
CREATE POLICY trip_members_insert ON public.trip_members
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = (auth.uid())::text) OR is_trip_planner(trip_id));

DROP POLICY IF EXISTS trip_members_update ON public.trip_members;
CREATE POLICY trip_members_update ON public.trip_members
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = (auth.uid())::text) OR is_trip_planner(trip_id));

DROP POLICY IF EXISTS trip_members_delete ON public.trip_members;
CREATE POLICY trip_members_delete ON public.trip_members
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = (auth.uid())::text) OR is_trip_planner(trip_id));

COMMENT ON FUNCTION public.enforce_trip_member_role_write() IS
  'Guards trip_members.role so RLS can admit Organizers for roster writes '
  '(#824/#786). The role-unchanged early exit MUST stay first — it is what '
  'keeps the trigger inert during handle_new_user -> merge_guest_to_real_user.';
