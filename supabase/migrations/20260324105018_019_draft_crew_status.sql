-- ============================================================
-- 019: Add draft status to trip_members
--
-- Draft is the staging area for roster building before deciding
-- whether to send an invite or create a ghost crew member.
-- ============================================================

ALTER TABLE trip_members DROP CONSTRAINT IF EXISTS trip_members_status_check;
ALTER TABLE trip_members ADD CONSTRAINT trip_members_status_check
  CHECK (status IN ('draft', 'in', 'likely', 'maybe', 'out', 'invited'));

-- Safety backfill: any null statuses become draft
UPDATE trip_members SET status = 'draft' WHERE status IS NULL;
