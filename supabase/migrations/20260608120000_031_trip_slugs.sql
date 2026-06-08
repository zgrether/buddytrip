-- 031 — human-friendly trip URL slugs
--
-- Adds trips.slug ('slugify(title)-<code>', e.g. 'bbmi-2027-a3f9c1'). The title
-- alone can't be globally unique (two crews can plan a "Cancun" trip), so every
-- slug carries a 6-hex code derived from the id → unique by construction. The
-- UUID stays the canonical id + a permanent URL fallback; slug is a display
-- layer. Algorithm mirrors src/lib/slug.ts. Idempotent.

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS slug text;

-- Backfill existing trips. slugify: lower → non-alphanumerics to '-' → cap 40 →
-- trim '-' → fall back to 'trip' if empty; then '-' || first 6 hex of md5(id).
UPDATE public.trips
SET slug = coalesce(
    nullif(
      regexp_replace(
        left(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), 40),
        '(^-+|-+$)', '', 'g'
      ),
      ''
    ),
    'trip'
  ) || '-' || substr(md5(id), 1, 6)
WHERE slug IS NULL;

-- Unique by construction (title + id-derived code); the index is the backstop.
-- (NULLs are distinct in a unique index, so leaving slug nullable is fine.)
CREATE UNIQUE INDEX IF NOT EXISTS trips_slug_key ON public.trips (slug);

-- Intentionally NOT NULL-constrained: keeping slug nullable means this migration
-- can apply to the shared DB before the app code that sets slug ships, without
-- breaking trip creation in the meantime (old create() omits slug → NULL).
-- All readers fall back to the UUID when slug is absent (`slug ?? id`). A later
-- migration can SET NOT NULL once every trip is guaranteed to have one.
