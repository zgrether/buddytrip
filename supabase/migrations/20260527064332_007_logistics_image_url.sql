-- Migration 007 — logistics_items.image_url
-- Adds a photo URL column so we can store the og:image fetched from
-- VRBO / Airbnb / Booking listings (or any manually-pasted image URL)
-- and render it as the LodgingCard's photo strip — replacing the
-- placeholder gradient with the real listing photo when available.
--
-- Server-side fetch + parse lives in /api/lodging-meta. The column
-- is plain text; we don't validate URL shape at the DB layer, the
-- API + form gate that.

ALTER TABLE logistics_items
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN logistics_items.image_url IS
  'Optional listing photo URL (typically og:image from VRBO / Airbnb / hotel listings). Surfaced on LodgingCard as the photo strip; falls back to the placeholder gradient when null.';
