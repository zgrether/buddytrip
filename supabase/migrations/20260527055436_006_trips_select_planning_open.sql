-- Migration 006 — open trips_select to Members during 'planning'
--
-- Before: trips_select hid the trip from any non-Owner / non-Planner
-- during BOTH 'idea' and 'planning' stages. That meant adding a Member
-- to a trip in 'planning' silently failed — the trip_members row got
-- created with status='in', but the user couldn't actually see the
-- trip until someone advanced the stage to 'going'.
--
-- After: only 'idea' is planner-only. From 'planning' onward, any
-- trip_members row grants SELECT on the trip. Owner/Planner-only
-- writes are unchanged (trips_update still uses has_trip_role).
-- Rationale: planning is the stage where you actually want crew
-- engagement — once you've moved past brainstorming destinations
-- and started locking dates, the wider crew needs visibility to
-- weigh in. Idea-stage stays scoped to planners so half-formed
-- destination shopping doesn't leak to the whole roster.

DROP POLICY IF EXISTS trips_select ON trips;

CREATE POLICY trips_select ON trips
  FOR SELECT
  USING (
    CASE
      WHEN stage = 'idea' THEN is_trip_planner(id)
      ELSE is_trip_member(id)
    END
  );
