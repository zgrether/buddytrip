-- 109 — a game APPEARING or DISAPPEARING reaches other people's boards.
--
-- ── The gap ──────────────────────────────────────────────────────────────────
-- Migration 096 gave the leaderboard a push path for score and lifecycle changes
-- and replaced the 30s poll with a 5-minute dead-socket backstop
-- (`LEADERBOARD_QUERY`, `refetchInterval: 5 * 60_000`). Its games trigger is:
--
--     CREATE TRIGGER games_lifecycle_broadcast AFTER UPDATE ON public.games
--
-- UPDATE only. So a game being CREATED or DELETED emits nothing at all, and every
-- client except the one that did it waits up to FIVE MINUTES to find out. That is
-- the reported symptom — a new game not appearing on a member's board, "possibly
-- after a long delay", which is cache expiry rather than a push, because there is
-- no push.
--
-- 096 was right to guard UPDATE on the three columns that move the board
-- (otherwise every settings save would broadcast). Nothing in that reasoning
-- applies to INSERT or DELETE: a game appearing or vanishing is always
-- board-relevant, and both happen rarely.
--
-- ── Why DELETE could not simply be added to the existing trigger ─────────────
-- `broadcast_score_event` resolves the competition by LOOKING THE GAME UP:
--
--     SELECT g.competition_id INTO v_competition_id
--       FROM public.games g WHERE g.id = v_game_id;
--     IF v_competition_id IS NULL THEN RETURN NULL; END IF;
--
-- In an AFTER DELETE on `games` the row is already gone, so that lookup finds
-- nothing, the null-competition early return fires, and NO BROADCAST IS SENT.
-- Adding `OR DELETE` to the trigger would compile, run, and silently do nothing —
-- the failure mode this codebase keeps rediscovering. Measured directly, with a
-- throwaway AFTER DELETE trigger on a seeded game:
--
--     rows_visible=0, lookup=<NULL>, OLD.competition_id=probe-comp
--
-- The competition id IS on the row. So the emitter gains an OPTIONAL second
-- trigger argument naming the column to read it from, and the games triggers use
-- it. Existing triggers pass one argument and are unchanged in behaviour: with
-- TG_ARGV[1] absent the function falls back to the lookup exactly as before.
--
-- ── Scope ────────────────────────────────────────────────────────────────────
-- No WHEN guard on either new trigger: every insert and every delete of a game
-- moves the board. Standalone games (~40% of production) still cost nothing — a
-- NULL competition_id hits the same quiet early return it always has.
--
-- The existing `games_lifecycle_broadcast` (UPDATE) is left alone deliberately.
-- Its lookup works, because on an UPDATE the row is still there; changing it
-- would be churn without a defect behind it.
--
-- Cascade note: deleting a game also cascade-deletes its `score_entries` and
-- `game_results`, whose own 096 triggers fire and hit the same dead lookup. They
-- emit nothing, which is correct — the games DELETE trigger below is the one
-- signal for "this game is gone", rather than one per orphaned child row.
--
-- Additive, idempotent, replayable from zero, no environment-specific ids.

-- ── Emitter: optional row-sourced competition id ─────────────────────────────
-- TG_ARGV[0] — column holding the GAME id (unchanged).
-- TG_ARGV[1] — OPTIONAL column holding the COMPETITION id on the row itself.
--              Required for DELETE on `games`, where the lookup cannot work.
CREATE OR REPLACE FUNCTION public.broadcast_score_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_row            jsonb;
  v_game_id        text;
  v_competition_id text;
BEGIN
  -- NEW on INSERT/UPDATE, OLD on DELETE.
  v_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
  v_game_id := v_row ->> TG_ARGV[0];
  IF v_game_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_NARGS > 1 THEN
    -- Read it off the row. The ONLY way this works for a deleted game, and it is
    -- also strictly cheaper than the lookup where the column is present.
    v_competition_id := v_row ->> TG_ARGV[1];
  ELSE
    SELECT g.competition_id INTO v_competition_id
      FROM public.games g WHERE g.id = v_game_id;
  END IF;

  -- STANDALONE GAMES ARE THE COMMON CASE, not an edge case: ~40% of games on
  -- production have no competition. There is no board to update, so emit nothing
  -- and return quietly. This path must stay cheap — it runs on most score writes.
  IF v_competition_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- TOPIC PREFIX IS LOAD-BEARING: `competition:<tripId>` is ALREADY TAKEN by
  -- useRealtimeCompetition, which watches the competition ROW and is keyed by
  -- TRIP id. This is keyed by COMPETITION id, so it gets its own prefix rather
  -- than overloading one topic namespace with two id spaces and two meanings.
  -- Must stay in sync with `scoreEventsTopic()` in useRealtimeScoreEvents.ts.
  PERFORM realtime.send(
    jsonb_build_object('gameId', v_game_id, 'competitionId', v_competition_id),
    'score_changed',
    'competition_events:' || v_competition_id,
    false  -- public topic; safe ONLY because the payload carries no data
  );

  RETURN NULL; -- AFTER trigger: return value is ignored
EXCEPTION
  WHEN OTHERS THEN
    -- A BROADCAST FAILURE MUST NEVER ROLL BACK A WRITE. Realtime being down,
    -- rate-limited, or misconfigured is an inconvenience; losing the write is not.
    RETURN NULL;
END;
$$;

-- ── A game appears ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS games_insert_broadcast ON public.games;
CREATE TRIGGER games_insert_broadcast
  AFTER INSERT ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_score_event('id', 'competition_id');

-- ── A game disappears ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS games_delete_broadcast ON public.games;
CREATE TRIGGER games_delete_broadcast
  AFTER DELETE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_score_event('id', 'competition_id');
