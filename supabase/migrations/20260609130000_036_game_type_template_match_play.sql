-- 036 — game_type_templates: singles match-play row (Slice B)
--
-- The data-driven template the add-game wizard + games.finish read for match
-- play (result_strategy='match_play' branches the finish computation). Entry
-- reuses Slice A's per-hole grid (entry_schema='user_holes'); the comparison is
-- on NET hole-by-hole between two players, assigned pairings. Idempotent.

INSERT INTO public.game_type_templates (
  id, key, name, description, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides, max_players_per_side,
  compatible_competition_formats, compatible_modifiers,
  config_schema, scorecard_schema
)
VALUES (
  'gtt_match_play_singles', 'match_play_singles', 'Singles Match Play',
  '1v1 match play — low net wins each hole; the match resolves W/H/L hole-by-hole.', 1,
  'user_holes', 'match_play',
  false, true, true, 1,
  ARRAY['ryder_cup']::text[], ARRAY[]::text[],
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
    "participants": { "min": 2, "max": 4, "participant_type": "individual", "assigned_pairings": true },
    "interaction": { "model": "simultaneous", "entry_timing": "per_unit" }
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  key = EXCLUDED.key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  entry_schema = EXCLUDED.entry_schema,
  result_strategy = EXCLUDED.result_strategy,
  supports_free_for_all = EXCLUDED.supports_free_for_all,
  supports_sides = EXCLUDED.supports_sides,
  requires_sides = EXCLUDED.requires_sides,
  max_players_per_side = EXCLUDED.max_players_per_side,
  compatible_competition_formats = EXCLUDED.compatible_competition_formats,
  compatible_modifiers = EXCLUDED.compatible_modifiers,
  config_schema = EXCLUDED.config_schema,
  scorecard_schema = EXCLUDED.scorecard_schema;
