-- BuddyTrip — Views, Functions, and Triggers

-- round_results view: aggregated team points per round
CREATE VIEW round_results AS
  SELECT
    grs.round_id,
    grs.team_id,
    SUM(grs.points) AS total_points
  FROM group_result_scores grs
  GROUP BY grs.round_id, grs.team_id;

-- trip_status computed function
-- Returns 'planning' | 'ready' | 'active' | 'completed'
-- Never stored — always derived
CREATE OR REPLACE FUNCTION trip_status(t trips) RETURNS text AS $$
  SELECT CASE
    WHEN t.end_date IS NOT NULL AND t.end_date < CURRENT_DATE THEN 'completed'
    WHEN t.start_date IS NOT NULL AND t.start_date <= CURRENT_DATE THEN 'active'
    WHEN t.locked_destination_title IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM date_polls dp
        WHERE dp.trip_id = t.id AND dp.locked_window_id IS NOT NULL
      )
      THEN 'ready'
    ELSE 'planning'
  END;
$$ LANGUAGE sql STABLE;

-- updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to tables that have updated_at column
CREATE TRIGGER set_updated_at BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON group_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
