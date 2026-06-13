-- 049 — games.points_total (Slice D add-game flow, Stage 3)
--
-- The owner-set TOTAL points a game is worth, set on the Game tab. This is the
-- delegation boundary made structural: the OWNER writes `points_total`
-- (owner-only mutation); a DELEGATE distributes WITHIN it on the Configuration
-- tab by writing `points_distribution` (the per-place split, which must sum to
-- this total once distribution begins). Keeping the total in its own column
-- (rather than reshaping the tagged `points_distribution` union again) gives a
-- clean column-level permission split AND lets the total persist while the
-- distribution is still empty — so an unconfigured game's owner-set total still
-- counts toward the leaderboard's available points / clinch number (Stage 4),
-- keeping the magic number stable across the week.
--
-- Model-aware:
--   PLACEMENT games (golf placement, manual/generic) → points_total is the pool
--     the `points_distribution.values` must sum to.
--   MATCH games (singles/doubles) → points_total stays NULL; the total is
--     DERIVED = per-match value × matchCount (matchCount from team sizes), so it
--     must NOT be stored (it moves only with team sizes, never configuration).
--
-- numeric (not integer): averaged-tie placement points and per-match halves come
-- in 0.5 steps, and a total may be set in halves. Idempotent.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS points_total numeric;

COMMENT ON COLUMN public.games.points_total IS
  'Owner-set total points for a placement game (the pool the points_distribution '
  'split must sum to). NULL for match games, whose total is derived = per-match '
  'value × matchCount. Owner-only; delegates distribute within it.';

-- Backfill existing PLACEMENT games: total = sum of their current place values,
-- so the leaderboard available-points is unchanged for pre-Slice-D data. Only
-- the 2026-06-06 reset's test-only data exists, so this is a clean reshape.
-- per_match games keep points_total NULL.
UPDATE public.games g
SET points_total = sub.total
FROM (
  SELECT id,
         (SELECT COALESCE(SUM(v::numeric), 0)
            FROM jsonb_array_elements_text(points_distribution -> 'values') AS v) AS total
    FROM public.games
   WHERE points_distribution ->> 'type' = 'placement'
) sub
WHERE g.id = sub.id
  AND g.points_distribution ->> 'type' = 'placement'
  AND g.points_total IS NULL;
