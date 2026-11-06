-- 225 — a points cup's Final is now a person's decision, so cups that were
-- already over are marked finished.
--
-- docs/CLINCH_AND_PODIUM.md §5 (Zach, 2026-11-06): when a finish empties the
-- board, the cup waits for an Owner or Organizer to choose Finish the cup or Add
-- another game. An empty board cannot say which: a cup built one game at a time
-- empties after every game. So Final reads `competitions.status = 'completed'`,
-- which `competitions.update`'s comment reserved for this and which nothing has
-- written since the go-live control was removed.
--
-- Without this, a points cup that finished before the rule would drop out of
-- Final and ask to be finished, and answering would send a clinch push for a cup
-- that ended long ago. Those cups are over: nobody has anything left to decide.
--
-- Keyed on the cup's own state, so it replays from zero as a no-op. A game open
-- for correction is not finished, as `gamesRemaining` reads it.
UPDATE public.competitions c
   SET status = 'completed'
 WHERE c.scoring_model = 'points'
   AND c.status <> 'completed'
   AND EXISTS (SELECT 1 FROM public.games g WHERE g.competition_id = c.id)
   AND NOT EXISTS (
     SELECT 1 FROM public.games g
      WHERE g.competition_id = c.id
        AND (g.status <> 'complete' OR g.corrections_open)
   );

COMMENT ON COLUMN public.competitions.status IS
  'completed = an Owner or Organizer finished a points cup (docs/CLINCH_AND_PODIUM.md §5). A points cup reads it for Final; adding a game reopens it. Nothing else reads this column.';
