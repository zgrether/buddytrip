-- ============================================================
-- 022: Ensure ghost vote RLS policies exist and are correct
--
-- Migration 021 may not have been applied correctly to all environments.
-- This migration drops and recreates the ghost vote INSERT/UPDATE
-- policies idempotently, using fully-qualified table names.
-- ============================================================

-- Drop existing policies in case they exist in a broken state
DROP POLICY IF EXISTS date_poll_votes_insert_ghost ON date_poll_votes;
DROP POLICY IF EXISTS date_poll_votes_update_ghost ON date_poll_votes;

-- Planner/Owner can INSERT votes on behalf of ghost members
CREATE POLICY date_poll_votes_insert_ghost ON date_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.is_guest = true)
    AND EXISTS (
      SELECT 1 FROM public.date_windows dw
      WHERE dw.id = window_id
        AND has_trip_role(dw.trip_id, ARRAY['Owner', 'Planner'])
    )
  );

-- Planner/Owner can UPDATE votes on behalf of ghost members
CREATE POLICY date_poll_votes_update_ghost ON date_poll_votes FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.is_guest = true)
    AND EXISTS (
      SELECT 1 FROM public.date_windows dw
      WHERE dw.id = window_id
        AND has_trip_role(dw.trip_id, ARRAY['Owner', 'Planner'])
    )
  );
