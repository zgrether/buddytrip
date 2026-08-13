-- ════════════════════════════════════════════════════════════════════════════
-- 118 · A bracket PICK reaches the other devices
--
-- Phase 3 slice 2 made `bracket_matches.winner_entrant_id` writable. Nothing
-- yet tells anyone else it moved, and — unlike every other config change on a
-- game — the ~20s `configHash` poll will not, BY DESIGN.
--
-- ── Why the poll can't cover this ──────────────────────────────────────────
-- `winner_entrant_id` is deliberately EXCLUDED from the config hash, and there
-- is a test in the 115 suite pinning that ("a WINNER does NOT move the hash — a
-- pick is a score, not config"). The reasons still hold: hashing a pick would
-- refetch every open device's whole config on each advance, AND it would make a
-- concurrent settings save fail its optimistic-concurrency check — refusing a
-- rename because someone recorded a result.
--
-- So the pick is a SCORE for propagation purposes, and scores propagate by
-- broadcast (#20). That entry says picks would arrive this way "in phase 3";
-- this is that.
--
-- ── Reuses `broadcast_score_event`, unchanged ──────────────────────────────
-- The function already takes the game-id column as `TG_ARGV[0]` and does the
-- rest generically: resolve the competition, early-return for a standalone game
-- (the COMMON case, ~40% of production), send `{gameId, competitionId}` on
-- `competition_events:<competitionId>`, and swallow its own failures so a
-- broadcast outage can never roll back the write.
--
-- Adding a trigger rather than a second function is the whole point. #20's rules
-- — payload is a SIGNAL and never data, topic is public so the client's tRPC
-- refetch is what re-applies auth, a failure must never roll back — are
-- properties of that ONE function. A bracket-specific copy would have to
-- re-derive all four, and would be the place they first drift.
--
-- ── WHEN-guarded on the pick alone ─────────────────────────────────────────
-- `bracket_matches` rows are also written by `save_game_config`'s draw rebuild,
-- which DELETEs and re-INSERTs the whole tree. Firing on that would broadcast
-- once per match for a change the config hash ALREADY covers (the draw's seats
-- are hashed, migration 115), so every device would refetch twice — once from
-- the hash mismatch and once per row of the rebuild. An 8-entrant draw would
-- emit 7 broadcasts for one edit.
--
-- So this fires on UPDATE only, and only when the winner actually changes. The
-- same discipline as 096's `games_lifecycle_broadcast`, whose header notes that
-- without its WHEN guard "every settings save would broadcast".
--
-- Clearing a pick (winner -> NULL) is a real change and IS broadcast: it
-- un-decides everything above it, which is precisely what other devices need to
-- be told about.
--
-- ── What this deliberately does NOT do ─────────────────────────────────────
-- INSERT and DELETE stay silent. Both only happen during a rebuild, which is
-- config, and config has its own path. A rebuild is refused outright once any
-- winner exists (HAS_PICKS), so there is no case where a pick disappears via
-- DELETE without the whole draw being replaced by an editor who is already
-- looking at it.
--
-- Known gap, recorded rather than fixed here: a draw REBUILD propagates only by
-- the ~20s configHash poll, because `bracket_matches` is not in the Realtime
-- publication (migration 084 predates the bracket tables). That is the same
-- backstop every other config change had before 084, and it is a setup-time
-- action rather than a mid-play one — but it is slower than the rest of the
-- config surface, and worth knowing before someone reports it as a bug.
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS bracket_matches_pick_broadcast ON public.bracket_matches;
CREATE TRIGGER bracket_matches_pick_broadcast
  AFTER UPDATE ON public.bracket_matches
  FOR EACH ROW
  WHEN (OLD.winner_entrant_id IS DISTINCT FROM NEW.winner_entrant_id)
  EXECUTE FUNCTION public.broadcast_score_event('game_id');
