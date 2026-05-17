-- BuddyTrip — Row Level Security Policies
-- Priority policies from MIGRATION_PLAN.md §Step 1.6 and PERMISSIONS.md

-- ═══════════════════════════════════════════════════════════════
-- Enable RLS on all 26 tables
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_result_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE hole_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_hole_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_info_tiles ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- Helper: check if user is a member of a trip
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_trip_member(p_trip_id text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = p_trip_id AND user_id = auth.uid()::text
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_trip_role(p_trip_id text, p_roles text[]) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = p_trip_id
      AND user_id = auth.uid()::text
      AND role = ANY(p_roles)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
-- users — any authenticated user can read; users can update own row
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY users_select ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY users_insert ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid()::text);
CREATE POLICY users_update ON users FOR UPDATE TO authenticated USING (id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- series — any authenticated can read; owner can manage
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY series_select ON series FOR SELECT TO authenticated USING (true);
CREATE POLICY series_insert ON series FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY series_update ON series FOR UPDATE TO authenticated USING (owner_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- trips — only trip members can see/modify
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY trips_select ON trips FOR SELECT TO authenticated
  USING (is_trip_member(id));

CREATE POLICY trips_insert ON trips FOR INSERT TO authenticated
  WITH CHECK (true); -- any authenticated user can create a trip

CREATE POLICY trips_update ON trips FOR UPDATE TO authenticated
  USING (has_trip_role(id, ARRAY['Owner', 'Planner']));

CREATE POLICY trips_delete ON trips FOR DELETE TO authenticated
  USING (has_trip_role(id, ARRAY['Owner']));

-- ═══════════════════════════════════════════════════════════════
-- trip_members — members can see their trip's members
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY trip_members_select ON trip_members FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY trip_members_insert ON trip_members FOR INSERT TO authenticated
  WITH CHECK (
    -- Creator adding themselves, or owner/planner adding others
    user_id = auth.uid()::text
    OR has_trip_role(trip_id, ARRAY['Owner', 'Planner'])
  );

CREATE POLICY trip_members_update ON trip_members FOR UPDATE TO authenticated
  USING (
    -- Self-update (RSVP status) or owner managing roles
    user_id = auth.uid()::text
    OR has_trip_role(trip_id, ARRAY['Owner'])
  );

CREATE POLICY trip_members_delete ON trip_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()::text -- self-removal
    OR has_trip_role(trip_id, ARRAY['Owner'])
  );

-- ═══════════════════════════════════════════════════════════════
-- events — scoped to trip membership
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY events_select ON events FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY events_insert ON events FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY events_update ON events FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

-- ═══════════════════════════════════════════════════════════════
-- Competition tables — scoped via event → trip membership
-- ═══════════════════════════════════════════════════════════════

-- teams
CREATE POLICY teams_select ON teams FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY teams_insert ON teams FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

CREATE POLICY teams_update ON teams FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- players
CREATE POLICY players_select ON players FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY players_insert ON players FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- team_assignments
CREATE POLICY team_assignments_select ON team_assignments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY team_assignments_insert ON team_assignments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- play_groups
CREATE POLICY play_groups_select ON play_groups FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY play_groups_insert ON play_groups FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- rounds
CREATE POLICY rounds_select ON rounds FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY rounds_insert ON rounds FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

CREATE POLICY rounds_update ON rounds FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- side_events
CREATE POLICY side_events_select ON side_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY side_events_insert ON side_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

CREATE POLICY side_events_update ON side_events FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- ═══════════════════════════════════════════════════════════════
-- Scoring tables — owner/planner can write scores
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY group_results_select ON group_results FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY group_results_insert ON group_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

CREATE POLICY group_results_update ON group_results FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

CREATE POLICY group_result_scores_select ON group_result_scores FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY group_result_scores_insert ON group_result_scores FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

CREATE POLICY group_result_scores_update ON group_result_scores FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- hole_results
CREATE POLICY hole_results_select ON hole_results FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY hole_results_insert ON hole_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- player_hole_scores
CREATE POLICY player_hole_scores_select ON player_hole_scores FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND is_trip_member(e.trip_id)
  ));

