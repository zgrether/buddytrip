-- Migration: 007_scoreboard_shares
-- Table for public scoreboard share links.

CREATE TABLE scoreboard_shares (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  event_id text NOT NULL REFERENCES events (id),
  created_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

-- RLS: Allow authenticated users to create/read shares for their trips.
-- Public (anon) users can read any share by id.
ALTER TABLE scoreboard_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scoreboard shares"
  ON scoreboard_shares FOR SELECT
  USING (true);

CREATE POLICY "Trip members can create scoreboard shares"
  ON scoreboard_shares FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trip_members
      WHERE trip_members.trip_id = scoreboard_shares.trip_id
        AND trip_members.user_id = auth.uid()
    )
  );
