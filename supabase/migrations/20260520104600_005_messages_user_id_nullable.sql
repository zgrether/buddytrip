-- Migration 005 — messages.user_id NOT NULL → NULL
-- Spec: CC_CREW_OVERHAUL.md Part 2.4 (system messages)
--
-- The original schema declared messages.user_id as NOT NULL with
-- ON DELETE SET NULL, which is self-contradictory: the cascade would
-- fail at user-delete time, and system messages (member added,
-- promoted, etc.) have no author to begin with.
--
-- Relax to nullable so:
--   - the ON DELETE SET NULL cascade can actually fire when a user is
--     deleted, leaving their historical messages intact but authorless;
--   - system messages can be inserted with user_id = NULL, matching the
--     postSystemMessage() helper in src/server/routers/messages.ts.
--
-- Followed migration 004 in the live DB's schema history; lands here as
-- its own file so `supabase db push` sees the same row layout locally.

ALTER TABLE messages
  ALTER COLUMN user_id DROP NOT NULL;
