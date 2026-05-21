-- Migration 006 — trip-local display name override
-- Spec: CC_MODAL_AUDIT.md Part 1.4
--
-- Adds `trip_members.display_name` so each trip can have its own per-member
-- display label without touching the user's global `users.name` /
-- `users.nickname` fields. The crew roster, schedule, scoring, and expenses
-- all read displayName via listMembers() which now prefers this override.
--
-- NULL = use the existing global fallback chain
--   (users.nickname → users.name → email-stem → "Unknown <id>").
--
-- The override is set:
--   - on tripMembers.inviteByEmail when caller passes `name` (Path A
--     account-add + Path B guest-create both write it)
--   - on ghostCrew.create when caller passes `name`
--   - via the new tripMembers.setDisplayName mutation (user-driven edits
--     from the expanded crew row).
ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN trip_members.display_name IS
  'Trip-local display name override. NULL = fall through to users.nickname / users.name. Set by Add Crew Member modal + the expanded-row inline-edit affordance.';
