-- Migration 019 — drop quick_info_enabled
-- The Quick Info panel no longer has an activation gate. Its empty state is
-- now the invitation itself: owners tap "Add quick info" to open the add-tile
-- modal directly, with no intermediate intro modal or enable/disable step.
--
-- That retires the quick_info_enabled flag (added in migration 003) along with
-- the trips.enableQuickInfoTiles / disableQuickInfoTiles mutations, which are
-- deleted in the same change. Idempotent so re-applies are no-ops.

ALTER TABLE trips
  DROP COLUMN IF EXISTS quick_info_enabled;
