-- 198 — A game's DELEGATE can record a bracket pick (Phase 0 F2, confirmed by a run)
--
-- ── The bug ──────────────────────────────────────────────────────────────────
-- `games.pickWinner` is a RUN action: its guard (`requireGameRunAction`) admits
-- the trip Owner/Organizer AND the game's delegate. The write is a plain UPDATE on
-- `bracket_matches` under the caller's RLS, and `bracket_matches_write` (migration
-- 112) admitted trip Owner/Organizer ONLY. So a delegate who is only a trip Member
-- passed the guard, matched ZERO rows, and got `{ ok: true }` back — the pick
-- silently did not stick. Confirmed 2026-09-29 by a run
-- (`games.bracketPick.test.ts`, "F2"): the call returned and the row stayed empty.
--
-- It ran the opposite way from every roster finding in the permissions pass —
-- there the server allowed what the UI hid; here the code offered what the
-- database quietly refused.
--
-- ── Why the database widens, not the guard narrows ───────────────────────────
-- A delegate RUNS the game, and a pick is the bracket's score: delegates already
-- write `game_results` (`game_results_delegate`, migration 061) and enter scores.
-- Refusing them the pick would make the bracket the one format a delegate cannot
-- run.
--
-- ── Scope: UPDATE only ───────────────────────────────────────────────────────
-- Recording a winner is an UPDATE of `winner_entrant_id`. The draw's rows are
-- created and removed by the settings save (`save_game_config`, a definer RPC
-- that runs its own edit check), never by a delegate's direct write, so INSERT
-- and DELETE stay with `bracket_matches_write`. Postgres ORs permissive
-- policies, so this adds the delegate alongside the existing write policy
-- without touching it.
--
-- `is_game_delegate(game)` answers about the CALLER (CLAUDE.md #28), so it is safe
-- as a policy predicate. `bracket_matches_select` (trip members) is also the
-- UPDATE's new-row check (#26); a delegate is a trip member, so it passes.

DROP POLICY IF EXISTS bracket_matches_delegate_update ON public.bracket_matches;
CREATE POLICY bracket_matches_delegate_update ON public.bracket_matches
  FOR UPDATE TO authenticated
  USING (public.is_game_delegate(game_id))
  WITH CHECK (public.is_game_delegate(game_id));
