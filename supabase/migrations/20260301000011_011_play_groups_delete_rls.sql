-- Migration: 011_play_groups_delete_rls
-- Add missing DELETE policy for play_groups (Owner/Planner via event→trip).
-- Without this policy, Supabase silently ignores deletions (no error, 0 rows
-- affected) because RLS blocks the operation.

CREATE POLICY play_groups_delete ON play_groups FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id
      AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));
