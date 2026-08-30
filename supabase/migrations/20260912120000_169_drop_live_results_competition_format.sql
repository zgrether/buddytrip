-- ════════════════════════════════════════════════════════════════════════════
-- 169 · `live_results` leaves games.competition_format
--
-- Reverses the tail of migration 050, which introduced the value, and narrows
-- the list 114 last rewrote. 050 enumerated five formats as a forward-looking
-- set — "a MANUAL descriptor that drives the leaderboard label; it does not run
-- in-app" — and that was reasonable when nothing resolved the column to an
-- engine. It does now (`resolveResultStrategy`, migration 114's `bracket`), so
-- a value naming a feature that was never built is a string the database
-- asserts and the app cannot honour.
--
-- APPLY ONLY AFTER 168, and only after confirming zero rows hold the value —
-- the ADD CONSTRAINT below validates existing rows, so it will refuse outright
-- if one still does. That refusal is the point; see 168's header for why the
-- two are separate files and why CI cannot exercise this.
--
-- ── Why this is a DROP and not a rename to 'matches' ───────────────────────
-- The Matches format takes the tile's SLOT in the picker, not its VALUE. A
-- string that reads `live_results` and means "head to head matches across
-- teams" is the class of lie this project has spent weeks removing, and this
-- column is no longer cosmetic — `resolveResultStrategy` branches on it, so the
-- lie would be load-bearing. `matches` arrives as its own value in its own
-- migration.
--
-- Reusing it would also have been silently destructive in a way worth
-- recording: the one game holding `live_results` is COMPLETE, and it finalized
-- through the manual arm. Had the value been repurposed, that game would stop
-- resolving to the arm that produced its two result rows the next time anything
-- re-finalized it.
--
-- ── The legacy bracket values STAY, and this one does NOT ──────────────────
-- Not an inconsistency. `bracket_se` / `bracket_de` are kept because rows still
-- hold them and every non-golf save re-sends its whole config, so refusing them
-- would make an untouched pre-collapse game unsaveable on a field nobody went
-- near (114's reasoning, unchanged). After 168 that argument does not apply
-- here: no row holds `live_results`, so nothing re-sends it, so there is
-- nothing to keep it accepted FOR.
--
-- Which is also why `formatLabel` gains no entry. It carries display fallbacks
-- for values that still exist in the data; this one no longer does. (Separately
-- and worth knowing: `formatLabel` currently has zero importers — dead, and
-- filed as its own cleanup rather than fixed in passing here.)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_competition_format_check;

ALTER TABLE public.games ADD CONSTRAINT games_competition_format_check
  CHECK (competition_format IS NULL OR competition_format IN
    ('head_to_head', 'bracket', 'best_of_n',
     -- Legacy, read-accepted only: rows still hold these. See the header for
     -- why `live_results` is NOT among them.
     'bracket_se', 'bracket_de'));

COMMENT ON COLUMN public.games.competition_format IS
  'Per-game "How''s it played?" choice (head_to_head | bracket | best_of_n). '
  'Read by resolveResultStrategy together with the game type to pick the '
  'finalize engine, so it is no longer a purely cosmetic label. NULL until '
  'chosen, and also what the reset primitives write. bracket_se/bracket_de are '
  'LEGACY values from before single/double became a setting inside one Bracket '
  'format — still accepted so pre-collapse rows stay saveable, never offered. '
  'live_results was removed in migration 169 after its one row was repointed '
  'to head_to_head (168): the feature was never built and the value now has no '
  'rows to keep it accepted for.';
