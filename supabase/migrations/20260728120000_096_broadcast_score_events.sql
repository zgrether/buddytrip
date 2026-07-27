-- 096 — Broadcast a SIGNAL on score/lifecycle writes, so the competition board
-- can stop polling.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- `competitions.leaderboard` polls every 30s PER CLIENT. Measured on prod: two
-- tabs ≈ 240 requests/hour. At BBMI (16 people watching a mostly-idle board)
-- that is ~1,900 requests/hour — ~61k serverless invocations across a weekend,
-- each one querying Postgres and running the live projection, almost all of them
-- to learn that nothing happened. Cost scaled with SPECTATORS, not with events.
--
-- Polling was also too slow for the product: a birdie could take 30s to appear
-- on a board whose whole job is conveying momentum.
--
-- This inverts it: the database announces that something changed, clients
-- invalidate and refetch. Cost now scales with scoring events (~72 per round).
--
-- ── SIGNAL ONLY. NEVER DATA. ─────────────────────────────────────────────────
-- The payload is {gameId, competitionId} and must stay that way.
--
-- Broadcast topics are NOT access-controlled here (`private => false`), so
-- anyone who guessed the topic receives whatever we put in the
-- payload. Two opaque ids tell them only that *something* changed; the client's
-- refetch still goes through tRPC, which re-enforces auth and RLS and returns
-- only what that viewer may see.
--
-- The tempting future "optimization" is: we already have the new score in the
-- event, so why refetch? DO NOT. That converts a safe signal into an
-- unauthenticated score feed. It would also break CLAUDE.md #15 — applying a
-- payload value would clobber the active enterer's in-flight cell, which the
-- outbox contract forbids. Invalidate-and-refetch is what keeps BOTH properties;
-- they fail together the moment data rides along.
--
-- ── Reply to migration 084 ───────────────────────────────────────────────────
-- 084 deliberately kept these tables OUT of the Realtime publication:
--   "Score tables (score_entries / match_hole_outcomes) are DELIBERATELY
--    excluded: scores have their own poll + outbox path (#15/#16) and are
--    high-frequency; this is config only."
-- That exclusion STANDS and this migration does not touch the publication —
-- broadcast is a different mechanism and needs no table publication at all.
-- The frequency objection also doesn't transfer: WAL-based `postgres_changes`
-- would have shipped a full row per write to every subscriber of every table,
-- whereas this emits one ~80-byte signal per scoring event (~4 scorers × 18
-- holes ≈ 72 per round) on ONE topic per competition. The outbox path 084
-- points at is preserved exactly — the client still reconciles through
-- `reconcileScores` with `protectedKeys`; this only replaces the 30s timer that
-- used to trigger it.
--
-- Additive + idempotent, replayable from zero, no environment-specific ids.

-- ── The emitter ──────────────────────────────────────────────────────────────
-- SECURITY DEFINER: realtime.send() writes to realtime.messages, and we do not
-- want delivery to depend on the writing role's grants there. Runs as owner.
--
-- The game-id column differs per table (`game_id` on the score tables, `id` on
-- games), so it is passed as a trigger argument and read out of the row's jsonb
-- — which also makes DELETE work, where NEW is null.
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

  SELECT g.competition_id INTO v_competition_id
    FROM public.games g WHERE g.id = v_game_id;

  -- STANDALONE GAMES ARE THE COMMON CASE, not an edge case: 42 of 104 games on
  -- production (40%) have no competition. There is no board to update, so emit
  -- nothing and return quietly. This path must stay cheap — it runs on most
  -- score writes in the system.
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
    -- A BROADCAST FAILURE MUST NEVER ROLL BACK A SCORE. Realtime being down,
    -- rate-limited, or misconfigured is an inconvenience; losing a hole someone
    -- just entered on a golf course is not recoverable. Swallow and carry on —
    -- the client's reconnect backstop (the lengthened leaderboard refetch, and
    -- the ~20s configHash poll) closes any gap this leaves.
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.broadcast_score_event() IS
  'AFTER-trigger emitter: sends a SIGNAL-ONLY {gameId, competitionId} broadcast on '
  'competition_events:<competitionId>. Never include score data — the topic is public '
  'and the client refetch is what re-enforces auth (and what preserves the #15 outbox '
  'contract).';

-- ── Score-data writes ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS score_entries_broadcast ON public.score_entries;
CREATE TRIGGER score_entries_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.score_entries
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_score_event('game_id');

DROP TRIGGER IF EXISTS match_hole_outcomes_broadcast ON public.match_hole_outcomes;
CREATE TRIGGER match_hole_outcomes_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.match_hole_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_score_event('game_id');

-- Final per-entity results — written by games.finish, and what the board's
-- banked totals are computed from.
DROP TRIGGER IF EXISTS game_results_broadcast ON public.game_results;
CREATE TRIGGER game_results_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.game_results
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_score_event('game_id');

-- ── Game lifecycle ───────────────────────────────────────────────────────────
-- Only the three columns that move the BOARD: go-live (scoring_enabled),
-- post/finalize (status), and re-open-for-correction (corrections_open).
-- Without this WHEN guard every settings save would broadcast, which is the
-- high-frequency behaviour 084 was right to avoid.
DROP TRIGGER IF EXISTS games_lifecycle_broadcast ON public.games;
CREATE TRIGGER games_lifecycle_broadcast
  AFTER UPDATE ON public.games
  FOR EACH ROW
  WHEN (
    OLD.status           IS DISTINCT FROM NEW.status
    OR OLD.corrections_open IS DISTINCT FROM NEW.corrections_open
    OR OLD.scoring_enabled  IS DISTINCT FROM NEW.scoring_enabled
  )
  EXECUTE FUNCTION public.broadcast_score_event('id');
