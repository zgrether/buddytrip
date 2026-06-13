-- 048 — D1 follow-on: tagged points_distribution shape + numeric raw_score
--
-- Two structural changes:
--
-- 1. game_results.raw_score: integer → numeric.
--    Match-play halved matches produce 0.5-point awards; integer truncates them.
--    All existing rows are integer and convert silently.
--
-- 2. games.points_distribution: bare number[] → tagged jsonb shape.
--    The bare array assumed all games used ranked placement. The tag makes the
--    adapter kind explicit and allows a second kind (per_match) to coexist:
--      { "type": "placement", "values": [9,6,4,2] }   — ranked payout
--      { "type": "per_match", "value": 1 }             — winner/halve per match
--    Live data is test-only (DB reset 2026-06-06), so plain UPDATE is safe.
--
-- Order: convert match-play games FIRST so their bare arrays get the per_match
-- tag instead of being wrapped as placement.

-- 1. numeric raw_score (supports fractional half-point halve awards)
ALTER TABLE public.game_results ALTER COLUMN raw_score TYPE numeric;

-- 2a. Match-play games → per_match shape (default value=1 per match).
--     Reset any existing array they had — it was nonsensical for match play.
UPDATE public.games
SET points_distribution = '{"type":"per_match","value":1}'::jsonb
WHERE game_type_id = 'gtt_match_play_singles';

-- 2b. Remaining non-null arrays → placement shape.
UPDATE public.games
SET points_distribution = jsonb_build_object('type', 'placement', 'values', points_distribution)
WHERE points_distribution IS NOT NULL
  AND jsonb_typeof(points_distribution) = 'array';
