-- Track per-member and per-trip invitation blast timestamps
ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS last_invited_at timestamptz;

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS last_blast_sent_at timestamptz;
