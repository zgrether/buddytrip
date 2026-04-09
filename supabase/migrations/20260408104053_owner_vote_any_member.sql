-- ============================================================
-- 032: Allow trip Owner to vote on behalf of ANY trip member
--
-- Migration 022 only allows Owner/Planner to insert/update votes for
-- ghost (guest) members. This migration adds a separate Owner-only
-- policy that lets the trip owner edit votes for any trip member,
-- regardless of guest status. Planner remains restricted to ghosts.
-- ============================================================

-- Drop in case of repeat application
DROP POLICY IF EXISTS date_poll_votes_insert_owner_any ON date_poll_votes;
DROP POLICY IF EXISTS date_poll_votes_update_owner_any ON date_poll_votes;

-- Owner can INSERT votes on behalf of any trip member
CREATE POLICY date_poll_votes_insert_owner_any ON date_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.date_windows dw
      WHERE dw.id = window_id
        AND has_trip_role(dw.trip_id, ARRAY['Owner'])
    )
    AND EXISTS (
      SELECT 1 FROM public.trip_members tm
      JOIN public.date_windows dw2 ON dw2.id = window_id
      WHERE tm.trip_id = dw2.trip_id
        AND tm.user_id = date_poll_votes.user_id
    )
  );

-- Owner can UPDATE votes on behalf of any trip member
CREATE POLICY date_poll_votes_update_owner_any ON date_poll_votes FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.date_windows dw
      WHERE dw.id = window_id
        AND has_trip_role(dw.trip_id, ARRAY['Owner'])
    )
    AND EXISTS (
      SELECT 1 FROM public.trip_members tm
      JOIN public.date_windows dw2 ON dw2.id = window_id
      WHERE tm.trip_id = dw2.trip_id
        AND tm.user_id = date_poll_votes.user_id
    )
  );
