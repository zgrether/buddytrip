-- Add planning_tier column to trips.
-- 'basic' (default) — four-tile planning grid view.
-- 'advanced' — full tab view, currently behind a future paywall seam.
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS planning_tier text
    NOT NULL DEFAULT 'basic'
    CHECK (planning_tier IN ('basic', 'advanced'));
