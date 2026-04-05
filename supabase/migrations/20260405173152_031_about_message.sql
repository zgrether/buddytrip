-- Rename rsvp_message to about_message
-- The field starts as the RSVP blast content and becomes the living trip info panel.

ALTER TABLE trips
  RENAME COLUMN rsvp_message TO about_message;
