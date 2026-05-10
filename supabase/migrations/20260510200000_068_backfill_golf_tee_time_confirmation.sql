-- ════════════════════════════════════════════════════════════════════════════
-- 068 — Backfill golf item confirmation from tee_times
-- ════════════════════════════════════════════════════════════════════════════
-- Prior to the golf tee-times-as-confirmation feature (shipped with the
-- golf-tee-times UX work), golf schedule items had a separate manual
-- "Confirm" button.  Items that had tee_times set but were never explicitly
-- confirmed via that button are left with is_confirmed = false even though
-- their tee_times signal they are confirmed under the new semantics.
--
-- This migration backfills is_confirmed for those items so they appear on
-- the crew itinerary without requiring the planner to re-edit each one.
--
-- tee_times IS NOT NULL covers both cases:
--   tee_times = '{}'      → "walk on" (confirmed, no specific time)
--   tee_times = '{HH:MM}' → confirmed with specific tee times
-- ════════════════════════════════════════════════════════════════════════════

UPDATE schedule_items
SET
  is_confirmed = true,
  confirmed_at = now()
WHERE item_type    = 'golf'
  AND tee_times    IS NOT NULL
  AND is_confirmed = false;
