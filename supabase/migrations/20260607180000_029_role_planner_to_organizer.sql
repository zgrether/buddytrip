-- 029 — rename the "Planner" trip role to "Organizer"
--
-- The middle trip role was coded + stored as 'Planner' but presented to users
-- as "Organizer." This renames the stored VALUE app-wide so code and DB agree.
--
-- IMPORTANT: "planning" is left ALONE — it's a trip state and the
-- planning/organizers chat visibility (`messages.visibility = 'planning'`,
-- `planning_visible_from`), not the role. Only the role VALUE 'Planner'
-- changes to 'Organizer'.
--
-- Touches: trip_members.role + invites.role (data + CHECK constraint), the
-- is_trip_planner() helper body, and every RLS policy that hard-codes the
-- 'Planner' role name (30 policies across 15 tables) — rewritten
-- programmatically so none are missed. has_trip_role(trip_id, roles[]) is
-- generic (roles passed as an arg) and needs no change. Idempotent.

-- 1. is_trip_planner() — body hard-codes the role set; swap Planner → Organizer.
--    The function NAME is kept (internal helper, ~6 policies call it; renaming
--    would churn them for no behavioral gain).
CREATE OR REPLACE FUNCTION public.is_trip_planner(p_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id AND user_id = auth.uid()::text
    AND role IN ('Owner', 'Organizer')
  );
$function$;

-- 2. trip_members.role — relax CHECK, migrate any rows, re-add CHECK.
ALTER TABLE public.trip_members DROP CONSTRAINT IF EXISTS trip_members_role_check;
UPDATE public.trip_members SET role = 'Organizer' WHERE role = 'Planner';
ALTER TABLE public.trip_members
  ADD CONSTRAINT trip_members_role_check CHECK (role IN ('Owner', 'Organizer', 'Member'));

-- 3. invites.role — same (default stays 'Member').
ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_role_check;
UPDATE public.invites SET role = 'Organizer' WHERE role = 'Planner';
ALTER TABLE public.invites
  ADD CONSTRAINT invites_role_check CHECK (role IN ('Organizer', 'Member'));

-- 4. RLS policies — rebuild every policy whose USING / WITH CHECK text
--    references the 'Planner' role name, with 'Organizer'. Programmatic so all
--    30 (across 15 tables) are covered regardless of which migration created
--    them. Reconstructs each from pg_policies (cmd / roles / qual / with_check).
DO $rename$
DECLARE
  p RECORD;
  stmt text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') LIKE '%Planner%' OR coalesce(with_check, '') LIKE '%Planner%')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    stmt := format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
      p.policyname, p.tablename,
      p.permissive,                     -- 'PERMISSIVE' | 'RESTRICTIVE'
      p.cmd,                            -- SELECT | INSERT | UPDATE | DELETE | ALL
      array_to_string(p.roles, ', ')    -- e.g. authenticated
    );
    IF p.qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', replace(p.qual, 'Planner', 'Organizer'));
    END IF;
    IF p.with_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', replace(p.with_check, 'Planner', 'Organizer'));
    END IF;
    EXECUTE stmt;
  END LOOP;
END
$rename$;
