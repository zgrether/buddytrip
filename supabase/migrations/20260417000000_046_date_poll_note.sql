-- 046: date poll owner note
--
-- Adds a free-text note column to date_polls so the trip owner can provide
-- context to crew members (e.g. "we're leaning toward Option 2 because of
-- cheaper flights, but Option 1 works if people prefer that weekend").
-- The column is nullable; the UI shows default instructional text when null.

ALTER TABLE date_polls
  ADD COLUMN IF NOT EXISTS poll_note text;
