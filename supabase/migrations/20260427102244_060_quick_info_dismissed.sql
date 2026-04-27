-- Migration 060 — Quick Info dismissal flag
--
-- Lets the owner X-out the Quick Info empty state on the home tab. When
-- true the panel renders nothing — same shape as itinerary_enabled and
-- getting_there_enabled but inverted (those flags need to be true to show
-- live content; this flag needs to be false to show the invitation).

ALTER TABLE trips ADD COLUMN IF NOT EXISTS quick_info_dismissed boolean NOT NULL DEFAULT false;
