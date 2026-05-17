-- Migration: 010_cascade_deletes
-- Complete the ON DELETE CASCADE / SET NULL coverage for all remaining
-- NO ACTION foreign keys. Migration 004 covered trip→event chains;
-- this handles the rest (idea children, team children, scoreboard_shares,
-- series back-references, and user references).
--
-- Strategy:
--   CASCADE  — child row has no meaning without parent (votes, scores, shares)
--   SET NULL — nullable back-reference or audit column (team_id, created_by)
--   NO ACTION left intentionally on series.owner_id — deleting a user should
--     not silently destroy all their series; handle in app layer if needed.

-- ═══════════════════════════════════════════════════════════════
-- 1. Idea children → ideas(id) — CASCADE
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE idea_votes
  DROP CONSTRAINT idea_votes_idea_id_fkey,
  ADD CONSTRAINT idea_votes_idea_id_fkey
    FOREIGN KEY (idea_id) REFERENCES ideas (id) ON DELETE CASCADE;

ALTER TABLE idea_comments
  DROP CONSTRAINT idea_comments_idea_id_fkey,
  ADD CONSTRAINT idea_comments_idea_id_fkey
    FOREIGN KEY (idea_id) REFERENCES ideas (id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 2. Team children → teams(id) — CASCADE or SET NULL
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE team_assignments
  DROP CONSTRAINT team_assignments_team_id_fkey,
  ADD CONSTRAINT team_assignments_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE;

ALTER TABLE group_result_scores
  DROP CONSTRAINT group_result_scores_team_id_fkey,
  ADD CONSTRAINT group_result_scores_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE;

-- Nullable FK — team deleted → winner cleared, not row deleted
ALTER TABLE hole_results
  DROP CONSTRAINT hole_results_winner_team_id_fkey,
  ADD CONSTRAINT hole_results_winner_team_id_fkey
    FOREIGN KEY (winner_team_id) REFERENCES teams (id) ON DELETE SET NULL;

-- Nullable FK — team deleted → messages stay, team_id nulled
ALTER TABLE messages
  DROP CONSTRAINT messages_team_id_fkey,
  ADD CONSTRAINT messages_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. group_result_scores → group_results (composite FK) — CASCADE
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE group_result_scores
  DROP CONSTRAINT group_result_scores_round_id_group_id_fkey,
  ADD CONSTRAINT group_result_scores_round_id_group_id_fkey
    FOREIGN KEY (round_id, group_id) REFERENCES group_results (round_id, group_id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 4. group_results.event_id → events(id) — CASCADE
--    (Added in 006_realtime_setup.sql, missing cascade)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE group_results
  DROP CONSTRAINT group_results_event_id_fkey,
  ADD CONSTRAINT group_results_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 5. scoreboard_shares → trips/events — CASCADE
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE scoreboard_shares
  DROP CONSTRAINT scoreboard_shares_trip_id_fkey,
  ADD CONSTRAINT scoreboard_shares_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE scoreboard_shares
  DROP CONSTRAINT scoreboard_shares_event_id_fkey,
  ADD CONSTRAINT scoreboard_shares_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 6. trips.series_id → series(id) — SET NULL (unlink, don't delete trip)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE trips
  DROP CONSTRAINT trips_series_id_fkey,
  ADD CONSTRAINT trips_series_id_fkey
    FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════
-- 7. User references — SET NULL where nullable, CASCADE where
--    the row has no meaning without the user
-- ═══════════════════════════════════════════════════════════════

-- Audit/author columns — SET NULL (keep the data, clear the author)
ALTER TABLE scoreboard_shares
  DROP CONSTRAINT scoreboard_shares_created_by_fkey,
  ADD CONSTRAINT scoreboard_shares_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE group_results
  DROP CONSTRAINT group_results_submitted_by_fkey,
  ADD CONSTRAINT group_results_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE notification_events
  DROP CONSTRAINT notification_events_actor_id_fkey,
  ADD CONSTRAINT notification_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE quick_info_tiles
  DROP CONSTRAINT quick_info_tiles_created_by_fkey,
  ADD CONSTRAINT quick_info_tiles_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;

-- Per-user rows — CASCADE (no user → no membership/vote/score)
ALTER TABLE trip_members
  DROP CONSTRAINT trip_members_user_id_fkey,
  ADD CONSTRAINT trip_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE idea_votes
  DROP CONSTRAINT idea_votes_user_id_fkey,
  ADD CONSTRAINT idea_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE idea_comments
  DROP CONSTRAINT idea_comments_user_id_fkey,
  ADD CONSTRAINT idea_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE date_poll_votes
  DROP CONSTRAINT date_poll_votes_user_id_fkey,
  ADD CONSTRAINT date_poll_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE expense_splits
  DROP CONSTRAINT expense_splits_user_id_fkey,
  ADD CONSTRAINT expense_splits_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE team_assignments
  DROP CONSTRAINT team_assignments_user_id_fkey,
  ADD CONSTRAINT team_assignments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE players
  DROP CONSTRAINT players_user_id_fkey,
  ADD CONSTRAINT players_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE player_hole_scores
  DROP CONSTRAINT player_hole_scores_player_id_fkey,
  ADD CONSTRAINT player_hole_scores_player_id_fkey
    FOREIGN KEY (player_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE notification_reads
  DROP CONSTRAINT notification_reads_user_id_fkey,
  ADD CONSTRAINT notification_reads_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

-- Messages and expenses keep the row even if user is deleted (SET NULL)
ALTER TABLE messages
  DROP CONSTRAINT messages_user_id_fkey,
  ADD CONSTRAINT messages_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE expenses
  DROP CONSTRAINT expenses_paid_by_user_id_fkey,
  ADD CONSTRAINT expenses_paid_by_user_id_fkey
    FOREIGN KEY (paid_by_user_id) REFERENCES users (id) ON DELETE SET NULL;

-- series.owner_id — intentionally left as NO ACTION.
-- Deleting a user who owns series should fail loudly; handle in app layer.
