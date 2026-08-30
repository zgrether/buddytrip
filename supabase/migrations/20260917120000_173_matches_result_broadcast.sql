-- ════════════════════════════════════════════════════════════════════════════
-- 173 · A Matches RESULT reaches the other devices (and the writer's own board)
--
-- Feedback: "the projection on the leaderboard doesn't update when you change
-- a match result." Traced, not guessed — `liveProjection.ts`'s Matches branch
-- reads `game_matches.result` fresh on every `competitions.leaderboard` call,
-- so the projection IS driven by the persisted write, never local/optimistic
-- state. What was missing is a way for that write to tell anyone the
-- leaderboard needs re-reading at all.
--
-- `matches.setResult` invalidates `matches.listByGame` client-side (the game
-- page's own header projection, #533 row 2), but nothing invalidates
-- `competitions.leaderboard` / `faceBootstrap` — and, unlike golf's
-- `score_entries` / `match_hole_outcomes` (migration 096) or a bracket pick
-- (`bracket_matches`, migration 118), `game_matches` carries NO broadcast
-- trigger at all. So the only thing that ever refreshes the board is the 20s
-- `configHash` poll picking up an UNRELATED change, or (per CLAUDE.md #16's
-- landmine list) nothing — `game_matches.result` is deliberately EXCLUDED from
-- the config hash for the same reason a bracket pick is (a score, not config;
-- hashing it would refetch every open device's whole config on every tap).
--
-- ── Same shape as 118, on purpose ────────────────────────────────────────────
-- A Matches result IS a bracket pick's structural sibling: one row, one
-- decided-outcome column, written directly rather than derived from holes.
-- 118's own reasoning — "the pick is a SCORE for propagation purposes, and
-- scores propagate by broadcast (#20)" — applies to this column verbatim, so
-- this trigger is that one's UPDATE guard rewritten for `game_matches.result`
-- rather than `bracket_matches.winner_entrant_id`. Reuses
-- `broadcast_score_event`, unchanged, for all four of #20's properties (signal
-- not data, public topic + tRPC re-auth, never rolls back the write, standalone
-- games early-return).
--
-- ── WHEN-guarded on `result` alone ───────────────────────────────────────────
-- `game_matches` is also written by `save_game_config`'s clean-replace rebuild
-- (DELETE + INSERT, migration 170/171) and by its FIELDS-only branch
-- (`point_value` in place). INSERT stays silent — a rebuild's pairing already
-- propagates via `configHash` (`side_a`/`side_b` ARE hashed, unlike a pick),
-- and firing per-row on an N-match rebuild would broadcast N times for a
-- change the hash already covers, exactly the failure 118 avoided for the
-- draw's own rebuild. A `point_value` edit alone leaves `result` unchanged, so
-- the WHEN guard excludes it — that value already rides the hash too.
--
-- Clearing a result (a de-select, `matches.setResult`'s nullable arm) is a
-- real change and IS broadcast — same as clearing a bracket pick: it un-decides
-- what the board is showing, which is exactly what other devices need to hear
-- about, and exactly what made the local repro of this feedback item show a
-- stale "still decided" projection after an unselect until the next poll.
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS game_matches_result_broadcast ON public.game_matches;
CREATE TRIGGER game_matches_result_broadcast
  AFTER UPDATE ON public.game_matches
  FOR EACH ROW
  WHEN (OLD.result IS DISTINCT FROM NEW.result)
  EXECUTE FUNCTION public.broadcast_score_event('game_id');
