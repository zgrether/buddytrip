-- 044 · Slice D1 (2b) — format reconciliation.
--
-- One format list: the creation UI's chips are driven by game_type_templates,
-- and the format the user picks IS the engine game type that runs — or the new
-- non-engine "manual" type (placement entered by hand, §5 manual adapter).
--
-- Two changes:
--   1. Add the `manual` template (gtt_manual) — no engine, no scorecard.
--   2. Remove the four PRE-ENGINE legacy uuid rows (skins/scramble/match_play/
--      stableford — result_strategy NULL, no scorecard_schema). Audit-first:
--      confirmed ZERO references — no games.game_type_id points at them (all
--      games use gtt_match_play_singles / gtt_stroke_play) and no code cites the
--      uuids. They predate the engine `gtt_*` rows and are dead.
-- Idempotent.

-- 1 · The manual / "other" game type. Non-engine: organizers ENTER per-team
-- standings into game_results (the universal placement input), nothing is
-- computed and there is no scorecard (scorecard entry stays gated on
-- scorecard_schema, which is null here).
INSERT INTO public.game_type_templates (
  id, key, name, description, config, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides, max_players_per_side,
  compatible_competition_formats, compatible_modifiers, config_schema, scorecard_schema
) VALUES (
  'gtt_manual', 'manual', 'Manual / Other',
  'A non-engine contest (cornhole, trivia, pick''em, H-O-R-S-E…) — finishing order entered by hand.',
  '{}'::jsonb, 99,
  NULL, NULL,
  true, true, false, NULL,
  NULL, '{}'::text[], '{}'::jsonb, NULL
)
ON CONFLICT (id) DO NOTHING;

-- 2 · Drop the dead pre-engine legacy rows (zero refs — see header audit).
-- Delete by KEY, not the original remote UUIDs. Mig 024 seeds these four rows
-- with DEFAULT-generated random ids, so the ids differ per environment — the
-- previous hardcoded-uuid delete only matched the row ids that happened to be
-- generated on the prod box, and silently MISSED on any fresh replay (leaving
-- key='match_play' alive to collide with mig 073's unified insert). Keying on the
-- stable `key` plus the pre-engine marker (`result_strategy IS NULL`) drops exactly
-- these four rows in every environment; the engine rows (gtt_stroke_play,
-- gtt_match_play_singles, …) all carry a non-null result_strategy and are untouched.
DELETE FROM public.game_type_templates
WHERE key IN ('skins', 'scramble', 'match_play', 'stableford')
  AND result_strategy IS NULL;
