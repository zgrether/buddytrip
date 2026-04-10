-- Migration 034: Add recipient_id to notification_events
-- Fixes the latent bug where all trip members see all notifications
-- instead of only seeing notifications addressed to them.

ALTER TABLE notification_events
  ADD COLUMN IF NOT EXISTS recipient_id text REFERENCES users(id) ON DELETE CASCADE;

-- Backfill: owner-targeted notification types → trip owner
UPDATE notification_events ne
SET recipient_id = tm.user_id
FROM trip_members tm
WHERE tm.trip_id = ne.trip_id
  AND tm.role = 'Owner'
  AND ne.type IN ('rsvp_response', 'idea_voted', 'date_poll_voted');

-- Backfill: broadcast notification types (destination_locked, dates_locked,
-- date_poll_started, stage_advanced, crew_added, about_update) each have one
-- row per recipient already — but since we can't determine per-row recipient
-- from the data alone, leave them NULL (they will be filtered out until
-- migrated forward by new inserts with recipient_id set).
-- NOTE: any existing rows for broadcast types will become invisible after the
-- RLS tightening below. This is acceptable because the table is pre-launch
-- and only contains test data.

CREATE INDEX IF NOT EXISTS notification_events_recipient_idx
  ON notification_events(recipient_id);

-- Tighten RLS: users can only see notifications addressed to them
DROP POLICY IF EXISTS notification_events_select ON notification_events;
CREATE POLICY notification_events_select ON notification_events FOR SELECT TO authenticated
  USING (recipient_id = auth.uid()::text);
