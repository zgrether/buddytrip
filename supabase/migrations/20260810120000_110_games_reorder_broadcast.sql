-- 110 — a REORDER reaches other clients too.
--
-- ── The gap ──────────────────────────────────────────────────────────────────
-- Migration 096's UPDATE trigger only fires for the three columns that already
-- moved the board:
--
--     WHEN (
--       OLD.status              IS DISTINCT FROM NEW.status
--       OR OLD.corrections_open IS DISTINCT FROM NEW.corrections_open
--       OR OLD.scoring_enabled  IS DISTINCT FROM NEW.scoring_enabled
--     )
--
-- `games.reorder` (this PR) writes `display_order` on every game in a
-- competition, and that column is not in the guard — so a reorder emits NO
-- broadcast at all, and every client except the one that dragged waits out the
-- 5-minute `LEADERBOARD_QUERY` backstop. Same shape as 109's gap (INSERT/DELETE
-- emitted nothing); this is the third and, with the WHEN clause now covering
-- every board-moving column that exists, the set should be complete.
--
-- ── Why extend the WHEN clause rather than add a fourth trigger ─────────────
-- Unlike 109's INSERT/DELETE gap, this one does NOT need the row-sourced
-- competition-id argument: on an UPDATE the row is still there, so the existing
-- `broadcast_score_event('id')` lookup-by-id path works unchanged. The only
-- change needed is teaching the WHEN clause about the new column — one more
-- `OR`, on the same trigger, reusing the exact reasoning 096 already established
-- for why a guard is required here at all (else every settings save broadcasts).
--
-- `display_order` moves on EVERY row `games.reorder` touches — a drag of N
-- games in a section is N row writes and N broadcasts, same shape as any other
-- multi-row lifecycle change already covered by this trigger.
--
-- Additive, idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS), replayable
-- from zero, no environment-specific ids.

DROP TRIGGER IF EXISTS games_lifecycle_broadcast ON public.games;
CREATE TRIGGER games_lifecycle_broadcast
  AFTER UPDATE ON public.games
  FOR EACH ROW
  WHEN (
    OLD.status           IS DISTINCT FROM NEW.status
    OR OLD.corrections_open IS DISTINCT FROM NEW.corrections_open
    OR OLD.scoring_enabled  IS DISTINCT FROM NEW.scoring_enabled
    OR OLD.display_order    IS DISTINCT FROM NEW.display_order
  )
  EXECUTE FUNCTION public.broadcast_score_event('id');
