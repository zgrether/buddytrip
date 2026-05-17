-- 051_quick_info_is_alert.sql
--
-- Adds is_alert column to quick_info_tiles so owners can flag certain tiles
-- as crew alerts (formerly a separate owner_alert field on trips, now folded
-- into the same surface). Alert-flagged tiles render with warning styling
-- and are visually emphasized in the Quick Info panel.

ALTER TABLE quick_info_tiles
  ADD COLUMN is_alert boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_quick_info_tiles_trip_alert
  ON quick_info_tiles (trip_id, is_alert)
  WHERE is_alert = true;
