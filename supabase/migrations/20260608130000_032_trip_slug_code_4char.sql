-- 032 — shorten the trip slug code from 6 hex to 4
--
-- Early-usage tuning: 4 hex = 65,536 codes per identical-title namespace, which
-- is ample until a single title gets very popular (a collision needs two trips
-- with the SAME slugified title AND the same id-hash prefix). Expand back toward
-- 6 if usage ever demands it. Migration 031 backfilled 6-char codes; this
-- re-slugs every existing row to the 4-char form. Mirrors src/lib/slug.ts.
-- Deterministic, so idempotent. (031 is left as-is — already applied.)

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
  ) || '-' || substr(md5(id), 1, 4)
WHERE slug IS NOT NULL;
