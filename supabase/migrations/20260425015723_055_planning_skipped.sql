-- Migration 055: Planning tile skip state
--
-- The planning stage Home tab shows a 2×2 grid (Dates / Crew / Lodging /
-- Schedule). Each tile can be "complete" (data present), "empty", or
-- "skipped" — the owner explicitly dismissing that area (flexible dates,
-- solo trip, camping, unplanned).
--
-- Skipped tiles count as "resolved" for the purposes of gating the
-- "View Itinerary" advance button, so the owner isn't blocked on e.g.
-- schedule items for a spontaneous weekend.
--
-- Travel columns on trip_members already exist (migration 038); no
-- schema work is needed there.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS planning_skipped jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Sanity-check: only four tile keys are ever stored. We don't enforce
-- this in the database (values are small and server-side-validated), but
-- the application code should only ever write:
--   'dates' | 'crew' | 'lodging' | 'schedule'
