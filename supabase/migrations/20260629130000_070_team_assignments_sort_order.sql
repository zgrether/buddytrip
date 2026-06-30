-- 070 — Canonical roster order: team_assignments.sort_order.
--
-- Roster order is set ONCE in the Edit Team modal and becomes the canonical
-- player order every team-roster chooser derives from (match assignment, rack
-- foursomes, the handicap rosters). Before this, listTeamAssignments had no
-- ORDER BY → Postgres returned rows in arbitrary physical order and every
-- chooser inherited that arbitrariness. Derive-don't-snapshot: the order lives
-- HERE, on the assignment row; consumers read it, none store their own copy.
--
-- sort_order is per-TEAM (each team's roster is 0,1,2,…). It rides the
-- assignment row's lifecycle alongside is_captain (mig 064) — unassign the
-- player and their slot in the order goes with the row. precedent for the
-- column: schedule_items / logistics_items / catalog_ideas all use sort_order.

ALTER TABLE public.team_assignments
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill existing rosters with a STABLE initial order: insertion order
-- (assigned_at) within each team, tie-broken by user_id so the result is
-- deterministic. New columns default to 0; this gives every existing team a
-- 0..n-1 sequence so a later drag-reorder has a coherent starting point.
WITH ordered AS (
  SELECT
    competition_id,
    user_id,
    row_number() OVER (
      PARTITION BY competition_id, team_id
      ORDER BY assigned_at, user_id
    ) - 1 AS rn
  FROM public.team_assignments
)
UPDATE public.team_assignments ta
  SET sort_order = ordered.rn
  FROM ordered
  WHERE ta.competition_id = ordered.competition_id
    AND ta.user_id = ordered.user_id;

-- Lookups + ordering are per (competition, team); the index keeps the
-- ORDER BY sort_order read cheap once rosters carry real volume.
CREATE INDEX IF NOT EXISTS team_assignments_team_sort_idx
  ON public.team_assignments (competition_id, team_id, sort_order);
