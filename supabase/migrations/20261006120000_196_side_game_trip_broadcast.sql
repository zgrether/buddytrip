-- 196 — a SIDE game broadcasts too, on its TRIP's topic (#1498).
--
-- ── The gap ──────────────────────────────────────────────────────────────────
-- `broadcast_score_event` (last redefined in 189) returned early for a game with
-- no competition, with the comment "STANDALONE GAMES: there is no board to
-- update". That was true until PR 6b (#1497): a game with no competition is now
-- a SIDE game, listed on the trip's Games page, and that page is exactly the
-- board it said did not exist. So a practice round scored on four phones updated
-- nobody else's screen until they saved, navigated back, or the 5-minute
-- backstop fired.
--
-- This reverses 189's early return (Migration Workflow, step 5), and 189's own
-- reasoning is why: it was written for a game with nowhere to be shown.
--
-- ── What changes ────────────────────────────────────────────────────────────
-- A game with no competition sends the SAME event (`score_changed`) with the
-- SAME kind rule, on `trip_events:<tripId>`. A cup game is untouched: same topic,
-- same payload, same everything.
--
--   * New prefix, `trip_events:`. `competition:<tripId>` is owned by
--     useRealtimeCompetition (the competition ROW), and `competition_events:` is
--     keyed by COMPETITION id. A trip-keyed score topic gets its own name rather
--     than a second id space inside either.
--   * The payload is `{gameId, tripId, kind}`: a signal, never data, exactly as
--     the cup payload is. The topic is public (`private => false`, CLAUDE.md #20),
--     so this is what an unauthenticated listener gets. `tripId` tells them
--     nothing they did not need to know to subscribe.
--   * The trip id is read off the row when the trigger is on `games` (the only
--     way it works for a DELETED game, which has no row left to look up), and
--     from `games` otherwise, in the same lookup that already read the
--     competition. No second query on the common path.
--   * A game that cannot be found (a result row outliving its game in a cascade)
--     still sends nothing: without a trip there is no topic.
--
-- Unchanged: a broadcast failure never rolls back a write (the WHEN OTHERS arm),
-- and no trigger is dropped or recreated.
--
-- Additive, idempotent (CREATE OR REPLACE), replayable from zero, no
-- environment-specific ids. Lands and is pushed to production before any client
-- subscribes to the new topic; an old client simply never listens to it.

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
  v_trip_id        text;
  v_kind           text;
BEGIN
  -- NEW on INSERT/UPDATE, OLD on DELETE.
  v_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
  v_game_id := v_row ->> TG_ARGV[0];
  IF v_game_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A `games` row carries its own trip; read it off the row (196). This is the
  -- only way a DELETED side game can still say which trip's board it left.
  IF TG_TABLE_NAME = 'games' THEN
    v_trip_id := v_row ->> 'trip_id';
  END IF;

  IF TG_NARGS > 1 THEN
    -- Read it off the row. The ONLY way this works for a deleted game, and it is
    -- also strictly cheaper than the lookup where the column is present.
    v_competition_id := v_row ->> TG_ARGV[1];
  ELSE
    SELECT g.competition_id, COALESCE(v_trip_id, g.trip_id)
      INTO v_competition_id, v_trip_id
      FROM public.games g WHERE g.id = v_game_id;
  END IF;

  -- The KIND of change, from the trigger's own table and nothing on the row
  -- (#1284). Two literals only: the payload stays a signal.
  v_kind := CASE WHEN TG_TABLE_NAME = 'games' THEN 'game' ELSE 'score' END;

  -- SIDE GAMES (196): no competition, so the board to update is the TRIP's Games
  -- page. Must stay in sync with `tripEventsTopic()` in useRealtimeScoreEvents.ts.
  IF v_competition_id IS NULL THEN
    IF v_trip_id IS NULL THEN
      RETURN NULL;
    END IF;
    PERFORM realtime.send(
      jsonb_build_object('gameId', v_game_id, 'tripId', v_trip_id, 'kind', v_kind),
      'score_changed',
      'trip_events:' || v_trip_id,
      false  -- public topic; safe ONLY because the payload carries no data
    );
    RETURN NULL;
  END IF;

  -- TOPIC PREFIX IS LOAD-BEARING: `competition:<tripId>` is ALREADY TAKEN by
  -- useRealtimeCompetition, which watches the competition ROW and is keyed by
  -- TRIP id. This is keyed by COMPETITION id, so it gets its own prefix rather
  -- than overloading one topic namespace with two id spaces and two meanings.
  -- Must stay in sync with `scoreEventsTopic()` in useRealtimeScoreEvents.ts.
  PERFORM realtime.send(
    jsonb_build_object('gameId', v_game_id, 'competitionId', v_competition_id, 'kind', v_kind),
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
