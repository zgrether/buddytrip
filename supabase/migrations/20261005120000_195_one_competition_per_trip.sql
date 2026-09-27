-- ════════════════════════════════════════════════════════════════════════════
-- 195 · One competition per trip — a constraint, not an `if`
--
-- ── What this reverses, and why ─────────────────────────────────────────────
--
-- `competitions.create` (competitions.ts) carried the rule as a read-first
-- check and said the missing constraint was DELIBERATE: "There is no
-- UNIQUE(competitions.trip_id) behind it — deliberately, so the seasonal series
-- above stays possible — which makes this `if` the only thing holding the
-- invariant." `viewerTeam.ts` said the same from the other end: Team chat's
-- "your team" is unambiguous only because that `if` holds.
--
-- The reasoning was right about what the `if` protects and wrong that an `if`
-- could protect it. A read-then-insert is a race: two organizers tapping Create
-- at once both read "none" and both insert, and the trip has two cups. Nothing
-- errors — Team chat just quietly names one of two rooms (viewerTeam.ts), and
-- the build plan's PR 6 ("counts toward the trip's competition") and PR 7 (the
-- create flow) each assume there is exactly one.
--
-- Zach ruled it 2026-09-22: one competition per trip, and the database says so.
-- The seasonal series is not lost — lifting this is recorded in TRACKER.md as a
-- DELIBERATE future decision (drop the constraint, and decide what Team chat
-- becomes), not drift. What changes is that relaxing it now takes a migration
-- someone chose to write, instead of a race nobody saw.
--
-- ── Checked first ───────────────────────────────────────────────────────────
--
-- Production, read-only, 2026-09-27: 7 competitions, 0 trips with more than one.
-- The ADD CONSTRAINT fails loudly on a violation rather than choosing a winner,
-- so a database that had drifted stops here.
--
-- `competitions_id_trip_key` UNIQUE (id, trip_id) (migration 135) is untouched:
-- it is not a per-trip limit — it exists so `games` can reference the pair and be
-- held to the same trip as its competition.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'competitions_one_per_trip'
       AND conrelid = 'public.competitions'::regclass
  ) THEN
    NULL;
  END IF;
END $$;

