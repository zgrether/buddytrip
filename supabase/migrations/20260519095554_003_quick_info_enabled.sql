-- Migration 003 — quick_info_enabled
-- Adds an activation flag for the Quick Info home-tab panel, mirroring the
-- existing itinerary_enabled and getting_there_enabled columns.
--
-- Default false → owners see the standard dashed InvitationCard ("Enable
-- Quick Info Tiles"). The QuickInfoIntroModal's onActivate now flips this
-- flag, which in turn surfaces the rich skeleton mock-up. Only once the
-- owner taps a mock tile do we open the AddTileModal — so the rich
-- skeleton acts as the post-activation empty state, not the default.
--
-- The pre-existing quick_info_dismissed column is left in place but no
-- longer read by application code (the dismiss-workflow has been retired).

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS quick_info_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN trips.quick_info_enabled IS
  'True once the owner has activated the Quick Info panel via QuickInfoIntroModal. Drives the rich-skeleton vs invitation-card empty state on the home tab.';
