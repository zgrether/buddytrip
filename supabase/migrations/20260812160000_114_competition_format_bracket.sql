-- ════════════════════════════════════════════════════════════════════════════
-- 114 · games.competition_format accepts 'bracket'
--
-- The two bracket entries (`bracket_se` / `bracket_de`) collapsed into one
-- `bracket` — single vs double is a SETTING inside the format, not a separate
-- format. The picker and the TypeScript union moved; this is the third place
-- those values are enumerated, and it did not.
--
-- ── Why this is its own migration, found by CI ─────────────────────────────
-- Worth recording plainly: the value list lives in THREE places — the picker
-- (`COMP_FORMATS`), the zod/TS union (`COMPETITION_FORMATS`), and this CHECK
-- constraint. Changing the first two type-checks perfectly and passes every
-- local test, because the constraint is in the database and the database is
-- what this container does not have. CI caught it on the second run.
--
-- The general shape is the same one CLAUDE.md records for RLS strings: a value
-- the DATABASE branches on cannot be verified by `tsc`, so it has to be found by
-- running against a real schema.
--
-- ── The legacy values STAY accepted ────────────────────────────────────────
-- `bracket_se` / `bracket_de` are no longer OFFERED, but rows written before the
-- collapse still hold them, and every non-golf save re-sends the whole config.
-- Dropping them from the CHECK would make an untouched pre-collapse bracket game
-- unsaveable — failing on a field the user never went near. They are read-
-- accepted here for the same reason the zod accepts them and `formatLabel` still
-- resolves them.
--
-- No data migration. Rewriting existing rows to 'bracket' would be a DELETE/
-- UPDATE keyed on environment-specific state, which CI's replay-from-zero
-- explicitly forbids (the `044` lesson) — and it buys nothing, since both old
-- values already display as "Bracket".
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_competition_format_check;

ALTER TABLE public.games ADD CONSTRAINT games_competition_format_check
  CHECK (competition_format IS NULL OR competition_format IN
    ('head_to_head', 'bracket', 'best_of_n', 'live_results',
     -- Legacy, read-accepted only. See the header.
     'bracket_se', 'bracket_de'));

COMMENT ON COLUMN public.games.competition_format IS
  'Per-game "How''s it played?" label (head_to_head | bracket | best_of_n | '
  'live_results). A MANUAL descriptor that drives the leaderboard label; it does '
  'not run in-app. NULL until chosen. bracket_se/bracket_de are LEGACY values '
  'from before single/double became a setting inside one Bracket format — still '
  'accepted so pre-collapse rows stay saveable, never offered.';
