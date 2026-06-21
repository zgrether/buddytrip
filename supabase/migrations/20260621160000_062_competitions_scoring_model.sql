-- 062 — competitions.scoring_model: the scoring-model axis (match_play vs points)
--
-- W-NONGOLF-02. Competition "type" was previously INFERRED from teams.length===2
-- ("RYDER_CUP"). But team count and scoring model are INDEPENDENT axes: a 2-team
-- competition can be points-based (two big teams, N scoring positions per game).
-- So teams.length===2 is only ACCIDENTALLY a match-play signal — true so far
-- because every comp built to date is match-play. This adds the scoring-model
-- axis as a real, stored field: the only source for a distinction team count
-- cannot supply.
--
--   match_play — head-to-head win/lose/tie; the winner takes the game's points,
--                a tie splits them (the existing averaged-tie convention).
--   points     — points-per-position distribution (the #430 placement model).
--
-- Branches the NON-GOLF result model ONLY. The leaderboard hero stays on
-- teams.length (team count) — do NOT repoint it here. Golf scoring is untouched.
--
-- NOT NULL DEFAULT 'match_play' backfills every existing competition to
-- match_play. Safe-backfill verified (2026-06-21, live DB): no existing comp has
-- a placement game distributing across >2 positions, i.e. none was built as a
-- points config — all extant comps are de-facto match-play. BBMI Cup (2 teams,
-- 15 games) thus resolves to match_play with no new UI. The creation-time
-- chooser (points vs match_play — needed for the 2-team-points case) rides the
-- WS4 creation redesign (W-TYPE-01); it is intentionally not built here.
-- Idempotent.
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS scoring_model text NOT NULL DEFAULT 'match_play';

DO $$ BEGIN
  ALTER TABLE public.competitions
    ADD CONSTRAINT competitions_scoring_model_check
    CHECK (scoring_model IN ('match_play', 'points'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.competitions.scoring_model IS
  'Scoring-model axis, INDEPENDENT of team count: match_play (win/lose/tie — '
  'winner takes the game points, a tie splits them) | points (points-per-position '
  'distribution, the #430 placement model). Branches the non-golf result model '
  'ONLY; the leaderboard hero stays on teams.length. Default match_play (every '
  'pre-existing comp was de-facto match-play). Creation-time chooser deferred to '
  'W-TYPE-01.';
