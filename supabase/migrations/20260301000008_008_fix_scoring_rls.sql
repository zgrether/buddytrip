-- Migration: 008_fix_scoring_rls
-- Fix RLS policy gaps exposed by integration tests with authenticated clients:
--
-- 1. group_results: tRPC router allows any trip member to submit scores,
--    but RLS only allowed Owner/Planner. Fix: allow any trip member.
-- 2. group_result_scores: missing DELETE policy entirely (submit procedure
--    deletes before re-inserting). Fix: add DELETE + widen INSERT/UPDATE.
-- 3. scoreboard_shares: missing ::text cast on auth.uid() comparison.

-- ═══════════════════════════════════════════════════════════════
-- group_results: any trip member can INSERT/UPDATE (score submission)
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS group_results_insert ON group_results;
CREATE POLICY group_results_insert ON group_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

DROP POLICY IF EXISTS group_results_update ON group_results;
CREATE POLICY group_results_update ON group_results FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

-- ═══════════════════════════════════════════════════════════════
-- group_result_scores: any trip member can INSERT/UPDATE/DELETE
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS group_result_scores_insert ON group_result_scores;
CREATE POLICY group_result_scores_insert ON group_result_scores FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

DROP POLICY IF EXISTS group_result_scores_update ON group_result_scores;
CREATE POLICY group_result_scores_update ON group_result_scores FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY group_result_scores_delete ON group_result_scores FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

-- ═══════════════════════════════════════════════════════════════
-- scoreboard_shares: fix auth.uid() cast to match text column type
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Trip members can create scoreboard shares" ON scoreboard_shares;
CREATE POLICY "Trip members can create scoreboard shares"
  ON scoreboard_shares FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trip_members
      WHERE trip_members.trip_id = scoreboard_shares.trip_id
        AND trip_members.user_id = auth.uid()::text
    )
  );
