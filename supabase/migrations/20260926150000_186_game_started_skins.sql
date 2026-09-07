-- ════════════════════════════════════════════════════════════════════════════
-- 186 · game_started gains its fifth arm — skins
--
-- Migration 161 created this view precisely so that this change is one line in
-- one place, and its own COMMENT says so: "A new format adds an arm HERE rather
-- than a fourth query at a call site."
--
-- ── Why skins needs an arm at all ──────────────────────────────────────────
--
-- A skins game stores its score in `skins_hole_outcomes` (184) and in NONE of
-- the four tables the view already reads. It writes no `score_entries` (there
-- are no strokes), no `match_hole_outcomes` (there are no matches), no
-- `pickem_slate_games`, and no `game_matches`. So without this every caller of
-- `startedGameIds` answers "nobody has played this" for a skins game seventeen
-- holes in — which is CLAUDE.md #27 exactly, and it is the failure this view was
-- extracted to stop repeating.
--
-- What that would break, concretely: the competition board splits `active` into
-- Ready-for-Play and underway on this signal, so a live skins game would sit in
-- the wrong section all day; and both removal guards (`findContributionBlockers`,
-- `competitionHasScore`) would let a played game be treated as untouched.
--
-- ── EVERY recorded hole counts, including a tie ───────────────────────────
--
-- No `WHERE` clause, deliberately, and it is worth saying why rather than
-- leaving it to look like an omission. The pick'em arm filters on
-- `result IS NOT NULL` because an unresolved slate game is a row that exists
-- before anything happened. This table has no such row: a hole with no row has
-- not been played, and a `tied` row is a hole that WAS played and carried the
-- pot forward. Filtering ties out would report a group that had halved its first
-- three holes as not started.
--
-- Landed as its own migration rather than folded into 184 because 184 is already
-- open for review, and because this is a genuinely separate claim — 184 says
-- where the rows live, this says who has to know about them.
-- ════════════════════════════════════════════════════════════════════════════

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
  -- so this is the only one of the four arms that ever fires for it. Also true
  -- for decided golf match-play matches, harmlessly — see the header.
  SELECT DISTINCT game_id FROM public.game_matches WHERE result IS NOT NULL
  UNION
  -- Skins (184): the whole of this format's score, in a table none of the four
  -- arms above touch. Unfiltered — a `tied` row is a played hole.
  SELECT DISTINCT game_id FROM public.skins_hole_outcomes;

COMMENT ON VIEW public.game_started IS
  'One row per game that has begun producing results, with a branch per format: golf score entries, outcome-mode hole outcomes, pick''em slate results, decided game_matches rows (170, added for non-golf Matches — also true, harmlessly, for decided golf match-play matches), and skins hole outcomes (186, unfiltered: a tied row is a played hole). Replaces the two-query merge in competitionLeaderboard — the board splits `active` into Ready-for-Play and underway on this. A new format adds an arm HERE rather than a fourth query at a call site (migration 161). security_invoker so the caller''s RLS applies exactly as it did to the direct reads.';
