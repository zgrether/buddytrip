-- Migration 066 — travel_plans_crew_visible flag
--
-- Owners can hide the Travel Plans panel from non-owners once the trip is
-- underway. The itinerary carries the same info, so the panel becomes
-- redundant during the trip itself.
--
-- Defaults to true so all existing trips continue showing the panel to crew.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS travel_plans_crew_visible boolean NOT NULL DEFAULT true;
