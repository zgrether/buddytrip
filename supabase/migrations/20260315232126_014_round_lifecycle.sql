-- ============================================================
-- 014: Round lifecycle — activate_round RPC
--
-- Adds an atomic activate_round function that:
--   1. Moves any currently active round for the event → submitted
--   2. Sets the target round → active
--
-- The rounds table already has all 4 statuses (upcoming | active |
-- submitted | closed) and closed_at / closed_by columns from the
-- initial schema. This migration only adds the RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION activate_round(p_round_id text, p_event_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Move any active round for this event to submitted
  UPDATE rounds
     SET status = 'submitted'
   WHERE event_id = p_event_id
     AND status   = 'active';

  -- Activate the target round
  UPDATE rounds
     SET status = 'active'
   WHERE id = p_round_id;
END;
$$;
