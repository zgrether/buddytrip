-- Migration: 009_missing_rls_policies
-- Fix RLS policy gaps found by integration tests:
--
-- 1. play_groups: missing UPDATE policy (Owner/Planner via event→trip)
-- 2. expense_splits: missing DELETE policy (Owner via expense→trip)
-- 3. expenses: missing DELETE policy (Owner/Planner via trip)
-- 4. Anon SELECT on events, teams, rounds, side_events scoped through
--    scoreboard_shares — enables the public scoreboard endpoint.
-- 5. series UPDATE: add WITH CHECK (true) so transferOwnership can change
--    owner_id. USING already ensures only the current owner can initiate.

-- ═══════════════════════════════════════════════════════════════
-- 1. play_groups UPDATE — matches existing insert pattern
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY play_groups_update ON play_groups FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id
      AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- ═══════════════════════════════════════════════════════════════
-- 2. expense_splits DELETE — Owner only (matches update pattern)
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY expense_splits_delete ON expense_splits FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM expenses ex WHERE ex.id = expense_id
      AND has_trip_role(ex.trip_id, ARRAY['Owner'])
  ));

-- ═══════════════════════════════════════════════════════════════
-- 3. expenses DELETE — Owner/Planner (matches insert pattern)
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY expenses_delete ON expenses FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

-- ═══════════════════════════════════════════════════════════════
-- 4. Anon SELECT policies for public scoreboard
--    Scoped: only rows linked to an event that has a scoreboard_shares record.
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY events_select_via_share ON events FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM scoreboard_shares ss WHERE ss.event_id = events.id
  ));

CREATE POLICY teams_select_via_share ON teams FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM scoreboard_shares ss WHERE ss.event_id = teams.event_id
  ));

CREATE POLICY rounds_select_via_share ON rounds FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM scoreboard_shares ss
      JOIN events e ON e.id = ss.event_id
    WHERE e.id = rounds.event_id
  ));

CREATE POLICY side_events_select_via_share ON side_events FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM scoreboard_shares ss WHERE ss.event_id = side_events.event_id
  ));

-- ═══════════════════════════════════════════════════════════════
-- 5. series UPDATE: allow owner to change owner_id (transferOwnership)
--    Without WITH CHECK, Postgres re-applies USING to the new row, blocking
--    the update because new owner_id != auth.uid().
-- ═══════════════════════════════════════════════════════════════

DROP POLICY series_update ON series;
CREATE POLICY series_update ON series FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()::text)
  WITH CHECK (true);
