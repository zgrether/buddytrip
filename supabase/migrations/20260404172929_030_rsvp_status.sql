-- ============================================================
-- 030: RSVP status tracking
--
-- Adds rsvp_status column to trip_members for explicit RSVP
-- tracking. Separate from the existing status column which
-- tracks invite flow state (draft, invited, in, etc.).
--
-- Also adds 'rsvp_response' to notification_events type check.
-- ============================================================

-- ── 1. Add rsvp_status column ───────────────────────────────────────────

ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS rsvp_status text
  CHECK (rsvp_status IN ('in', 'maybe', 'out'));

-- null = no response yet

-- ── 2. Backfill existing 'in' status members ────────────────────────────
-- Members who already have status = 'in' are considered confirmed

UPDATE trip_members
  SET rsvp_status = 'in'
  WHERE status = 'in';

-- ── 3. Add 'rsvp_response' to notification_events type check ────────────

ALTER TABLE notification_events
  DROP CONSTRAINT IF EXISTS notification_events_type_check;

ALTER TABLE notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (type IN (
    'destination_locked',
    'dates_locked',
    'crew_added',
    'chat_message',
    'score_submitted',
    'rsvp_response'
  ));

-- ── 4. RLS: extend trip_members UPDATE to include Planner ───────────────
-- Original policy (migration 003) only allowed self-update or Owner.
-- Planners also need to update rsvp_status for ghost members they manage.

DROP POLICY IF EXISTS trip_members_update ON trip_members;

CREATE POLICY trip_members_update ON trip_members FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()::text
    OR has_trip_role(trip_id, ARRAY['Owner', 'Planner'])
  );
