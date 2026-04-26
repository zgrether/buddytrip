-- Migration 059 — panel activation flags
--
-- The going-stage home tab now uses a panel system where the owner
-- activates each feature explicitly (Itinerary, Getting There, Quick Info,
-- Competition). Until activated, each panel renders an invitation card
-- instead of jumping straight to live content.
--
-- Quick Info "activation" is implicit (first tile created) and Competition
-- is implicit (event_id set). Itinerary and Getting There need their own
-- boolean flags because their underlying content (dates, lodging, schedule,
-- travel) can pre-exist independently.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS itinerary_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS getting_there_enabled boolean NOT NULL DEFAULT false;
