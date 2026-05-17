ALTER TABLE trips
  ADD COLUMN date_poll_state text
    CHECK (date_poll_state IN ('draft', 'active', 'closed'));

-- Backfill: existing active polls move to 'active' state
UPDATE trips
  SET date_poll_state = 'active'
  WHERE date_poll_active = true;
