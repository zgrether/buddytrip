-- Migration 045: Action Center + Date Poll redesign
--
-- Simplifies the date poll state machine:
--   * Adds trips.poll_mode — true when an owner has opened a poll, false
--     for direct date entry. Replaces the draft/active/closed enum and
--     the legacy date_poll_active flag.
--   * Adds date_polls.notify_sent — opt-in "I already told the crew" flag
--     so the Notify crew button in the ActionCenter does not get spammed.
--
-- Drops the legacy columns (pre-prod — safe to clean-slate):
--   * trips.date_poll_active   (migration 032)
--   * trips.date_set_method    (migration 032)
--   * trips.date_poll_state    (migration 036)

-- ───────────────────────── new columns ─────────────────────────

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS poll_mode boolean NOT NULL DEFAULT false;

ALTER TABLE date_polls
  ADD COLUMN IF NOT EXISTS notify_sent boolean NOT NULL DEFAULT false;

-- ───────────────────────── backfill ─────────────────────────

-- Any trip that currently has an active poll moves to poll_mode = true.
UPDATE trips
  SET poll_mode = true
  WHERE date_poll_active = true
     OR date_poll_state IN ('draft', 'active');

-- ───────────────────────── drop legacy columns ─────────────────────────

ALTER TABLE trips DROP COLUMN IF EXISTS date_poll_active;
ALTER TABLE trips DROP COLUMN IF EXISTS date_poll_state;
ALTER TABLE trips DROP COLUMN IF EXISTS date_set_method;

-- RLS on trips and date_polls already covers these columns:
--   * trips policies (003_rls.sql) — SELECT by members, UPDATE by owner/planner
--   * date_polls policies (003_rls.sql) — SELECT by members, INSERT/UPDATE
--     by owner/planner
-- No new policies needed.
