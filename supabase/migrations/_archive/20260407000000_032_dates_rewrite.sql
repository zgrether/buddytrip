-- 032: Dates panel rewrite — add date_set_method and date_poll_active columns
-- on the trips table.
--
-- date_set_method tracks which flow produced the locked date so the "Change
-- date →" control in the locked view can return to the appropriate path
-- (simple date entry vs. poll selector).
--
-- date_poll_active is the explicit "poll is open for voting" flag so the crew
-- grid visibility is decoupled from the presence of date_windows rows. This
-- lets owners preserve windows/votes while pausing a poll.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS date_set_method text
  CHECK (date_set_method IN ('direct', 'poll'));

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS date_poll_active boolean NOT NULL DEFAULT false;
