-- Tighten the ideas INSERT policy from Owner+Planner to Owner-only.
--
-- Rationale: with the new-trip redesign, the owner stages all destination
-- ideas during trip creation. Letting planners add more ideas after the
-- fact complicates the idea-stage UX without a clear use case. Mirror the
-- DELETE policy, which has always been Owner-only, and keep UPDATE as
-- Owner+Planner so planners can still refine details (pros/cons, lodging,
-- activities) on existing ideas.

DROP POLICY IF EXISTS ideas_insert ON ideas;

CREATE POLICY ideas_insert ON ideas FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner']));
