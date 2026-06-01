-- Add an optional `icon` column to quick_info_tiles so the new TripHeaderDock
-- modal's icon picker (lock / wifi / door / key / hash / car) can persist the
-- owner's chosen glyph. Null means "fall back to label inference" — the dock
-- and the modal preview both already handle null gracefully.
ALTER TABLE quick_info_tiles
  ADD COLUMN IF NOT EXISTS icon text;
