-- ─────────────────────────────────────────────────────────────────────────────
-- 100 · write_game_results — the ATOMIC results writer (#776)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every scoring engine persists its results as a DELETE followed by an INSERT:
--
--   matchPlay.ts:216/219 + :222   (user/play_group rows, two delete scopes)
--   matchPlay.ts:367 + :383       (team rows, entity_type-scoped delete)
--   strokePlay.ts:61 + :63        (user rows)
--   rackNStack.ts:115 + :128      (team rows)
--
-- Those are separate PostgREST requests, so they cannot share a transaction —
-- supabase-js has no transaction API, which is what makes an RPC the only way to
-- express this. Two problems follow, and BOTH are fixed by committing the pair
-- together rather than by checking errors:
--
--  1. DATA LOSS, not just a silent failure. A committed delete followed by a
--     failed insert leaves the game with FEWER results than it started with.
--     The table does not go stale — it goes EMPTY, and the UI reads that as
--     "no results yet". Checking the error makes that loud; it does not make it
--     safe, because the delete already committed.
--
--  2. AN EMPTY-READ WINDOW ON THE HAPPY PATH. This is the part that is not a
--     failure mode at all. Migration 096 put a trigger on this table:
--         AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW
--     so the DELETE emits one broadcast PER ROW on `competition_events:{id}`,
--     and `useRealtimeScoreEvents` turns each into "invalidate and refetch the
--     leaderboard" — all BEFORE the insert has run. `competitionLeaderboard.ts`
--     reads `game_results` directly. So on every finalize, working perfectly,
--     the app tells every connected client to go read a table it has just
--     emptied. Inside one transaction the deleted-then-reinserted state is never
--     externally visible, and the triggers fire at COMMIT — so the window closes.
--
-- ── Design A — dumb transactional writer (the save_game_config rule, 081) ─────
-- The CALLER pre-computes every derived value; this function only writes. No
-- scoring, ranking, or margin logic lives in SQL. That is deliberate and load-
-- bearing: CLAUDE.md #8 requires the pure scoring to stay in the client-safe TS
-- modules so the live strip and the persisted record cannot diverge. Moving any
-- of it here would break that. This function is the write, and nothing else.
--
-- ── Precedent ────────────────────────────────────────────────────────────────
-- `_reset_game_scoring` (066) already does exactly this table's DELETE plus the
-- `game_matches` result-column UPDATE atomically, with an un-guarded core and a
-- guarded public wrapper. This follows that split rather than inventing one, and
-- folds in the same second table for the same reason: correct results next to a
-- half-updated match set is a NEW inconsistency replacing the old one.
--
-- Additive, idempotent, replayable from zero, no environment-specific ids.

-- ── The un-guarded core ──────────────────────────────────────────────────────
-- p_scope selects which existing rows this write replaces. The three engines
-- delete differently and that difference is REAL, not incidental:
--   'all'          → every row for the game        (stroke :61, rack :115, match :219)
--   'entity_ids'   → only the listed entities      (match :216, the skipComplete
--                    freeze boundary — a complete match's rows must survive)
--   'entity_type'  → only rows of one entity_type  (match :367, team rows only,
--                    which must not disturb the user/play_group rows written
--                    moments earlier in the same finalize)
--
-- p_rows is the full replacement set as jsonb, already shaped by the caller.
-- An EMPTY p_rows is legitimate and means "clear": strokePlay has no early
-- return, so computing an empty game deletes its results and inserts nothing.
-- That is existing behaviour and is preserved exactly — this is not a no-op.
--
-- p_match_updates carries match play's per-match result columns (id + result +
-- margin + status), folded in so the whole derived state of a game commits
-- together. Empty/null for every other format.
CREATE OR REPLACE FUNCTION public._write_game_results(
  p_game_id        text,
  p_rows           jsonb DEFAULT '[]'::jsonb,
  p_scope          text  DEFAULT 'all',
  p_entity_ids     text[] DEFAULT NULL,
  p_entity_type    text  DEFAULT NULL,
  p_match_updates  jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_game_id IS NULL THEN
    RAISE EXCEPTION 'GAME_ID_REQUIRED' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Reject an unknown scope rather than silently defaulting to 'all' — a typo
  -- that fell through to 'all' would delete rows the caller meant to preserve
  -- (the skipComplete freeze boundary is exactly that case).
  IF p_scope NOT IN ('all', 'entity_ids', 'entity_type') THEN
    RAISE EXCEPTION 'UNKNOWN_SCOPE:%', p_scope USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 1 · Per-match result columns (match play only) ─────────────────────────
  -- Before the results replace, so one transaction covers the whole derived
  -- state. Pairings (side_a/side_b) are untouched — only the three result
  -- columns, matching what _reset_game_scoring resets.
  IF p_match_updates IS NOT NULL AND jsonb_array_length(p_match_updates) > 0 THEN
    UPDATE public.game_matches gm
       SET result = u.result,
           margin = u.margin,
           status = u.status
      FROM jsonb_to_recordset(p_match_updates)
             AS u(id text, result text, margin text, status text)
     WHERE gm.id = u.id
       AND gm.game_id = p_game_id;   -- scope guard: never touch another game's rows
  END IF;

  -- ── 2 · Replace the results in the selected scope ──────────────────────────
  IF p_scope = 'all' THEN
    DELETE FROM public.game_results WHERE game_id = p_game_id;
  ELSIF p_scope = 'entity_ids' THEN
    -- NULL/empty list deletes nothing — matches the caller's existing
    -- `if (processedEntities.length > 0)` guard.
    IF p_entity_ids IS NOT NULL AND array_length(p_entity_ids, 1) > 0 THEN
      DELETE FROM public.game_results
       WHERE game_id = p_game_id AND entity_id = ANY(p_entity_ids);
    END IF;
  ELSE  -- 'entity_type'
    IF p_entity_type IS NULL THEN
      RAISE EXCEPTION 'ENTITY_TYPE_REQUIRED' USING ERRCODE = 'null_value_not_allowed';
    END IF;
    DELETE FROM public.game_results
     WHERE game_id = p_game_id AND entity_type = p_entity_type;
  END IF;

  IF p_rows IS NOT NULL AND jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO public.game_results
      (id, game_id, entity_id, entity_type, raw_score, position, points, competition_points_earned)
    SELECT
      r.id,
      p_game_id,                      -- always the RPC's game, never the payload's
      r.entity_id,
      r.entity_type,
      r.raw_score,
      r.position,
      r.points,
      r.competition_points_earned
    -- raw_score is NUMERIC, not integer. Migration 048 widened it precisely so a
    -- halved match can award a half point; typing it `integer` here would
    -- silently truncate 2.5 to 2 and quietly corrupt every match-play team
    -- tally — the exact class of invisible failure this migration exists to
    -- close. Types here must track the table, not the original 033 shape.
    FROM jsonb_to_recordset(p_rows) AS r(
      id                        text,
      entity_id                 text,
      entity_type               text,
      raw_score                 numeric,
      position                  integer,
      points                    numeric,
      competition_points_earned numeric
    );
  END IF;
END;
$$;

-- ── The guarded public wrapper ───────────────────────────────────────────────
-- `assert_game_edit` (081) is the requireGameEdit equivalent: trip Owner/
-- Organizer OR this game's delegate. That is the same gate every caller of this
-- already runs behind at the tRPC layer (`requireGameEdit` on games.finish /
-- saveConfig / the matches setup mutations), so this is defence in depth rather
-- than a new permission boundary — deliberately NOT assert_game_owner, which
-- would be narrower than the procedures that call it and would break a delegate
-- finishing their own game.
CREATE OR REPLACE FUNCTION public.write_game_results(
  p_game_id        text,
  p_rows           jsonb DEFAULT '[]'::jsonb,
  p_scope          text  DEFAULT 'all',
  p_entity_ids     text[] DEFAULT NULL,
  p_entity_type    text  DEFAULT NULL,
  p_match_updates  jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_game_edit(p_game_id);
  PERFORM public._write_game_results(
    p_game_id, p_rows, p_scope, p_entity_ids, p_entity_type, p_match_updates
  );
END;
$$;

-- The core stays revoked from clients: it skips the permission assert, so a
-- direct grant would let any authenticated user rewrite any game's results.
-- Same reasoning as `link_guest_to_account` wrapping the guest merge.
REVOKE ALL ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.write_game_results(text, jsonb, text, text[], text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.write_game_results(text, jsonb, text, text[], text, jsonb) IS
  'Atomic game_results replace (+ match-play result columns) for #776. The caller '
  'pre-computes every value (Design A, per save_game_config); this only writes. '
  'Committing the delete and insert together is what closes BOTH the data-loss '
  'window on a failed insert AND the empty-read window that migration 096''s '
  'per-row broadcast opens on every finalize.';
