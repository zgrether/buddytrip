-- Drop tables identified as fully unused in pre-launch audit
-- (AUDIT_FINDINGS.md Area 1). All associated RLS policies, indexes,
-- and FK references are dropped automatically via CASCADE.

-- Score entry pipeline (orphaned during migration 062 schema rebuild)
DROP TABLE IF EXISTS play_groups CASCADE;
DROP TABLE IF EXISTS player_hole_scores CASCADE;
DROP TABLE IF EXISTS group_results CASCADE;

-- Golf course detail enrichment (never wired to UI)
DROP TABLE IF EXISTS golf_course_details CASCADE;

-- Scoreboard sharing (page deleted in Task 4; procedure deleted in Task 7)
DROP TABLE IF EXISTS scoreboard_shares CASCADE;

-- Legacy agenda table (fully superseded by schedule_items)
DROP TABLE IF EXISTS reservations CASCADE;

-- Dead comment system (replaced by crew chat; router deleted in Task 7)
DROP TABLE IF EXISTS idea_comments CASCADE;
