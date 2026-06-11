-- 038 — add metadata.handicap_index to the scorecard templates (Slice C)
--
-- The GolfCard review grid renders an INDEX row (stroke/handicap index, 1 =
-- hardest) alongside PAR, sourced from `scorecard_schema.units.metadata
-- .handicap_index[]`. The templates carried `par` but not the index, so this
-- adds a par-72 default (odd-front / even-back convention). A real course
-- overrides per-hole values once the Course Picker lands. Idempotent.

UPDATE public.game_type_templates
SET scorecard_schema = jsonb_set(
  scorecard_schema,
  '{units,metadata,handicap_index}',
  '[7,3,15,1,11,5,17,9,13,8,4,16,2,12,6,18,10,14]'::jsonb,
  true
)
WHERE scorecard_schema #> '{units,metadata,par}' IS NOT NULL
  AND scorecard_schema #> '{units,metadata,handicap_index}' IS NULL;
