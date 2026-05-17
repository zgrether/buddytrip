-- Adds scoreboard_style to competitions so the owner's choice of
-- visual style for the live scoreboard syncs across all crew members
-- and devices (was localStorage-per-browser before, which meant only
-- the owner's browser saw the right style).
--
-- 8 enum values match the eight ScoreboardStyleId variants in
-- src/components/competition/scoreboard-styles/types.ts.

ALTER TABLE public.competitions
  ADD COLUMN scoreboard_style TEXT NOT NULL DEFAULT 'grid';

ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_scoreboard_style_check
  CHECK (scoreboard_style IN (
    'grid','leaderboard','heatmap','cards','bars','podium','stadium','minimal'
  ));
