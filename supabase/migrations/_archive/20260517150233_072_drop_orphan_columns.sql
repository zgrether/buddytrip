-- Drop orphan columns identified in pre-launch audit (AUDIT_FINDINGS.md
-- Area 1). These columns have zero live read or write paths:
--
--   competitions.motto       — UI explicitly abandoned ("the UI no longer
--                              reads it" per code comments). Set only via
--                              now-deleted competitions.update motto field.
--   trips.owner_alert*       — set only by trips.setOwnerAlert (deleted in
--                              Task 7); never read by any rendered UI.
--
-- trips.series_id is intentionally KEPT — the series feature is deferred,
-- not removed, and the column stays as a placeholder for the future build.

ALTER TABLE competitions
  DROP COLUMN IF EXISTS motto;

ALTER TABLE trips
  DROP COLUMN IF EXISTS owner_alert,
  DROP COLUMN IF EXISTS owner_alert_set_at,
  DROP COLUMN IF EXISTS owner_alert_set_by;
