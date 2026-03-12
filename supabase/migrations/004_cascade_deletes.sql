-- 004_cascade_deletes.sql
-- Add ON DELETE CASCADE (or SET NULL for nullable back-references) to all
-- foreign keys referencing trips.id, events.id, and child tables.
-- Replaces the application-level cascade workaround in the trips router.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. FKs → trips.id  (all CASCADE)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE trip_members
  DROP CONSTRAINT trip_members_trip_id_fkey,
  ADD CONSTRAINT trip_members_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE ideas
  DROP CONSTRAINT ideas_trip_id_fkey,
  ADD CONSTRAINT ideas_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE idea_votes
  DROP CONSTRAINT idea_votes_trip_id_fkey,
  ADD CONSTRAINT idea_votes_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE idea_comments
  DROP CONSTRAINT idea_comments_trip_id_fkey,
  ADD CONSTRAINT idea_comments_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE date_polls
  DROP CONSTRAINT date_polls_trip_id_fkey,
  ADD CONSTRAINT date_polls_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE date_windows
  DROP CONSTRAINT date_windows_trip_id_fkey,
  ADD CONSTRAINT date_windows_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE reservations
  DROP CONSTRAINT reservations_trip_id_fkey,
  ADD CONSTRAINT reservations_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE expenses
  DROP CONSTRAINT expenses_trip_id_fkey,
  ADD CONSTRAINT expenses_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE messages
  DROP CONSTRAINT messages_trip_id_fkey,
  ADD CONSTRAINT messages_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE notification_events
  DROP CONSTRAINT notification_events_trip_id_fkey,
  ADD CONSTRAINT notification_events_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE quick_info_tiles
  DROP CONSTRAINT quick_info_tiles_trip_id_fkey,
  ADD CONSTRAINT quick_info_tiles_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

-- events.trip_id is the deferrable constraint
ALTER TABLE events
  DROP CONSTRAINT fk_events_trip_id,
  ADD CONSTRAINT fk_events_trip_id
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- trips.event_id is a back-reference; SET NULL so deleting the event row
-- does not delete the whole trip.
ALTER TABLE trips
  DROP CONSTRAINT fk_trips_event_id,
  ADD CONSTRAINT fk_trips_event_id
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. FKs → events.id  (all CASCADE)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE teams
  DROP CONSTRAINT teams_event_id_fkey,
  ADD CONSTRAINT teams_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE players
  DROP CONSTRAINT players_event_id_fkey,
  ADD CONSTRAINT players_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE team_assignments
  DROP CONSTRAINT team_assignments_event_id_fkey,
  ADD CONSTRAINT team_assignments_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE play_groups
  DROP CONSTRAINT play_groups_event_id_fkey,
  ADD CONSTRAINT play_groups_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE rounds
  DROP CONSTRAINT rounds_event_id_fkey,
  ADD CONSTRAINT rounds_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE side_events
  DROP CONSTRAINT side_events_event_id_fkey,
  ADD CONSTRAINT side_events_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. FKs in child tables (expense_splits, notification_reads, date_poll_votes,
--    group_results, hole_results, player_hole_scores, group_result_scores)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE expense_splits
  DROP CONSTRAINT expense_splits_expense_id_fkey,
  ADD CONSTRAINT expense_splits_expense_id_fkey
    FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE;

ALTER TABLE notification_reads
  DROP CONSTRAINT notification_reads_notification_id_fkey,
  ADD CONSTRAINT notification_reads_notification_id_fkey
    FOREIGN KEY (notification_id) REFERENCES notification_events (id) ON DELETE CASCADE;

-- date_poll_votes.window_id — CASCADE (deleting a window removes votes)
ALTER TABLE date_poll_votes
  DROP CONSTRAINT date_poll_votes_window_id_fkey,
  ADD CONSTRAINT date_poll_votes_window_id_fkey
    FOREIGN KEY (window_id) REFERENCES date_windows (id) ON DELETE CASCADE;

-- date_polls.locked_window_id — SET NULL (deleting a window unlocks the poll)
ALTER TABLE date_polls
  DROP CONSTRAINT fk_date_polls_locked_window,
  ADD CONSTRAINT fk_date_polls_locked_window
    FOREIGN KEY (locked_window_id) REFERENCES date_windows (id) ON DELETE SET NULL;

ALTER TABLE group_results
  DROP CONSTRAINT group_results_round_id_fkey,
  ADD CONSTRAINT group_results_round_id_fkey
    FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE;

ALTER TABLE group_results
  DROP CONSTRAINT group_results_group_id_fkey,
  ADD CONSTRAINT group_results_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES play_groups (id) ON DELETE CASCADE;

ALTER TABLE hole_results
  DROP CONSTRAINT hole_results_round_id_fkey,
  ADD CONSTRAINT hole_results_round_id_fkey
    FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE;

ALTER TABLE hole_results
  DROP CONSTRAINT hole_results_group_id_fkey,
  ADD CONSTRAINT hole_results_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES play_groups (id) ON DELETE CASCADE;

ALTER TABLE player_hole_scores
  DROP CONSTRAINT player_hole_scores_round_id_fkey,
  ADD CONSTRAINT player_hole_scores_round_id_fkey
    FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE;

ALTER TABLE player_hole_scores
  DROP CONSTRAINT player_hole_scores_group_id_fkey,
  ADD CONSTRAINT player_hole_scores_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES play_groups (id) ON DELETE CASCADE;

-- rounds.closed_by is nullable — SET NULL so deleting a user doesn't fail
ALTER TABLE rounds
  DROP CONSTRAINT rounds_closed_by_fkey,
  ADD CONSTRAINT rounds_closed_by_fkey
    FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE SET NULL;
