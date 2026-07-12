-- 074: per-match points override (Refactor A2b — the Total Points model).
--
-- A2b inverts match-play points config: the owner sets a TOTAL (games.points_total),
-- the per-match value DERIVES from it (total ÷ matches, written to
-- points_distribution.value as the "even share"), and INDIVIDUAL matches can be
-- OVERRIDDEN. This column holds that override:
--   NULL  = this match uses the even share (points_distribution.value);
--   set   = this match's overridden competition-point value.
-- The remainder redistributes across the non-overridden matches to keep the total
-- locked. Redistribution is DERIVED, never snapshotted — only the explicit overrides
-- persist here; the even share is always recomputed from
-- (points_total − Σ overrides) ÷ nonOverriddenCount.
--
-- Award/read rule (the 4 award sites): each match awards
--   point_value ?? points_distribution.value.
--
-- numeric (not int) so an owner CAN override to a fractional value if they choose —
-- honest fractions are surfaced, never auto-rounded. Additive nullable column on a
-- small table (sub-ms lock); safe for existing games, which read NULL → the even
-- share, i.e. unchanged behavior.
ALTER TABLE public.game_matches
  ADD COLUMN IF NOT EXISTS point_value numeric;

COMMENT ON COLUMN public.game_matches.point_value IS
  'A2b per-match points override. NULL = use the even share (points_distribution.value); set = this match''s overridden competition-point value. Only overrides persist; the even share is always derived from (points_total - sum(overrides)) / nonOverriddenCount.';
