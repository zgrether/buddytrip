-- 215 · game_started sees a bracket's winners and every finished game (#1413, #1525).
--
-- `game_started` is the one answer to "has this game begun producing results?"
-- (161: "A new format adds an arm HERE rather than a fourth query at a call
-- site"). Two kinds of result were invisible to all five arms:
--
-- 1. A BRACKET (#1413). Its progress is a recorded winner in `bracket_matches`
--    and nowhere else, so a bracket being played read as Ready for Play from
--    go-live to finalize. Measured on production 2026-09-22: three brackets with
--    11, 3 and 1 decided matches, none reading as started.
-- 2. MANUAL PLACEMENTS (#1525). A non-golf placement game writes only
--    `game_results`, and only at finalize, so a cup whose only results were
--    placements never read as having any. Captains kept roster rights and staff
--    roster changes skipped the fingerprint-checked preview after the game paid.
--
-- THE ARMS ADDED
--   bracket_matches WHERE winner_entrant_id IS NOT NULL
--   games           WHERE status = 'complete'
-- The second covers manual placements without naming a format. It was chosen
-- over a `game_results` arm (Zach, 2026-10-14): golf match play's setup-path
-- recompute writes `game_results` rows for paired matches with no hole played,
-- so a `game_results` arm would read a live, unstarted game as started, and
-- scoping it to manual formats would put a format list in SQL. A finished game
-- has, by definition, produced its results. UNION keeps one row per game, so an
-- arm overlapping another counts nothing twice.
--
-- WHAT EACH READER NOW SEES (every reader, from pg_proc and the app's code):
--   - the board's On Tap / Ready for Play split (boardGames.ts): a bracket with a
--     winner moves to On Tap, which is the bug #1413 reported. Finished games are
--     not in the `active` split, so the second arm moves nothing there.
--   - the roster lock (`competitionHasResults` → captains, staff preview, the
--     settings modal) and `_competition_roster_locked` (the captain RPCs): a cup
--     with a decided bracket match or any finished game now reads as having
--     results, which is #1525's fix.
--   - save_game_config's scoring-type lock (179/214): fires on a finished
--     stroke game too; a finished game's config is already final.
--   - the course lock (games.applyCourse, #1474): refuses a finished game's
--     course change, the same as a scored one.
-- No reader treats a merely enabled game differently: neither arm fires before a
-- result exists.
--
-- security_invoker is restated, as every redefinition of this view must: a
-- CREATE OR REPLACE VIEW without it resets the view to owner security, which
-- would hand every trip's game ids to anyone who can read the view.
-- `publicViews.catalogue.test.ts` (#1440) fails CI if it is ever missing.

CREATE OR REPLACE VIEW public.game_started
WITH (security_invoker = true) AS
  -- Golf score entry (stroke, rack, match in score mode).
  SELECT DISTINCT game_id FROM public.score_entries
  UNION
  -- Match play in OUTCOME mode — no score_entries however many holes are
  -- decided.
  SELECT DISTINCT game_id FROM public.match_hole_outcomes
  UNION
  -- Pick'em (migration 159/161): the first recorded slate result.
  SELECT DISTINCT game_id FROM public.pickem_slate_games WHERE result IS NOT NULL
  UNION
  -- Non-golf Matches (170): a match result is DECLARED, not derived from holes,
  -- so this is the only one of the arms above that ever fires for it. Also true
  -- for decided golf match-play matches, harmlessly — see 170's header.
  SELECT DISTINCT game_id FROM public.game_matches WHERE result IS NOT NULL
  UNION
  -- Skins (184): the whole of this format's score, in a table none of the arms
  -- above touch. Unfiltered — a `tied` row is a played hole.
  SELECT DISTINCT game_id FROM public.skins_hole_outcomes
  UNION
  -- Bracket (215, #1413): a recorded winner. A bracket writes none of the
  -- tables above; its progress lives here and nowhere else.
  SELECT DISTINCT game_id FROM public.bracket_matches WHERE winner_entrant_id IS NOT NULL
  UNION
  -- Every FINISHED game (215, #1525): manual placements write `game_results`
  -- only at finalize, so this is their arm, chosen over a `game_results` arm
  -- that golf's setup-path recompute would trip on an unstarted game.
  SELECT id AS game_id FROM public.games WHERE status = 'complete';

COMMENT ON VIEW public.game_started IS
  'One row per game that has begun producing results, with a branch per format: golf score entries, outcome-mode hole outcomes, pick''em slate results, decided game_matches rows (170, added for non-golf Matches — also true, harmlessly, for decided golf match-play matches), skins hole outcomes (186, unfiltered: a tied row is a played hole), a bracket''s recorded winners (215, #1413), and every finished game (215, #1525: manual placements write results only at finalize). Replaces the two-query merge in competitionLeaderboard — the board splits `active` into Ready-for-Play and underway on this. A new format adds an arm HERE rather than a fourth query at a call site (migration 161). security_invoker so the caller''s RLS applies exactly as it did to the direct reads.';
