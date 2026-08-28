-- 161 — ONE predicate for "this game has begun producing results".
--
-- ══ The third instance, so extract instead of adding a third source ════════
--
-- `competitionLeaderboard` builds `started` by merging two batch reads —
-- `score_entries` and `match_hole_outcomes` — into a Set. The comment beside
-- the second one already names the shape:
--
--   "an outcome game never has score_entries rows, so it needs its OWN
--    'started' source or it reads Ready-for-Play forever"
--
-- Pick'em is the third. It has neither table: results live in
-- `pickem_slate_games.result` (migration 159). Left alone, a locked pick'em
-- game reads "Ready for Play" indefinitely, however many results are in.
--
-- Adding a third inline query would work and would guarantee a fourth. The
-- question — "has this game begun?" — belongs in one place with a branch per
-- format, so the next format contributes an arm rather than another caller
-- learning the whole list.
--
-- ══ Why a VIEW and not a function ═════════════════════════════════════════
--
-- The caller asks about MANY games at once (`.in("game_id", gameIds)`). A
-- per-game function would be N round trips for a board that already fans out
-- hard. A view is one read, and it replaces two — strictly cheaper than the
-- code it removes, which is the argument for doing the proper version rather
-- than the narrow fix.
--
-- ══ security_invoker, deliberately ════════════════════════════════════════
--
-- The leaderboard reads with `ctx.supabase` — the USER's client. A view
-- defaults to running as its owner, which would silently widen every one of
-- these reads past the RLS the two direct queries are subject to today.
-- `security_invoker = true` keeps the semantics byte-identical to the queries
-- it replaces: same rows, same policies, same caller.
--
-- ══ What "started" means, and what it does NOT ════════════════════════════
--
-- It means results are landing. It is NOT "is configured", "is live", or "has
-- players" — the board's five-way partition (`status × started × isNewGame`)
-- uses it only to split `active` into Ready-for-Play and underway.
--
-- A pick'em game's answer is its first slate result, which is the same
-- boundary `_pickem_has_results` uses for the picks and settings freeze. Kept
-- as its own expression here rather than calling that function: this view is a
-- BATCH read over many games and that predicate takes one id, and it is scoped
-- to pick'em in a way the union arm below does not need to repeat.

CREATE OR REPLACE VIEW public.game_started
WITH (security_invoker = true) AS
  -- Golf score entry (stroke, rack, match in score mode).
  SELECT DISTINCT game_id FROM public.score_entries
  UNION
  -- Match play in OUTCOME mode — no score_entries however many holes are
  -- decided, which is the gap that made this a pattern rather than an accident.
  SELECT DISTINCT game_id FROM public.match_hole_outcomes
  UNION
  -- Pick'em (migration 159/161): the first recorded slate result. A push or a
  -- cancellation counts — the game produced a fact, and the board should stop
  -- calling it Ready.
  SELECT DISTINCT game_id FROM public.pickem_slate_games WHERE result IS NOT NULL;

COMMENT ON VIEW public.game_started IS
  'One row per game that has begun producing results, with a branch per format: golf score entries, outcome-mode hole outcomes, and pick''em slate results. Replaces the two-query merge in competitionLeaderboard — the board splits `active` into Ready-for-Play and underway on this. A new format adds an arm HERE rather than a fourth query at a call site (migration 161). security_invoker so the caller''s RLS applies exactly as it did to the direct reads.';

GRANT SELECT ON public.game_started TO authenticated;
GRANT SELECT ON public.game_started TO service_role;
