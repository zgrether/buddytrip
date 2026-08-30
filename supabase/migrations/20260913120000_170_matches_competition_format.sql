-- ════════════════════════════════════════════════════════════════════════════
-- 170 · The Matches competition format — CHECK value + `game_started` arm
--
-- Two additive changes for one feature, kept in one migration because both are
-- prerequisites for the SAME code to ship — unlike 168/169, where the ordering
-- itself needed to be a gate (see 168's header). Here nothing needs the two
-- separated: the CHECK admits the new value and the view learns to recognise
-- it, and either alone is harmless applied without the other.
--
-- ── 1. `games_competition_format_check` admits 'matches' ───────────────────
--
-- `MATCHES_COMPETITION_FORMAT` (src/lib/resultStrategy.ts) is the code side of
-- this same value — imported into `COMPETITION_FORMATS`
-- (src/lib/configDraft.ts), never re-typed, so the zod, the draft, and this
-- CHECK enumerate it from ONE constant on the TypeScript side. This CHECK is
-- the third and last place per 114's precedent, and the one `tsc` cannot see:
-- a value the DATABASE branches on is not caught by a type error, only by
-- running against a real schema (CI, or a rolled-back transaction).
--
-- 'matches' is a NEW value, not a reuse of the retired 'live_results' slot the
-- format takes in the picker. See migrations 168/169 and
-- `MATCHES_COMPETITION_FORMAT`'s own header for why: this column stopped being
-- cosmetic once `resolveResultStrategy` began branching on it, and reusing a
-- retired value here would have been the same load-bearing lie in reverse —
-- 'matches' meaning "we don't know what this is" for however long a stale
-- client kept sending the old string.
--
-- ── 2. `game_started` gains a Matches arm ───────────────────────────────────
--
-- Migration 161's own header predicted this: "A new format adds an arm HERE
-- rather than a fourth query at a call site." A Matches game writes NEITHER
-- `score_entries` (no scores — a result is declared, not scored) NOR
-- `match_hole_outcomes` (no holes — Matches skips the half of match play that
-- computes a result FROM holes and reuses only the award half, see
-- `matchAwards.ts`). Left alone, the view's existing two golf arms would never
-- fire for this format, and a Matches game with three of four matches decided
-- would read Ready-for-Play forever, identically to what 161 fixed for pick'em
-- and outcome-mode match play before it.
--
-- `game_matches.result IS NOT NULL` is the same predicate every other reader of
-- "has this match been decided" already uses (`computeMatchPlayResults`'s own
-- query, `matchesStructureEqual`'s callers) — not a new one invented for this
-- view. It is also true for GOLF match play the moment a match decides, which
-- is harmless: `UNION` de-duplicates, and by the time a golf match's `result`
-- is set, one of the other two arms has already fired (a decided match implies
-- entered scores or recorded outcomes). This arm is a no-op addition for golf
-- and the ONLY signal for Matches.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_competition_format_check;

ALTER TABLE public.games ADD CONSTRAINT games_competition_format_check
  CHECK (competition_format IS NULL OR competition_format IN
    ('head_to_head', 'bracket', 'best_of_n', 'matches',
     -- Legacy, read-accepted only. See migration 114's header.
     'bracket_se', 'bracket_de'));

COMMENT ON COLUMN public.games.competition_format IS
  'Per-game "How''s it played?" choice (head_to_head | bracket | best_of_n | '
  'matches). Read by resolveResultStrategy together with the game type to pick '
  'the finalize engine, so it is no longer a purely cosmetic label. NULL until '
  'chosen, and also what the reset primitives write. bracket_se/bracket_de are '
  'LEGACY values from before single/double became a setting inside one Bracket '
  'format — still accepted so pre-collapse rows stay saveable, never offered. '
  'live_results was removed in migration 169 after its one row was repointed '
  'to head_to_head (168): the feature was never built. matches (170) is its '
  'replacement in the picker''s slot, not its value — a NEW string, because '
  'this column stopped being cosmetic and reusing a retired value would have '
  'been the same lie in reverse.';

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
  SELECT DISTINCT game_id FROM public.game_matches WHERE result IS NOT NULL;

COMMENT ON VIEW public.game_started IS
  'One row per game that has begun producing results, with a branch per format: golf score entries, outcome-mode hole outcomes, pick''em slate results, and decided game_matches rows (170, added for non-golf Matches — also true, harmlessly, for decided golf match-play matches). Replaces the two-query merge in competitionLeaderboard — the board splits `active` into Ready-for-Play and underway on this. A new format adds an arm HERE rather than a fourth query at a call site (migration 161). security_invoker so the caller''s RLS applies exactly as it did to the direct reads.';
