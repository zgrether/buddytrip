-- Migration: 006_realtime_setup
-- Adds event_id to group_results for Realtime server-side filtering,
-- and enables Supabase Realtime publication on key tables.

-- 1. Add event_id column to group_results (nullable first for backfill, then NOT NULL)
ALTER TABLE group_results
  ADD COLUMN event_id text REFERENCES events (id);

-- Backfill existing rows: derive event_id from round → event
UPDATE group_results gr
SET event_id = r.event_id
FROM rounds r
WHERE gr.round_id = r.id;

-- Now enforce NOT NULL
ALTER TABLE group_results
  ALTER COLUMN event_id SET NOT NULL;

-- Index for Realtime filter: event_id=eq.{eventId}
CREATE INDEX idx_group_results_event_id ON group_results (event_id);

-- 2. Enable Realtime publication on tables used for live subscriptions
-- (messages for chat, group_results for scores, side_events for side event updates,
--  notification_events for notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE group_results;
ALTER PUBLICATION supabase_realtime ADD TABLE side_events;
ALTER PUBLICATION supabase_realtime ADD TABLE notification_events;
