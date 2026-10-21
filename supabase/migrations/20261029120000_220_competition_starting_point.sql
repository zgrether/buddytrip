-- 220 · A competition remembers the starting point it was created from, and the
-- suggested games its organizers skipped.
--
-- Starting points (roadmap Next item 1, Zach's rulings on the mockup,
-- 2026-10-21): "Start a Competition" offers named starting points — Team cup
-- weekend, Golf week, Bar-night bracket — each of which sets up the competition
-- and suggests its games. After creating, the suggested games sit in the games
-- list as rows to Add or skip (✕).
--
-- What is STORED, and why only this:
--   · starting_point — which starting point made this competition. The
--     suggestions themselves are derived from it by the app's catalog
--     (src/lib/startingPoints.ts), never copied here, so improving a starting
--     point's suggestions needs no data migration.
--   · skipped_suggestions — the suggestions an organizer dismissed with ✕. A
--     suggestion counts as ADDED once a game of its format exists, so that half
--     needs no storage; a skip has nothing else to show it, and a skip kept on
--     one device would come back on reload and on every other organizer's
--     phone (Zach's ruling: store it on the competition).
--
-- Each entry of skipped_suggestions is a suggestion's key from that catalog: the
-- format's game type id, plus ':<competition_format>' when the suggestion sets
-- one (a bracket). Keys are data the app reads; the database only keeps them.
--
-- starting_point is NULL for a competition built with "Build your own", and for
-- every competition created before this migration. "Just keep score" makes a
-- side game, not a competition, so it never appears here. Pick'em pool is held
-- until per-person results exist; adding it later is one more value below.
--
-- The CHECK keeps the stored values honest for every writer, the service role
-- and test fixtures included (CLAUDE.md: only a rule enforced in the database
-- keeps fixtures honest).
--
-- Additive and replayable from zero. No grants: these are columns on an existing
-- table, covered by its grants and row policies (an organizer already updates
-- the competition row).

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS starting_point text,
  ADD COLUMN IF NOT EXISTS skipped_suggestions text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_starting_point_known;
ALTER TABLE public.competitions ADD CONSTRAINT competitions_starting_point_known
  CHECK (starting_point IS NULL OR starting_point IN ('team_cup_weekend', 'golf_week', 'bar_night_bracket'));
