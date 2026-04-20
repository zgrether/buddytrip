-- Migration 052: Action Center opt-in toggles
--
-- Adds two boolean columns to trips that control whether the going-stage
-- Action Center surfaces the RSVP and Travel sections at all. Defaulting
-- both to false keeps the Action Center compact by default; owners opt
-- in with simple inline toggles at the top of the card.
--
--   * trips.rsvp_enabled   — when true, members see the RSVP in/maybe/out
--                            buttons and the owner sees the tallies.
--   * trips.travel_enabled — when true, members see the Travel entry
--                            form and the owner sees travel summaries.
--
-- Backfill: any trip that already has RSVP / travel data coming in from
-- members gets the corresponding toggle flipped on so existing trips
-- don't silently lose data visibility.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS rsvp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS travel_enabled boolean NOT NULL DEFAULT false;

-- ───────────────────────── backfill ─────────────────────────

UPDATE trips
  SET rsvp_enabled = true
  WHERE id IN (
    SELECT DISTINCT trip_id FROM trip_members WHERE rsvp_status IS NOT NULL
  );

UPDATE trips
  SET travel_enabled = true
  WHERE id IN (
    SELECT DISTINCT trip_id FROM trip_members WHERE travel_mode IS NOT NULL
  );

-- RLS on trips already covers these columns:
--   * SELECT by members, UPDATE by owner/planner (003_rls.sql)
-- No new policies needed.
