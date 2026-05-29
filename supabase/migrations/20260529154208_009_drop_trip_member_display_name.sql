-- Drop the orphaned trip_members.display_name column.
--
-- Background: the closed feature/crew-overhaul branch (PR #266) added this
-- column as a trip-scoped display-name override. main standardized on
-- trip_members.nickname for the same purpose (PR #268, migration 004), and
-- dropped users.nickname (migration 005). display_name is unused by all
-- application code on main. No data is preserved: the single populated value
-- duplicated the user's users.name, so nothing is lost.
ALTER TABLE trip_members DROP COLUMN IF EXISTS display_name;
