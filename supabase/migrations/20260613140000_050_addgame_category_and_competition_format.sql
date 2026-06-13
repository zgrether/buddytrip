-- 050 — Slice D add-game flow, Stage 5 (UI data): type categories + per-game
-- competition format.
--
-- 1. game_type_templates.category — the data-driven Type tier the creation page
--    shows (Golf / Card / Yard / Bar / Other). Keeps the UI from hardcoding the
--    type list (CLAUDE.md). Golf types carry an engine; the non-golf categories
--    each offer a single "Generic <Type> Game" (no engine yet → results entered
--    by hand; the manual-ness is implied, never a named "Manual" choice — §1).
--
-- 2. games.competition_format — the per-game "How's it played?" choice
--    (head_to_head / bracket_se / bracket_de / best_of_n / live_results). It is a
--    MANUAL label/how-it's-played descriptor that drives the leaderboard label;
--    it never runs in-app (picking one never leaves you stuck on "coming soon").
--    Nullable — unset until chosen on the Configuration tab.
--
-- Idempotent.

-- ── 1. category ──────────────────────────────────────────────────────────────
ALTER TABLE public.game_type_templates ADD COLUMN IF NOT EXISTS category text;

COMMENT ON COLUMN public.game_type_templates.category IS
  'Creation Type tier: golf | card | yard | bar | other. Golf types carry an '
  'engine; non-golf categories offer a single generic (manual-scored) game.';

UPDATE public.game_type_templates SET category = 'golf'
 WHERE id IN ('gtt_stroke_play', 'gtt_match_play_singles', 'gtt_rack_n_stack');
UPDATE public.game_type_templates SET category = 'other', name = 'Generic Game'
 WHERE id = 'gtt_manual';

-- Generic non-golf games — one per category, no engine, no scorecard.
INSERT INTO public.game_type_templates (id, key, name, description, category, sort_order)
VALUES
  ('gtt_generic_card', 'generic_card', 'Generic Card Game',
   'No built-in scoring engine — name it and enter the result by hand.', 'card', 90),
  ('gtt_generic_yard', 'generic_yard', 'Generic Yard Game',
   'No built-in scoring engine — name it and enter the result by hand.', 'yard', 91),
  ('gtt_generic_bar',  'generic_bar',  'Generic Bar Game',
   'No built-in scoring engine — name it and enter the result by hand.', 'bar',  92)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      category = EXCLUDED.category, sort_order = EXCLUDED.sort_order;

-- ── 2. competition_format ────────────────────────────────────────────────────
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS competition_format text;

DO $$ BEGIN
  ALTER TABLE public.games ADD CONSTRAINT games_competition_format_check
    CHECK (competition_format IS NULL OR competition_format IN
      ('head_to_head', 'bracket_se', 'bracket_de', 'best_of_n', 'live_results'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.games.competition_format IS
  'Per-game "How''s it played?" label (head_to_head | bracket_se | bracket_de | '
  'best_of_n | live_results). A MANUAL descriptor that drives the leaderboard '
  'label; it does not run in-app. NULL until chosen.';
