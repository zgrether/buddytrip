-- 051 — Seed golf special rules into the game-type model (Slice D add-game).
--
-- The Configuration tab shows a SPECIAL RULES section for golf games, driven by
-- the game type's model: `game_type_templates.compatible_modifiers` lists which
-- optional rules apply to that format; the game stores the enabled ones (+ any
-- per-rule config) in `games.modifiers`. Both columns already exist — this only
-- seeds the available options (the per-rule configurability is intentionally
-- deferred; for now each is a simple on/off).
--
-- Match/team formats can shift tees (trailing team picks the box); all golf can
-- weight the closing holes. Idempotent.

UPDATE public.game_type_templates
   SET compatible_modifiers = ARRAY['moving_tees', 'glorious_holes']
 WHERE id IN ('gtt_match_play_singles', 'gtt_rack_n_stack');

UPDATE public.game_type_templates
   SET compatible_modifiers = ARRAY['glorious_holes']
 WHERE id = 'gtt_stroke_play';
