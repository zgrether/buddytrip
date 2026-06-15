-- 054 · Competition co-admin — let co-admins delete teams.
--
-- Co-admin = owner-minus-destructive, where the destructive set is exactly
-- {delete the competition, transfer ownership}. Deleting a TEAM is ordinary
-- team-editing (co-admin work), not competition-destructive. The co_admin tRPC
-- gate now admits trip organizers for teams.delete; widen the RLS to match so
-- the gate isn't blocked at the row layer (the migration-053 lesson — land the
-- rule on the table the action writes).
--
-- teams_delete was Owner-only (migration 001 / 029); widen to Owner+Organizer,
-- mirroring the existing teams_update / teams_insert policies. Idempotent.
DROP POLICY IF EXISTS teams_delete ON public.teams;
CREATE POLICY teams_delete ON public.teams FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = teams.competition_id
        AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
    )
  );