CREATE POLICY player_hole_scores_insert ON player_hole_scores FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r JOIN events e ON e.id = r.event_id
    WHERE r.id = round_id AND has_trip_role(e.trip_id, ARRAY['Owner', 'Planner'])
  ));

-- ═══════════════════════════════════════════════════════════════
-- Ideas & voting — trip members can view; canEdit for write
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY ideas_select ON ideas FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY ideas_insert ON ideas FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY ideas_update ON ideas FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY ideas_delete ON ideas FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner']));

CREATE POLICY idea_votes_select ON idea_votes FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY idea_votes_insert ON idea_votes FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id) AND user_id = auth.uid()::text);

CREATE POLICY idea_votes_delete ON idea_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY idea_comments_select ON idea_comments FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY idea_comments_insert ON idea_comments FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id) AND user_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- Date polls & voting
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY date_polls_select ON date_polls FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY date_polls_insert ON date_polls FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY date_polls_update ON date_polls FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY date_windows_select ON date_windows FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY date_windows_insert ON date_windows FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY date_poll_votes_select ON date_poll_votes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM date_windows dw WHERE dw.id = window_id AND is_trip_member(dw.trip_id)
  ));

CREATE POLICY date_poll_votes_insert ON date_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM date_windows dw WHERE dw.id = window_id AND is_trip_member(dw.trip_id)
    )
  );

CREATE POLICY date_poll_votes_update ON date_poll_votes FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- Logistics — trip members can view; canEdit for write
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY reservations_select ON reservations FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY reservations_insert ON reservations FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY reservations_update ON reservations FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY expenses_select ON expenses FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY expenses_insert ON expenses FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY expenses_update ON expenses FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner']));

CREATE POLICY expense_splits_select ON expense_splits FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM expenses ex WHERE ex.id = expense_id AND is_trip_member(ex.trip_id)
  ));

CREATE POLICY expense_splits_insert ON expense_splits FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM expenses ex WHERE ex.id = expense_id AND has_trip_role(ex.trip_id, ARRAY['Owner', 'Planner'])
  ));

CREATE POLICY expense_splits_update ON expense_splits FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM expenses ex WHERE ex.id = expense_id AND has_trip_role(ex.trip_id, ARRAY['Owner'])
  ));

-- ═══════════════════════════════════════════════════════════════
-- Messages — trip channel: trip members; team channel: team members
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY messages_select ON messages FOR SELECT TO authenticated
  USING (
    is_trip_member(trip_id)
    AND (
      channel = 'trip'
      OR (channel = 'team' AND EXISTS (
        SELECT 1 FROM team_assignments ta
        JOIN events e ON e.trip_id = messages.trip_id
        WHERE ta.event_id = e.id
          AND ta.team_id = messages.team_id
          AND ta.user_id = auth.uid()::text
      ))
    )
  );

CREATE POLICY messages_insert ON messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()::text
    AND is_trip_member(trip_id)
    AND (
      channel = 'trip'
      OR (channel = 'team' AND EXISTS (
        SELECT 1 FROM team_assignments ta
        JOIN events e ON e.trip_id = trip_id
        WHERE ta.event_id = e.id
          AND ta.team_id = team_id
          AND ta.user_id = auth.uid()::text
      ))
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- Notifications
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY notification_events_select ON notification_events FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY notification_events_insert ON notification_events FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id) AND actor_id = auth.uid()::text);

CREATE POLICY notification_reads_select ON notification_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY notification_reads_insert ON notification_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- Quick Info Tiles — owner + planner can manage
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY quick_info_tiles_select ON quick_info_tiles FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

CREATE POLICY quick_info_tiles_insert ON quick_info_tiles FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY quick_info_tiles_update ON quick_info_tiles FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

CREATE POLICY quick_info_tiles_delete ON quick_info_tiles FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));
