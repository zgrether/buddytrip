-- Migration 061 — lodging check-in / check-out time-of-day
--
-- Optional clock times (stored as HH:MM strings) that pair with the
-- existing check_in_time / check_out_time date columns. Surfaced on
-- the itinerary so crew can see, e.g., "Check in 3:00 PM" instead of
-- just "Check in".

ALTER TABLE logistics_items
  ADD COLUMN IF NOT EXISTS check_in_time_of_day  text,
  ADD COLUMN IF NOT EXISTS check_out_time_of_day text;
