-- 034 — game_type_templates: engine columns + a clean stroke-play row
--
-- Adds the data-driven engine columns from COMPETITION_ENGINE.md (the add-game
-- wizard reads these instead of hardcoding per-type branches) and ensures one
-- canonical individual stroke-play template. Only touches stroke play — the
-- existing placeholder rows (Scramble/Stableford/Skins/Match Play) are re-seeded
-- in a later slice against the full taxonomy. Idempotent.

ALTER TABLE public.game_type_templates
  ADD COLUMN IF NOT EXISTS entry_schema text,
  ADD COLUMN IF NOT EXISTS result_strategy text,
  ADD COLUMN IF NOT EXISTS supports_free_for_all boolean,
  ADD COLUMN IF NOT EXISTS supports_sides boolean,
  ADD COLUMN IF NOT EXISTS requires_sides boolean,
  ADD COLUMN IF NOT EXISTS max_players_per_side integer,
  ADD COLUMN IF NOT EXISTS compatible_competition_formats text[],
  ADD COLUMN IF NOT EXISTS compatible_modifiers text[],
  ADD COLUMN IF NOT EXISTS config_schema jsonb,
  ADD COLUMN IF NOT EXISTS scorecard_schema jsonb;

-- Canonical individual stroke-play template (Slice A). Low total wins, one score
-- per user per hole, 18-hole grid with front/back-9 sections. Default par is a
-- par-72 layout (a real course overrides via games.course_id in a later slice).
INSERT INTO public.game_type_templates (
  id, key, name, description, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides,
  compatible_competition_formats, compatible_modifiers,
  config_schema, scorecard_schema
)
VALUES (
  'gtt_stroke_play', 'stroke_play', 'Stroke Play',
  'Individual gross stroke play — lowest total wins.', 0,
  'user_holes', 'stroke_total',
  true, false, false,
  ARRAY['free_for_all']::text[], ARRAY[]::text[],
  '{}'::jsonb,
  '{
    "units": {
      "type": "holes", "count": 18, "ordered": true,
      "labels": ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18"],
      "metadata": { "par": [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4] }
    },
    "entry": { "value_type": "integer", "value_label": "Strokes", "min": 1, "max": null },
    "scoring": {
      "strategy": "stroke_total", "direction": "low_wins", "aggregation": "sum",
      "sections": [
        { "name": "Front 9", "units": ["1","2","3","4","5","6","7","8","9"] },
        { "name": "Back 9", "units": ["10","11","12","13","14","15","16","17","18"] }
      ],
      "tiebreaker": "shared"
    },
    "participants": { "min": 2, "max": 4, "participant_type": "individual", "assigned_pairings": false },
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
  compatible_competition_formats = EXCLUDED.compatible_competition_formats,
  compatible_modifiers = EXCLUDED.compatible_modifiers,
  config_schema = EXCLUDED.config_schema,
  scorecard_schema = EXCLUDED.scorecard_schema;
