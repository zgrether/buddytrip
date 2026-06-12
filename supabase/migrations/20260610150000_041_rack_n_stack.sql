-- 041 — Rack-n-Stack template + game_results.points (Slice C part 3)
--
-- Rack-n-stack is net stroke play with a rank-paired scoreboard, run inside a
-- 2-team competition. Entry is ordinary per-user per-hole stroke play
-- (entry_schema='user_holes'); the novelty is the standings, computed as a
-- derived read-model (NOT persisted pairings). games.finish branches on
-- result_strategy='rack_n_stack'. Idempotent.

-- Team points can be fractional (a tied slot halves ½/½), which raw_score (int)
-- can't hold. Add a nullable numeric `points` for the team tally; raw_score
-- stays the gross integer for stroke play, competition_points_earned stays for
-- the Slice D competition mapping.
ALTER TABLE public.game_results ADD COLUMN IF NOT EXISTS points numeric;

INSERT INTO public.game_type_templates (
  id, key, name, description, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides, max_players_per_side,
  compatible_competition_formats, compatible_modifiers,
  config_schema, scorecard_schema
)
VALUES (
  'gtt_rack_n_stack', 'rack_n_stack', 'Rack-n-Stack',
  'Net stroke play scored as a rank-paired team board: each team is sorted by net-to-par and paired by rank; the lower net wins each slot (a tie halves).', 2,
  'user_holes', 'rack_n_stack',
  false, true, true, NULL,
  ARRAY['ryder_cup']::text[], ARRAY[]::text[],
  '{}'::jsonb,
  '{
    "units": {
      "type": "holes", "count": 18, "ordered": true,
      "labels": ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18"],
      "metadata": {
        "par": [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4],
        "handicap_index": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]
      }
    },
    "entry": { "value_type": "integer", "value_label": "Strokes", "min": 1, "max": null },
    "scoring": {
      "strategy": "rack_n_stack", "direction": "low_wins", "aggregation": "net_to_par",
      "sections": [
        { "name": "Front 9", "units": ["1","2","3","4","5","6","7","8","9"] },
        { "name": "Back 9", "units": ["10","11","12","13","14","15","16","17","18"] }
      ],
      "tiebreaker": "shared"
    },
    "participants": { "min": 2, "max": null, "participant_type": "individual", "assigned_pairings": false },
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
  config_schema = EXCLUDED.config_schema,
  scorecard_schema = EXCLUDED.scorecard_schema;
