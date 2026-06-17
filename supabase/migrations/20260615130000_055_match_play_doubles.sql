-- 055 — 2v2 match play (doubles): side-handicap column + game type template
--
-- BBMI's remaining events (2-Man Scramble, Alt-Shot, Best-Ball) are all 2v2
-- match play. The engine is 1v1's match_play, with the SIDE being a pair
-- (a `play_group`) instead of a user, and ONE score recorded per side per hole
-- (`group_holes`) instead of per user. `game_matches`, `play_groups`,
-- `score_entries` (participant_type IN ('user','play_group')) and `game_results`
-- (entity_type IN ('user','team','play_group')) already support this shape — see
-- COMPETITION_ENGINE.md. Idempotent.

-- ── 1. Side handicap ─────────────────────────────────────────────────────────
-- 1v1 stores a match's handicap strokes on `game_participants.handicap_strokes`
-- (per user). A 2v2 side is a PAIR (a play_group), so its per-match handicap
-- lives on the play_group. computeMatchPlayResults reads from here when a side
-- is a play_group, and from game_participants when a side is a user.
ALTER TABLE public.play_groups ADD COLUMN IF NOT EXISTS handicap_strokes integer;

COMMENT ON COLUMN public.play_groups.handicap_strokes IS
  'Match-play handicap strokes this side (pair) receives, for 2v2/doubles where '
  'the play_group is the scoring side. Null = 0. Mirrors '
  'game_participants.handicap_strokes (which is per user, for 1v1 sides).';

-- ── 2. gtt_match_play_doubles ────────────────────────────────────────────────
-- Same engine as singles (result_strategy='match_play'), but entry is one ball
-- per SIDE per hole (entry_schema='group_holes') and a side holds two players
-- (max_players_per_side=2). The three BBMI presets (Scramble / Alt-Shot /
-- Best-Ball) are NOT separate engines — they are this one type with a name +
-- Rules Explainer + default modifier toggles, set client-side. compatible
-- modifiers match singles (moving_tees + glorious_holes — the preset defaults).
INSERT INTO public.game_type_templates (
  id, key, name, description, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides, max_players_per_side,
  compatible_competition_formats, compatible_modifiers, category,
  config_schema, scorecard_schema
)
VALUES (
  'gtt_match_play_doubles', 'match_play_doubles', '2v2 Match Play',
  '2v2 match play — one score per side per hole, low net wins each hole; the match resolves W/H/L hole-by-hole between two pairs. Scramble / Alt-Shot / Best-Ball are presets over this one engine.', 2,
  'group_holes', 'match_play',
  false, true, true, 2,
  ARRAY['ryder_cup']::text[], ARRAY['moving_tees', 'glorious_holes']::text[], 'golf',
  '{}'::jsonb,
  '{
    "units": {
      "type": "holes", "count": 18, "ordered": true,
      "labels": ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18"],
      "metadata": { "par": [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4] }
    },
    "entry": { "value_type": "integer", "value_label": "Strokes", "min": 1, "max": null },
    "scoring": {
      "strategy": "match_play", "direction": "low_wins", "aggregation": "match",
      "sections": [
        { "name": "Front 9", "units": ["1","2","3","4","5","6","7","8","9"] },
        { "name": "Back 9", "units": ["10","11","12","13","14","15","16","17","18"] }
      ],
      "tiebreaker": "shared"
    },
    "participants": { "min": 4, "max": 8, "participant_type": "side", "players_per_side": 2, "assigned_pairings": true },
    "interaction": { "model": "simultaneous", "entry_timing": "per_unit" }
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  key = EXCLUDED.key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  entry_schema = EXCLUDED.entry_schema,
  result_strategy = EXCLUDED.result_strategy,
  supports_free_for_all = EXCLUDED.supports_free_for_all,
  supports_sides = EXCLUDED.supports_sides,
  requires_sides = EXCLUDED.requires_sides,
  max_players_per_side = EXCLUDED.max_players_per_side,
  compatible_competition_formats = EXCLUDED.compatible_competition_formats,
  compatible_modifiers = EXCLUDED.compatible_modifiers,
  category = EXCLUDED.category,
  config_schema = EXCLUDED.config_schema,
  scorecard_schema = EXCLUDED.scorecard_schema;
