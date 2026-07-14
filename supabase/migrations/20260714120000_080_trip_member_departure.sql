-- Migration 080 — trip_members departure leg
--
-- Travel is modeled as columns on trip_members (one arrival record per person:
-- travel_mode / travel_detail / flight_arrival_time). Until now the app only
-- captured ARRIVALS. This adds the mirror DEPARTURE leg on the same row
-- (Phase-0 recommendation A: extend the record, least new surface — reuses the
-- existing trip_members RLS + the wholesale merge-guest reassignment, no new
-- table/policies).
--
-- Mirror of the arrival trio:
--   travel_mode          -> departure_mode
--   travel_detail        -> departure_detail
--   flight_arrival_time  -> departure_time   (timestamptz; midnight T00:00:00
--                                             is the "date only, no time" sentinel)
--
-- Additive + idempotent. Arrivals are untouched.

ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS departure_mode text
    CHECK (departure_mode IN ('driving','flying','other')),
  ADD COLUMN IF NOT EXISTS departure_detail text,
  ADD COLUMN IF NOT EXISTS departure_time timestamptz;
