-- 099 — competitions.clinch_notified_team_id: the exactly-once guard for the
-- "cup clinched" push (Push Phase 3).
--
-- ── Why a column at all ──────────────────────────────────────────────────────
-- "Cup clinched" is the one notification in the app that is NOT a write site.
-- No mutation says the cup is decided; it BECOMES true when the remaining
-- available points can no longer change the leader. It is derived on every read
-- by `rollUp` (src/lib/competitionPlacement.ts): `pointsToClinch[team] =
-- winNumber - teamTotal`, and `<= 0` means clinched. Nothing is stored, which is
-- deliberate and stays that way — the clinch STATE remains fully derived.
--
-- What is NOT derivable is whether we already TOLD anyone. That is the single
-- fact this column records. It is notification bookkeeping, not competition
-- state, and nothing about scoring, standings or the leaderboard reads it.
--
-- The alternative considered and rejected: detect the null -> clincher
-- transition by computing the leaderboard both BEFORE and AFTER the finalize.
-- That needs no schema, but it costs a second full `computeCompetitionLeaderboard`
-- (a multi-query read plus live projections) on every finish, and it cannot be
-- exactly-once — two clients finishing two different games concurrently would
-- both observe "no clincher before, clincher after" and both send. Storing the
-- answer makes the guard atomic (see below) and removes the second compute.
--
-- ── How it produces exactly-once ─────────────────────────────────────────────
-- After a finalize, compute the leaderboard ONCE. If a clincher exists, claim
-- the notification with a CONDITIONAL update and send only if it affected a row:
--
--   UPDATE competitions
--      SET clinch_notified_team_id = :team
--    WHERE id = :competition
--      AND clinch_notified_team_id IS DISTINCT FROM :team
--
-- Two concurrent finalizes race to that UPDATE; exactly one wins the row, so
-- exactly one push goes out. `IS DISTINCT FROM` (not `<>`) is load-bearing — it
-- is the form that treats a NULL current value as "not yet claimed" rather than
-- evaluating to NULL and matching nothing.
--
-- ── What happens on an un-clinch (a score correction after the fact) ─────────
-- A correction that flips the leader makes the cup un-decided again — the board
-- simply stops showing a clincher, because clinch state is derived and never
-- stored. This column is deliberately NOT cleared in that case, which gives the
-- rule its useful shape:
--   - the SAME team re-clinches  -> IS DISTINCT FROM is false -> no second push
--     (correct: a cup that wobbled and settled the same way is not news twice)
--   - a DIFFERENT team clinches  -> the value moves -> push fires
--     (correct: that is very much news)
--
-- ── It must be written with the SERVICE-ROLE client, never ctx.supabase ──────
-- `competitions_update` (migration 001, role value updated by 029) requires trip
-- role Owner/Organizer. A game DELEGATE who is a plain trip Member can finalize
-- a game — `canEditGame` passes on a `game_delegates` row — but cannot update the
-- competitions row under RLS. Routing this write through the caller's client
-- would therefore FAIL SILENTLY for exactly the person most likely to be
-- finishing the deciding game on-site, and a failed claim means either no clinch
-- push or a repeating one. No RLS policy is added for it: this is server-internal
-- bookkeeping with no client writer, so the service-role path is the correct one
-- and a policy would only invite a client to write it.
--
-- Additive, idempotent, replayable from zero, no environment-specific ids.

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS clinch_notified_team_id text;

-- FK with ON DELETE SET NULL: if the recorded team is deleted the claim is
-- meaningless, and clearing it is the right recovery — a genuinely new clinch by
-- whatever team remains should be able to notify. Matches the ON DELETE SET NULL
-- shape migration 056 used for games.competition_id. text, per the app-wide
-- text-PK convention (a uuid FK -> text PK errors at migration time).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitions_clinch_notified_team_id_fkey'
      AND conrelid = 'public.competitions'::regclass
  ) THEN
    ALTER TABLE public.competitions
      ADD CONSTRAINT competitions_clinch_notified_team_id_fkey
      FOREIGN KEY (clinch_notified_team_id)
      REFERENCES public.teams(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.competitions.clinch_notified_team_id IS
  'Push bookkeeping ONLY (Push Phase 3): the team a "cup clinched" notification '
  'has already been sent for. Clinch STATE stays derived (rollUp/pointsToClinch) '
  'and is never stored. Claimed atomically via UPDATE ... WHERE '
  'clinch_notified_team_id IS DISTINCT FROM :team, written with the service-role '
  'client because a game delegate who may finalize cannot update this row under '
  'RLS. Nothing in scoring or the leaderboard reads it.';
