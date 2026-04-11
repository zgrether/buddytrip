-- ══════════════════════════════════════════════════════════════════════
-- Migration 038: Content Model — logistics, schedule, travel, owner alert
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. logistics_items ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS logistics_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('lodging', 'transport', 'general')),
  label text NOT NULL,
  detail text,
  -- Lodging fields
  property_name text,
  address text,
  check_in_time text,
  check_out_time text,
  -- Transport fields
  transport_type text,
  pickup_location text,
  pickup_time text,
  -- Ordering
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logistics_items_trip
  ON logistics_items(trip_id);

ALTER TABLE logistics_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip members can view logistics"
  ON logistics_items FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "planners can manage logistics"
  ON logistics_items FOR ALL
  USING (is_trip_planner(trip_id));

-- ── 2. schedule_items ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title text NOT NULL,
  detail text,
  scheduled_date date,
  scheduled_time time,
  is_confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  confirmed_by text REFERENCES users(id),
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_items_trip
  ON schedule_items(trip_id);

ALTER TABLE schedule_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip members can view schedule"
  ON schedule_items FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "planners can manage schedule"
  ON schedule_items FOR ALL
  USING (is_trip_planner(trip_id));

-- ── 3. Personal travel on trip_members ─────────────────────────────────

ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS travel_mode text
    CHECK (travel_mode IN ('driving', 'flying', 'other')),
  ADD COLUMN IF NOT EXISTS travel_detail text,
  ADD COLUMN IF NOT EXISTS flight_airline text,
  ADD COLUMN IF NOT EXISTS flight_number text,
  ADD COLUMN IF NOT EXISTS flight_arrival_time timestamptz,
  ADD COLUMN IF NOT EXISTS flight_airport text,
  ADD COLUMN IF NOT EXISTS travel_shared boolean NOT NULL DEFAULT false;

-- ── 4. Owner alert on trips ────────────────────────────────────────────

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS owner_alert text,
  ADD COLUMN IF NOT EXISTS owner_alert_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_alert_set_by text REFERENCES users(id);
