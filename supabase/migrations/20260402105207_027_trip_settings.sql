-- Explicit status override (only 'saved' is stored; planning/upcoming/past remain derived)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_status_override text
  CHECK (trip_status_override IN ('saved'));

-- Timestamp for when the trip was saved
ALTER TABLE trips ADD COLUMN IF NOT EXISTS saved_at timestamptz;

-- Update the trip_status() computed function to check saved override first
CREATE OR REPLACE FUNCTION trip_status(t trips) RETURNS text AS $$
  SELECT CASE
    WHEN t.trip_status_override = 'saved' THEN 'saved'
    WHEN t.end_date IS NOT NULL AND t.end_date < CURRENT_DATE THEN 'completed'
    WHEN t.start_date IS NOT NULL AND t.start_date <= CURRENT_DATE THEN 'active'
    WHEN t.locked_destination_title IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.date_polls dp
        WHERE dp.trip_id = t.id AND dp.locked_window_id IS NOT NULL
      )
      THEN 'ready'
    ELSE 'planning'
  END;
$$ LANGUAGE sql STABLE SET search_path = '';
