-- 017: Add 'invited' as a valid trip_members status value
-- Invited members are pending BuddyTrip accounts, represented by a guest user row.

ALTER TABLE trip_members DROP CONSTRAINT IF EXISTS trip_members_status_check;
ALTER TABLE trip_members ADD CONSTRAINT trip_members_status_check
  CHECK (status IN ('in', 'likely', 'maybe', 'out', 'invited'));
