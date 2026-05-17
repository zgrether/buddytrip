-- Add new notification types to notification_events type check constraint.
-- New types: about_update, date_poll_started, stage_advanced, idea_voted, date_poll_voted

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
    'rsvp_response',
    'about_update',
    'date_poll_started',
    'stage_advanced',
    'idea_voted',
    'date_poll_voted'
  ));
