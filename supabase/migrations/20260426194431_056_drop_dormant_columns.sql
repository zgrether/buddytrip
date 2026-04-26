-- Drop dormant columns that have no UI, no router queries, and no frontend callers.
-- Identified in AUDIT_REPORT.md (2026-04-26).

-- rsvp_enabled on trips — schema-ready but RSVP feature was never built.
-- No router reads or writes this column; no UI toggle exists.
ALTER TABLE trips
  DROP COLUMN IF EXISTS rsvp_enabled;

-- rsvp_status on trip_members — backfilled in migration 030 but never SELECTed
-- by any tRPC router and never displayed in any UI component.
ALTER TABLE trip_members
  DROP COLUMN IF EXISTS rsvp_status;

-- travel_enabled on trips — updateActionCenterSettings mutation (052) was the
-- only writer; that mutation was removed as orphaned code (no frontend caller).
ALTER TABLE trips
  DROP COLUMN IF EXISTS travel_enabled;

-- Note: guest_crew.invited_at was identified as dormant in AUDIT_REPORT.md, but the
-- guest_crew table does not exist on the remote instance (migration 012 was not applied
-- there). Column is already absent — no DROP needed.
