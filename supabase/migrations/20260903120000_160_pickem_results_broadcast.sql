-- 160 — pick'em results reach other devices.
--
-- ══ What was broken, and it is live ════════════════════════════════════════
--
-- Results land in `pickem_slate_games.result` (migration 159). That table is in
-- NEITHER of the two mechanisms that move a change to another screen:
--
--   * not in the `supabase_realtime` publication, so `useRealtimeGame`'s
--     postgres_changes cannot see it — the GAME PAGE never learns
--   * not on `broadcast_score_event`, so `useRealtimeScoreEvents` never fires —
--     the BOARD never learns
--
-- Sixteen people watch this while games resolve. A board that only updates on
-- refresh is #1042 in a new place, and the half-working version is worse than
-- neither updating: the matches would move and the totals would not, which
-- looks like the board is working.
--
-- ══ The UPDATE is guarded on `result`, deliberately ════════════════════════
--
-- Same reasoning as the `games` lifecycle trigger's WHEN clause: without a
-- guard, every slate edit would broadcast. Fixing a team name or a kickoff time
-- moves nothing on the board, and a trip's worth of those would be pure noise
-- on a public topic.
--
--   INSERT  no broadcast. A new slate game has no result, so no total moves.
--   UPDATE  only when `result` actually changes.
--   DELETE  only when the row HAD a result — removing a scored game changes
--           every total that counted it.
--
-- ══ The payload stays a SIGNAL ═════════════════════════════════════════════
--
-- `broadcast_score_event` sends `{gameId, competitionId}` and nothing else, on
-- a PUBLIC topic. That is what makes it safe: an unauthenticated listener
-- learns two ids it would need to already know to care about, and the client's
-- tRPC refetch is what re-applies auth. Putting a result in the payload would
-- break that AND the reconcile path at once — see CLAUDE.md #20.

-- ── The game page: postgres_changes needs the table published ───────────────

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pickem_slate_games;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A DELETE filtered by `game_id` only reaches subscribers if the OLD row
-- carries that column — the same reason migration 084 set this on
-- game_matches / game_participants / play_groups. Removing a game from the
-- slate is a real edit and the other devices have to see it.
ALTER TABLE public.pickem_slate_games REPLICA IDENTITY FULL;

-- ── The board: the broadcast trigger ───────────────────────────────────────

DROP TRIGGER IF EXISTS pickem_slate_result_broadcast ON public.pickem_slate_games;

CREATE TRIGGER pickem_slate_result_broadcast
AFTER UPDATE ON public.pickem_slate_games
FOR EACH ROW
WHEN (OLD.result IS DISTINCT FROM NEW.result)
EXECUTE FUNCTION public.broadcast_score_event('game_id');

DROP TRIGGER IF EXISTS pickem_slate_scored_delete_broadcast ON public.pickem_slate_games;

CREATE TRIGGER pickem_slate_scored_delete_broadcast
AFTER DELETE ON public.pickem_slate_games
FOR EACH ROW
WHEN (OLD.result IS NOT NULL)
EXECUTE FUNCTION public.broadcast_score_event('game_id');

COMMENT ON TRIGGER pickem_slate_result_broadcast ON public.pickem_slate_games IS
  'Tells the competition board a pick''em result moved, on topic competition_events:{competitionId} (migration 160). Guarded on `result` so a slate edit — a team name, a kickoff — does not broadcast; without it every settings save would. Payload is {gameId, competitionId} and nothing else: the topic is public, so the client''s tRPC refetch is what re-applies auth (CLAUDE.md #20).';
