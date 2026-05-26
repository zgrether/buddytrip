-- Migration 004 — trip_members.nickname
-- Adds a trip-scoped display name override.
--
-- Background: the MemberEditor drawer offered a "Trip nickname" field but the
-- save path only fired for guest members (ghostCrew.update). Real-account
-- members had no save path at all, so their nickname edits silently dropped.
--
-- The fix is to make nickname trip-scoped (lives on trip_members, not users):
-- organizers can rename anyone (except the Owner) inside the context of a
-- single trip without affecting that member's display name elsewhere in the
-- app. Display priority becomes:
--
--     trip_members.nickname  ->  users.name  ->  users.email  ->  fallback
--
-- users.nickname is now considered dead and will be cleaned up in a follow-up
-- migration once the read sites are migrated. Existing values stay in place
-- as a transitional fallback so we don't lose any data on the way out.

ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS nickname text;

COMMENT ON COLUMN trip_members.nickname IS
  'Optional trip-scoped display name. Overrides users.name for this trip only. Editable by Owner/Planner via MemberEditor; never set for the Owner row (Owner controls their own display name from account settings).';
