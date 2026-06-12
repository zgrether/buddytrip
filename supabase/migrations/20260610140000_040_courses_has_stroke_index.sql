-- 040 — courses.has_stroke_index (Slice C addendum C-1)
--
-- Stroke index is now optional at course creation ("Add stroke indices" toggle).
-- When off, the course carries no real index: handicap_index is stored as an
-- empty array, net play is unavailable, and a game it's applied to falls back to
-- the sequential allocation. Defaults true so existing rows keep their index.
-- Idempotent.

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS has_stroke_index boolean NOT NULL DEFAULT true;
