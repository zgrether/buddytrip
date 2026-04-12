CREATE TABLE IF NOT EXISTS idea_lodging_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id text NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text CHECK (source IN ('vrbo', 'airbnb', 'hotel', 'other')),
  sleeps integer,
  price_note text,
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idea_lodging_options_idea_idx
  ON idea_lodging_options(idea_id);

ALTER TABLE idea_lodging_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip members can view idea lodging"
ON idea_lodging_options FOR SELECT
USING (is_trip_member(trip_id));

CREATE POLICY "trip members can manage idea lodging"
ON idea_lodging_options FOR ALL
USING (is_trip_member(trip_id));
