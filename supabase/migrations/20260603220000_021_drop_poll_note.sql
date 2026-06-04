-- ────────────────────────────────────────────────────────────────────────
-- Drop date_polls.poll_note
-- ────────────────────────────────────────────────────────────────────────
-- The Crew Instructions surface that read/wrote this column was removed
-- with the stacked-card poll redesign (PR #286). The intro framing it
-- carried is now part of the FreshTripGuide / DatePollCard headers
-- ("Now let's lock the dates" / "Dates are being picked"), so the per-
-- poll free-text note has no remaining consumer.
--
-- Drops:
--   - column `date_polls.poll_note`
--
-- Idempotent (IF EXISTS) so re-runs are no-ops.

ALTER TABLE date_polls DROP COLUMN IF EXISTS poll_note;
