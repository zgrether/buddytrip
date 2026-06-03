-- Migration 020 — drop the trip stage model
--
-- The stored `stage` column (idea/planning/going) is retired. The product
-- has only one real distinction left: whether a destination has been locked
-- (`locked_destination_at IS NOT NULL`). Everything past that point is a
-- pure function of the trip's dates. The old planning→going advance was a
-- manual checkpoint wired through a dead UI path (the Summary modal button
-- was never rendered), so no trip ever actually reached 'going'.
--
-- This drops `stage` and its advance timestamps, plus a cluster of dead
-- controls accumulated during the stage experiment:
--   - trip_status_override / saved_at  → retired "saved" status feature
--   - planning_skipped                 → only consumer was advanceToGoing
--   - planning_tier                    → never read in application code
--   - getting_there_enabled            → orphan panel-activation flag
--   - quick_info_dismissed             → retired dismiss workflow
--
-- The two SQL objects that computed on `stage` are rewritten FIRST (a column
-- can't be dropped while a policy/function references it), then the columns
-- go. Everything is idempotent so re-applies are no-ops.

-- ── 1. Rewrite trip_status() — stage-free, date-driven ───────────────────
-- Mirrors the TS getEffectiveStatus(): past → idea → now → upcoming.
CREATE OR REPLACE FUNCTION public.trip_status(t trips)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN t.end_date IS NOT NULL AND t.end_date + interval '3 days' < CURRENT_DATE THEN 'past'
    WHEN t.locked_destination_at IS NULL THEN 'idea'
    WHEN t.start_date IS NOT NULL AND t.start_date - interval '3 days' <= CURRENT_DATE THEN 'now'
    ELSE 'upcoming'
  END;
$function$;

-- ── 2. Rewrite trips_select RLS — gate idea visibility on the destination ─
-- Before: idea-stage trips were planner-only; from planning onward any member
-- could see them. "Idea stage" is now "no destination locked yet", so the
-- gate keys off locked_destination_at instead of stage.
DROP POLICY IF EXISTS trips_select ON public.trips;
CREATE POLICY trips_select ON public.trips FOR SELECT TO authenticated
  USING (
    CASE
      WHEN locked_destination_at IS NULL THEN is_trip_planner(id)
      ELSE is_trip_member(id)
    END
  );

-- ── 3. Drop the stage column + the dead control cluster ──────────────────
ALTER TABLE public.trips
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS stage_advanced_to_planning_at,
  DROP COLUMN IF EXISTS stage_advanced_to_going_at,
  DROP COLUMN IF EXISTS trip_status_override,
  DROP COLUMN IF EXISTS saved_at,
  DROP COLUMN IF EXISTS planning_skipped,
  DROP COLUMN IF EXISTS planning_tier,
  DROP COLUMN IF EXISTS getting_there_enabled,
  DROP COLUMN IF EXISTS quick_info_dismissed;
