-- 065 — Team identity edit opens to the captain (Rosters PR b2), at the RLS layer.
--
-- teams.update (name/short/color = IDENTITY) is now gated owner-OR-captain in the
-- app layer (requireTeamIdentityEdit). The RLS UPDATE policy must agree, or the
-- captain passes the procedure gate but the write is denied by RLS. Re-point
-- teams_update from has_trip_role(['Owner','Organizer']) to:
--   the trip OWNER, OR the captain of THAT team (team_assignments.is_captain).
--
-- This intentionally DROPS Organizer (co_admin) from team-identity editing, to
-- match the identity tier (owner || captain). Team STRUCTURE (create/delete) RLS
-- is unchanged — its broader Owner/Organizer reconciliation is deferred (the
-- procedures-looser-than-UI debt). Idempotent.

DROP POLICY IF EXISTS teams_update ON public.teams;
CREATE POLICY teams_update ON public.teams
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = teams.competition_id
        AND public.has_trip_role(c.trip_id, ARRAY['Owner'::text])
    )
    OR EXISTS (
      SELECT 1 FROM public.team_assignments ta
      WHERE ta.team_id = teams.id
        AND ta.user_id = (auth.uid())::text
        AND ta.is_captain
    )
  );
