-- 073 — Unify match play: gtt_match_play_singles + gtt_match_play_doubles → one
--       gtt_match_play game type (Refactor A1).
--
-- 1v1-vs-2v2 is a per-MATCH property, not a game type: each `game_matches` row
-- already carries a self-describing `{type:"user"|"play_group"}` side ref, and the
-- scoring engine (buildDecided / matchState / computeMatchPlayResults) resolves
-- each side PER ROW — it never reads game_type_id. So the two types were one type
-- encoded as two. This collapses them: insert the unified template, then re-tag
-- every existing singles/doubles game to it. Existing games keep working unchanged
-- (their shape lives on their match sides, which this does not touch).
--
-- SAFETY (RLS-risk class — game_type_id): audited every policy + SECURITY DEFINER
-- function; NONE branch on game_type_id. The one format-adjacent function,
-- can_score_unit (mig 072), resolves the scoring unit from game_matches side type
-- + game_participants.play_group_id, NOT game_type_id — so re-tagging cannot shift
-- any access decision. Idempotent.

-- ── 1. The unified template row ──────────────────────────────────────────────
-- Same engine as before (result_strategy='match_play'); shape is per-match, so
-- max_players_per_side is the max any single match supports (2). scorecard_schema
-- carries par + handicap_index (the singles schema; the old doubles row dropped
-- handicap_index — incidental drift, corrected here). compatible_modifiers is the
-- union of the former sets.
INSERT INTO public.game_type_templates (
  id, key, name, description, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides, max_players_per_side,
  compatible_competition_formats, compatible_modifiers, category,
  config_schema, scorecard_schema
)
VALUES (
  'gtt_match_play', 'match_play', 'Match Play',
  'Head-to-head, hole by hole — low net score wins each hole, and winning more holes wins the match. Each match is 1v1 or 2v2, and one game can mix both.', 1,
  'user_holes', 'match_play',
  false, true, true, 2,
  ARRAY['ryder_cup']::text[], ARRAY['moving_tees', 'glorious_holes']::text[], 'golf',
  '{}'::jsonb,
  '{
    "units": {
      "type": "holes", "count": 18, "ordered": true,
      "labels": ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18"],
      "metadata": {
        "par": [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4],
        "handicap_index": [7,3,15,1,11,5,17,9,13,8,4,16,2,12,6,18,10,14]
      }
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
    "participants": { "min": 2, "max": 8, "participant_type": "individual", "assigned_pairings": true },
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

-- ── 2. Re-tag existing games ─────────────────────────────────────────────────
-- Every singles/doubles game becomes a unified match_play game. Their per-match
-- shape is untouched (it lives on game_matches.side_a/side_b), so they compute and
-- render identically — a doubles game's play_group-typed sides still read as 2v2.
UPDATE public.games
SET game_type_id = 'gtt_match_play'
WHERE game_type_id IN ('gtt_match_play_singles', 'gtt_match_play_doubles');

-- ── 3. Old template rows ─────────────────────────────────────────────────────
-- The gtt_match_play_singles / gtt_match_play_doubles template rows are now
-- orphaned anchors (no games reference them after step 2; no runtime code queries
-- game_type_templates — gameTypes.ts is the code home of record). Left in place;
-- a dedicated cleanup migration can drop them once confirmed unreferenced across
-- all environments (audit-before-delete).
