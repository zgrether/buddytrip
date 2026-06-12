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
DELETE FROM public.game_type_templates
WHERE id IN (
  '4e3d35f0-ff86-46bb-a3a0-e34138dda311', -- skins (legacy)
  '922cec93-9559-4198-be9f-59b164cb8d6c', -- scramble (legacy)
  'c5c59abf-dbce-4858-8fc0-0d60b605f609', -- match_play (legacy)
  'fc5085e3-a2e4-41a2-986a-797bdfc01fcd'  -- stableford (legacy)
);
