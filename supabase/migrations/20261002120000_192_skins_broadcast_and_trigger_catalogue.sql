-- 192 — skins broadcasts like every other score table (#1432), and a
-- service-role read of which tables broadcast, so a test can prove it.
--
-- ── 1. The trigger ─────────────────────────────────────────────────────────
--
-- Skins entry writes `skins_hole_outcomes` (skinsOutcomes.upsertOutcome), and
-- that table was the one score-holding table with NO broadcast: migration 184
-- created it without one. So another device watching a skins game saw a hole
-- only on its ~20s poll — the same lag #1432 measured for outcome-mode match
-- play (7.2s on one sample, uniform 0–20s by construction), but with no
-- broadcast at all rather than a broadcast refreshing the wrong query.
--
-- Same function, same argument, same shape as `match_hole_outcomes_broadcast`
-- (migration 096/118). No change to `broadcast_score_event`: it derives the
-- event's KIND from the trigger's table (`games` → 'game', else → 'score',
-- migration 189), so a skins write arrives as a score event, which is what it is.
-- The payload stays a signal ({gameId, competitionId, kind}); a standalone game
-- returns quietly inside the function; a broadcast failure never rolls back the
-- write (its WHEN OTHERS). CLAUDE.md #20 holds unchanged.
--
-- FOR EACH ROW, like the others: a reset deleting many holes emits a burst,
-- which the client's invalidation coalescer collapses to one refetch per query.

DROP TRIGGER IF EXISTS skins_hole_outcomes_broadcast ON public.skins_hole_outcomes;
CREATE TRIGGER skins_hole_outcomes_broadcast
  AFTER INSERT OR DELETE OR UPDATE ON public.skins_hole_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_score_event('game_id');

-- ── 2. `_broadcast_triggers()` — the migrated schema, readable by a test ───
--
-- WHY IT EXISTS: a guard that the client's invalidation registry covers every
-- broadcasting table must read the triggers that ACTUALLY exist after every
-- migration has run — not the migration text, which cannot see a later
-- migration dropping or replacing a trigger (the one failure such a guard is
-- for). PostgREST exposes neither `pg_catalog` nor `information_schema`, and
-- the repo's one way for tests to reach the database is the service-role
-- client, so the read is a function. Its first consumer is this migration's own
-- test; its second is the registry guard.
--
-- SECURITY INVOKER, deliberately — CLAUDE.md #28: a function runs with the
-- caller's rights unless there is a reason not to, and there is none here.
-- Established before writing it, not assumed: running as `service_role`, a
-- plain SELECT on pg_trigger/pg_proc/pg_class sees every broadcast trigger (10
-- of 10, measured on production 2026-09-24). DEFINER on a metadata read would
-- be a stronger privilege with no payoff.
--
-- EXPOSURE: revoked from PUBLIC, anon and authenticated; granted to
-- service_role only. The leading underscore also places it under
-- `anonCallableRpcs.test.ts`'s convention ("an underscore function is an
-- internal core"), so if a later change ever made it callable by anon, that
-- existing test fails. The production-schema cost is bounded by that guard, not
-- by care. (The catalogue it reads is not secret — trigger and table names —
-- so the revoke is about keeping the callable surface to what the app uses.)

CREATE OR REPLACE FUNCTION public._broadcast_triggers()
RETURNS TABLE (table_name text, trigger_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.relname::text AS table_name, t.tgname::text AS trigger_name
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p       ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_class c      ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n  ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'broadcast_score_event'
     AND NOT t.tgisinternal
   ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public._broadcast_triggers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._broadcast_triggers() FROM anon;
REVOKE ALL ON FUNCTION public._broadcast_triggers() FROM authenticated;
GRANT EXECUTE ON FUNCTION public._broadcast_triggers() TO service_role;
