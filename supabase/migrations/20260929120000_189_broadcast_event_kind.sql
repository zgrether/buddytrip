-- 189 — the score-event broadcast says WHICH KIND of change fired (#1284).
--
-- ── The gap ──────────────────────────────────────────────────────────────────
-- One function (`broadcast_score_event`, last redefined in 109) serves every
-- board trigger: `score_entries`, `match_hole_outcomes`, `game_results`,
-- `game_matches` (173), `bracket_matches` (118), `pickem_slate_games` (160), and
-- the `games` insert / delete / lifecycle triggers (096, 109, 110). Every one of
-- them sent the same event and the same `{gameId, competitionId}` payload, so a
-- client could not tell a hole score from a go-live, a finalize or a reorder —
-- and had to refetch the union of everything any of them could have changed, on
-- every one of them.
--
-- The database already draws that line precisely: 096 guards the `games` UPDATE
-- trigger to the columns that move the board. This stops throwing the
-- distinction away on the way out.
--
-- ── What is added: one field, and it is a SIGNAL TYPE, not data ─────────────
-- `kind` is `'game'` when the change was to a `games` row, `'score'` for every
-- other table. It is chosen from `TG_TABLE_NAME` — a property of the TRIGGER,
-- never read from the row — so it can only ever be one of those two literals.
-- The topic is public (`private => false`, CLAUDE.md #20), so this is what an
-- unauthenticated listener receives; `kind` tells them strictly less than the
-- existing event already does (it names neither a score, a team nor a player).
--
-- Two kinds rather than a kind per table: the client needs to know whether the
-- GAME ROW moved (which is what `competitions.faceBootstrap` carries), not which
-- result table moved. A finer split can be added the same way when a reader
-- needs it; a coarser one could not be recovered.
--
-- ── Compatibility, both directions of a deploy ──────────────────────────────
-- The event name is unchanged (`score_changed`) and so is everything else in the
-- payload. A client from before this migration ignores the new field. A client
-- written for it must treat an ABSENT or UNKNOWN `kind` as "anything could have
-- changed" — today's behaviour — which is what it does (see
-- `makeScoreEventHandler`). This migration lands and is pushed to production
-- BEFORE any client reads the field (Migration Workflow, step 3).
--
-- Additive, idempotent (CREATE OR REPLACE), replayable from zero, no
-- environment-specific ids. No trigger is dropped or recreated.

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
  v_kind           text;
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

  -- STANDALONE GAMES: there is no board to update, so emit nothing and return
  -- quietly. This path must stay cheap — it runs on every standalone score write.
  IF v_competition_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The KIND of change, from the trigger's own table and nothing on the row
  -- (#1284). Two literals only: the payload stays a signal.
  v_kind := CASE WHEN TG_TABLE_NAME = 'games' THEN 'game' ELSE 'score' END;

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
