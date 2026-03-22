-- Add unique constraint on (trip_id, user_id) to trip_members.
-- Required for correct upsert semantics and to enforce the invariant
-- that a user can only appear once per trip.
ALTER TABLE trip_members
  ADD CONSTRAINT trip_members_trip_id_user_id_key UNIQUE (trip_id, user_id);
