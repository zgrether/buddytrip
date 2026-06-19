-- games.competition_id: add the missing FK with ON DELETE SET NULL.
--
-- Migration 033 added games.competition_id as a plain text column with the FK
-- deferred ("FK added in the competition slice") — and it was never added. So
-- teams / team_assignments CASCADE when a competition is deleted, but its GAMES
-- were left with a dangling competition_id pointing at a row that no longer
-- exists (the orphaned-competition bug: a 2v2 game whose competition was deleted
-- still claimed that dead id).
--
-- Desired behavior: deleting a competition DETACHES its games (they become
-- standalone trip games) rather than vanishing (CASCADE would discard a played
-- round + its scores) or dangling. competition_id is already nullable, so
-- ON DELETE SET NULL is the right action.

-- 1) Clean existing orphans so the constraint can validate.
UPDATE games g
  SET competition_id = NULL
  WHERE competition_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM competitions c WHERE c.id = g.competition_id);

-- 2) Add the FK (idempotent: drop any prior version first).
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_competition_id_fkey;
ALTER TABLE games
  ADD CONSTRAINT games_competition_id_fkey
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE SET NULL;
