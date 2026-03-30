-- Add missing DELETE RLS policy for date_windows.
-- Owner or Planner can remove a date window from their trip.
CREATE POLICY date_windows_delete ON date_windows FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));
